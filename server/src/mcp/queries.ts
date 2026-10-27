import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { createTwoFilesPatch } from "diff";
import { getEnvironmentOptions, getTenantOptions, loadAppConfig, normalizeVisibleRoots, resolveRepoPath } from "../config";
import { fetchRemoteBranch } from "../git";
import { withRepoMutationLock } from "../repoMutationLock";
import type { AppConfig } from "../types";
import { compareConfigs, parseConfig, type ConfigFormat } from "./configParser";

const execFileAsync = promisify(execFile);
const MAX_FILE_BYTES = 512 * 1024;
const SCAN_LIMIT = 100;
const inRoot = (file: string, root: string) => file === root || file.startsWith(`${root}/`);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

interface Scope { tenantId?: string; environmentId?: string }
interface Page { cursor?: string; limit?: number; revision?: string }
interface FileInput extends Scope { path: string; format?: ConfigFormat; revision?: string }
interface TreeFile { path: string; blob: string; mode: string }
interface Cursor { revision: string; offset: number; matchOffset?: number; historyPath?: string; historyRevision?: string; until?: string; query: string }
interface Snapshot {
  revision: string;
  branch: string;
  queriedAt: string;
  lastFetchedAt: string | null;
  stale: boolean;
  syncError: string | null;
  source: "remote-committed";
}
interface Context { config: AppConfig; repo: string; snapshot: Snapshot }
interface CommitMeta {
  hash: string; parents: string[]; authorName: string; authorEmail: string;
  authoredAt: string; committedAt: string; message: string;
}
interface ChangedFile { status: string; path: string; previousPath: string | null }
export interface QueryOptions {
  loadConfig?: () => Promise<AppConfig>;
  refreshIntervalMs?: number;
  formatOverrides?: Record<string, ConfigFormat>;
}

async function git(repo: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["--no-replace-objects", ...args], {
      cwd: repo, encoding: "utf8", timeout: 30000, maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" }
    });
    return stdout;
  } catch { throw new Error("Git 查询失败或超出时间/输出限制，请确认仓库状态并缩小查询范围"); }
}

function validPath(file: string): void {
  if (!file || file.startsWith("/") || file.includes("\\") || file.includes("\0") || file.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("必须使用仓库内的规范相对文件路径");
  }
}

function validHash(hash: string): void {
  if (!/^[0-9a-f]{40}$/.test(hash)) throw new Error("版本必须是完整的 40 位 Git 提交号");
}

function pageSize(limit = 20): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit 必须在 1 到 100 之间");
  return limit;
}

function cursorOf(input: Page, query: string, secret: Buffer): Cursor | null {
  if (!input.cursor) return null;
  try {
    if (input.cursor.length > 4096) throw new Error();
    const [payload, signature] = input.cursor.split(".");
    const expected = createHmac("sha256", secret).update(payload).digest();
    const supplied = Buffer.from(signature ?? "", "base64url");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error();
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Cursor;
    validHash(value.revision);
    if (value.query !== query || !Number.isSafeInteger(value.offset) || value.offset < 0 ||
      (value.matchOffset !== undefined && (!Number.isSafeInteger(value.matchOffset) || value.matchOffset < 0)) ||
      (input.revision && input.revision !== value.revision)) throw new Error();
    if (value.historyPath !== undefined) validPath(value.historyPath);
    if (value.historyRevision !== undefined) validHash(value.historyRevision);
    return value;
  } catch { throw new Error("分页游标无效或与查询条件不匹配"); }
}

function encodeCursor(value: Cursor, secret: Buffer): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

function timeRange(since: string, until?: string, timezone = "Asia/Shanghai") {
  // Explicit offsets avoid depending on the Docker host's local timezone.
  if (timezone !== "Asia/Shanghai" && timezone !== "UTC") throw new Error("timezone 支持 Asia/Shanghai 或 UTC，也可在时间参数中直接给出偏移量");
  function parse(value: string, end: boolean): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const utc = new Date(`${value}T00:00:00Z`);
      if (!Number.isFinite(utc.getTime()) || utc.toISOString().slice(0, 10) !== value) throw new Error("日期无效");
      const date = new Date(`${value}T00:00:00${timezone === "UTC" ? "Z" : "+08:00"}`);
      if (end) date.setTime(date.getTime() + 86400000);
      return date;
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error("时间需使用 YYYY-MM-DD 或带时区的 ISO 时间");
    const calendarDate = new Date(`${value.slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== value.slice(0, 10)) throw new Error("日期无效");
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error("日期无效");
    return date;
  }
  const start = parse(since, false);
  const end = until ? parse(until, true) : new Date();
  if (start >= end) throw new Error("开始时间必须早于结束时间");
  return { since: start.toISOString(), until: end.toISOString(), timezone, endExclusive: true };
}

export class ConfigQueries {
  private readonly cursorSecret = randomBytes(32);
  private refresh: { key: string; attemptedAt: number; fetchedAt: string | null; error: string | null } | null = null;
  private readonly trees = new Map<string, Promise<TreeFile[]>>();
  constructor(private readonly options: QueryOptions = {}) {}

  private async context(revision?: string): Promise<Context> {
    const config = await (this.options.loadConfig ?? loadAppConfig)();
    const repo = resolveRepoPath(config);
    const key = digest([repo, config.repo.remoteUrl, config.repo.branch, config.repo.auth]);
    await withRepoMutationLock(async () => {
      const now = Date.now();
      if (this.refresh?.key === key && now - this.refresh.attemptedAt < (this.options.refreshIntervalMs ?? 30000)) return;
      const previousFetchedAt = this.refresh?.key === key ? this.refresh.fetchedAt : null;
      try {
        await fetchRemoteBranch(config, repo, 30000);
        this.refresh = { key, attemptedAt: now, fetchedAt: new Date().toISOString(), error: null };
      } catch {
        // Never return Git stderr here: remote URLs and authentication headers may contain credentials.
        this.refresh = { key, attemptedAt: now, fetchedAt: previousFetchedAt, error: "远端同步失败，当前结果可能不是最新版本" };
      }
    });
    let latest: string;
    try { latest = (await git(repo, ["rev-parse", "--verify", `refs/remotes/origin/${config.repo.branch}^{commit}`])).trim(); }
    catch { throw new Error("尚无可查询的远端版本，请先在网页完成仓库初始化和同步"); }
    if (revision) {
      validHash(revision);
      try { await git(repo, ["merge-base", "--is-ancestor", revision, latest]); }
      catch { throw new Error("指定版本不属于当前配置分支，或已因远端历史改写而失效"); }
    }
    return { config, repo, snapshot: {
      revision: revision ?? latest, branch: config.repo.branch, queriedAt: new Date().toISOString(),
      lastFetchedAt: this.refresh?.fetchedAt ?? null, stale: Boolean(this.refresh?.error),
      syncError: this.refresh?.error ?? null, source: "remote-committed"
    } };
  }

  private environments(context: Context, scope: Scope) {
    const tenants = getTenantOptions(context.config);
    if (scope.tenantId && !tenants.some((item) => item.id === scope.tenantId)) throw new Error("未知租户");
    const environments = getEnvironmentOptions(context.config);
    if (scope.environmentId && !environments.some((item) => item.id === scope.environmentId && (!scope.tenantId || item.tenantId === scope.tenantId))) throw new Error("环境不存在或不属于指定租户");
    return environments.filter((item) => (!scope.tenantId || item.tenantId === scope.tenantId) && (!scope.environmentId || item.id === scope.environmentId));
  }

  private allowed(context: Context, file: string, scope: Scope): boolean {
    return normalizeVisibleRoots(context.config).some((root) => inRoot(file, root)) &&
      this.environments(context, scope).some((environment) => inRoot(file, environment.root)) &&
      context.config.repo.allowedExtensions.includes(path.extname(file).toLowerCase());
  }

  private assertPath(context: Context, file: string, scope: Scope): void {
    validPath(file);
    if (!this.allowed(context, file, scope)) throw new Error("文件不在指定租户、环境或可见配置文件范围内");
  }

  private tree(context: Context, revision: string): Promise<TreeFile[]> {
    const key = `${context.repo}:${revision}`;
    let tree = this.trees.get(key);
    if (!tree) {
      tree = git(context.repo, ["ls-tree", "-r", "-z", "--full-tree", revision]).then((raw) => raw.split("\0").filter(Boolean).flatMap((record) => {
        const tab = record.indexOf("\t");
        const [mode, type, blob] = record.slice(0, tab).split(" ");
        return type === "blob" && ["100644", "100755"].includes(mode) ? [{ mode, blob, path: record.slice(tab + 1) }] : [];
      }));
      this.trees.set(key, tree);
      tree.catch(() => this.trees.delete(key));
      if (this.trees.size > 12) this.trees.delete(this.trees.keys().next().value!);
    }
    return tree;
  }

  private async content(context: Context, revision: string, file: string): Promise<string | null> {
    const entry = (await this.tree(context, revision)).find((item) => item.path === file);
    if (!entry) return null;
    const size = Number((await git(context.repo, ["cat-file", "-s", entry.blob])).trim());
    if (size > MAX_FILE_BYTES) throw new Error("文件超过 512 KiB，请缩小查询范围或使用网页查看");
    const content = await git(context.repo, ["cat-file", "blob", entry.blob]);
    if (content.includes("\0")) throw new Error("不支持查询二进制文件");
    return content;
  }

  private parse(content: string, file: string, format?: ConfigFormat) {
    return parseConfig(content, file, format ?? this.options.formatOverrides?.[file]);
  }

  private location(context: Context, file: string) {
    const environment = getEnvironmentOptions(context.config).find((item) => inRoot(file, item.root));
    return { tenantId: environment?.tenantId ?? null, environmentId: environment?.id ?? null };
  }

  async listEnvironments() {
    const context = await this.context();
    return { snapshot: context.snapshot, tenants: getTenantOptions(context.config), environments: getEnvironmentOptions(context.config) };
  }

  async search(input: Scope & Page & { query: string; mode?: "key" | "filename" | "content"; exact?: boolean; pathPrefix?: string; format?: ConfigFormat }) {
    if (!input.query.trim()) throw new Error("搜索内容不能为空");
    const { cursor: _cursor, limit: _limit, revision: _revision, ...criteria } = input;
    const query = digest(["search", criteria]);
    const cursor = cursorOf(input, query, this.cursorSecret);
    const context = await this.context(cursor?.revision ?? input.revision);
    this.environments(context, input);
    if (input.pathPrefix) validPath(input.pathPrefix);
    const files = (await this.tree(context, context.snapshot.revision)).filter((file) => this.allowed(context, file.path, input) &&
      (!input.pathPrefix || inRoot(file.path, input.pathPrefix))).sort((a, b) => a.path.localeCompare(b.path));
    const limit = pageSize(input.limit);
    const items: Record<string, unknown>[] = [];
    const issues: { path: string; message: string }[] = [];
    let offset = cursor?.offset ?? 0;
    let matchOffset = cursor?.matchOffset ?? 0;
    let scannedFiles = 0;
    const matches = (value: string) => input.exact ? value === input.query : value.toLocaleLowerCase().includes(input.query.toLocaleLowerCase());
    for (; offset < files.length && scannedFiles < SCAN_LIMIT; offset++, matchOffset = 0) {
      const file = files[offset].path;
      scannedFiles++;
      let results: Record<string, unknown>[] = [];
      try {
        if (input.mode === "filename") {
          if (matches(path.posix.basename(file))) results = [{ path: file, ...this.location(context, file) }];
        } else {
          const content = (await this.content(context, context.snapshot.revision, file))!;
          if (input.mode === "content") {
            results = content.split(/\r\n|\n|\r/).flatMap((line, index) => matches(line)
              ? [{ path: file, line: index + 1, snippet: line.slice(0, 1000), snippetTruncated: line.length > 1000, ...this.location(context, file) }] : []);
          } else {
            const parsed = this.parse(content, file, input.format);
            if (!["yaml", "properties"].includes(parsed.format)) issues.push({ path: file, message: parsed.warnings.join("; ").slice(0, 1000) });
            results = parsed.entries.filter((entry) => matches(entry.key)).map((entry) => ({ path: file, format: parsed.format, ...entry, ...this.location(context, file) }));
          }
        }
      } catch (error) { issues.push({ path: file, message: error instanceof Error ? error.message : "读取失败" }); }
      while (matchOffset < results.length && items.length < limit) items.push(results[matchOffset++]);
      if (items.length === limit) {
        if (matchOffset >= results.length) { offset++; matchOffset = 0; }
        break;
      }
    }
    const hasMore = offset < files.length;
    return { snapshot: context.snapshot, items, issues, scannedFiles, hasMore,
      nextCursor: hasMore ? encodeCursor({ revision: context.snapshot.revision, query, offset, matchOffset }, this.cursorSecret) : null };
  }

  async value(input: FileInput & { key: string }) {
    const context = await this.context(input.revision);
    this.assertPath(context, input.path, input);
    const content = await this.content(context, context.snapshot.revision, input.path);
    if (content === null) throw new Error("该提交中不存在此普通配置文件；已删除文件可查询历史");
    const parsed = this.parse(content, input.path, input.format);
    const entry = parsed.entries.find((item) => item.key === input.key);
    return { snapshot: context.snapshot, path: input.path, ...this.location(context, input.path), key: input.key,
      format: parsed.format, warnings: parsed.warnings, found: Boolean(entry),
      value: entry?.value ?? null, line: entry?.line ?? null,
      status: !["yaml", "properties"].includes(parsed.format) ? "unparsed" : entry ? "found" : "not_found" };
  }

  private async commit(context: Context, hash: string): Promise<CommitMeta> {
    const raw = await git(context.repo, ["show", "-s", "--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%cI%x00%B", hash]);
    const [id, parents, authorName, authorEmail, authoredAt, committedAt, message] = raw.split("\0");
    return { hash: id, parents: parents ? parents.split(" ") : [], authorName, authorEmail, authoredAt, committedAt, message: message.trim() };
  }

  private async changedFiles(context: Context, commit: CommitMeta): Promise<ChangedFile[]> {
    const raw = await git(context.repo, ["diff-tree", "--no-commit-id", "-r", "-M", "--name-status", "-z",
      ...(commit.parents[0] ? [commit.parents[0], commit.hash] : ["--root", commit.hash])]);
    const records = raw.split("\0").filter(Boolean);
    const files: ChangedFile[] = [];
    for (let index = 0; index < records.length;) {
      const status = records[index++];
      const first = records[index++];
      files.push({ status, previousPath: /^[RC]/.test(status) ? first : null, path: /^[RC]/.test(status) ? records[index++] : first });
    }
    return files;
  }

  private async versions(context: Context, commit: CommitMeta, file: ChangedFile, format?: ConfigFormat) {
    const previousPath = file.previousPath ?? file.path;
    // A rename can cross visible roots. Do not read an otherwise invisible source.
    const beforeVisible = this.allowed(context, previousPath, {});
    const [beforeContent, afterContent] = await Promise.all([
      commit.parents[0] && beforeVisible ? this.content(context, commit.parents[0], previousPath) : null,
      this.allowed(context, file.path, {}) ? this.content(context, commit.hash, file.path) : null
    ]);
    const before = beforeContent === null ? null : this.parse(beforeContent, previousPath, format);
    const after = afterContent === null ? null : this.parse(afterContent, file.path, format);
    return { beforeContent, afterContent, before, after,
      changes: beforeVisible ? compareConfigs(before, after) : null,
      warnings: [...(before?.warnings ?? []), ...(after?.warnings ?? []), ...(!beforeVisible ? ["重命名前的文件超出可见范围，无法完整比较"] : [])] };
  }

  async history(input: FileInput & Page & { key: string }) {
    const { cursor: _cursor, limit: _limit, revision: _revision, ...criteria } = input;
    const query = digest(["history", criteria]);
    const cursor = cursorOf(input, query, this.cursorSecret);
    const context = await this.context(cursor?.revision ?? input.revision);
    this.assertPath(context, input.path, input);
    let historyPath = cursor?.historyPath ?? input.path;
    this.assertPath(context, historyPath, {});
    const limit = pageSize(input.limit);
    // With --follow, --skip counts unrelated commits too. Resume at the next
    // unprocessed file commit and use its path from before any scanned rename.
    const hashes = (await git(context.repo, ["log", "--first-parent", "--follow", `--max-count=${SCAN_LIMIT + 1}`,
      "--format=%H", cursor?.historyRevision ?? context.snapshot.revision, "--", `:(literal)${historyPath}`])).trim().split("\n").filter(Boolean);
    const items: Record<string, unknown>[] = [];
    const issues: { hash: string; message: string }[] = [];
    let scanned = 0;
    for (const hash of hashes.slice(0, SCAN_LIMIT)) {
      scanned++;
      const commit = await this.commit(context, hash);
      const file = (await this.changedFiles(context, commit)).find((item) => item.path === historyPath);
      if (!file) { issues.push({ hash, message: "无法确定该提交的文件变化，未据此推断配置值" }); continue; }
      try {
        const versions = await this.versions(context, commit, file, input.format);
        const change = versions.changes?.find((item) => item.key === input.key);
        if (versions.changes === null) issues.push({ hash, message: versions.warnings.join("; ") || "无法解析配置项差异" });
        if (change) items.push({ ...commit, path: file.path, previousPath: file.previousPath, ...change, warnings: versions.warnings });
      } catch (error) { issues.push({ hash, message: error instanceof Error ? error.message : "历史读取失败" }); }
      if (file.previousPath && file.status.startsWith("R")) {
        if (!this.allowed(context, file.previousPath, {})) {
          issues.push({ hash, message: "更早文件路径超出可见范围，历史追踪在此结束" });
          return { snapshot: context.snapshot, items, issues, scannedCommits: scanned, hasMore: false, nextCursor: null, complete: false, historyMode: "first-parent" };
        }
        historyPath = file.previousPath;
      }
      if (items.length >= limit) break;
    }
    const hasMore = hashes.length > scanned;
    return { snapshot: context.snapshot, items, issues, scannedCommits: scanned, hasMore,
      nextCursor: hasMore ? encodeCursor({ revision: context.snapshot.revision, query, offset: 0, historyPath, historyRevision: hashes[scanned] }, this.cursorSecret) : null,
      complete: !hasMore && issues.length === 0, historyMode: "first-parent" };
  }

  async environmentChanges(input: Scope & Page & { environmentId: string; since: string; until?: string; timezone?: string; path?: string; key?: string; format?: ConfigFormat }) {
    const { cursor: _cursor, limit: _limit, revision: _revision, ...criteria } = input;
    const query = digest(["environmentChanges", criteria]);
    const cursor = cursorOf(input, query, this.cursorSecret);
    const context = await this.context(cursor?.revision ?? input.revision);
    const environment = this.environments(context, input)[0];
    if (input.path) this.assertPath(context, input.path, input);
    const range = timeRange(input.since, cursor?.until ?? input.until, input.timezone);
    const offset = cursor?.offset ?? 0;
    const limit = pageSize(input.limit);
    const hashes = (await git(context.repo, ["log", "--first-parent", "--full-history", `--skip=${offset}`, `--max-count=${SCAN_LIMIT + 1}`,
      "--format=%H", context.snapshot.revision, "--", `:(literal)${input.path ?? environment.root}`])).trim().split("\n").filter(Boolean);
    const items: Record<string, unknown>[] = [];
    const issues: { hash: string; message: string }[] = [];
    let scanned = 0;
    for (const hash of hashes.slice(0, SCAN_LIMIT)) {
      scanned++;
      const commit = await this.commit(context, hash);
      if (new Date(commit.committedAt) < new Date(range.since) || new Date(commit.committedAt) >= new Date(range.until)) continue;
      let files = (await this.changedFiles(context, commit)).filter((file) =>
        (this.allowed(context, file.path, input) || Boolean(file.previousPath && this.allowed(context, file.previousPath, input))) &&
        (!input.path || file.path === input.path || file.previousPath === input.path));
      if (input.key) {
        const matching: ChangedFile[] = [];
        for (const file of files) {
          try {
            const versions = await this.versions(context, commit, file, input.format);
            if (versions.changes?.some((change) => change.key === input.key)) matching.push(file);
            if (versions.changes === null) issues.push({ hash, message: `${file.path}: 无法解析配置项差异` });
          } catch { issues.push({ hash, message: `${file.path}: 无法读取配置项差异` }); }
        }
        files = matching;
      }
      if (files.length) items.push({ ...commit, files });
      if (items.length >= limit) break;
    }
    const hasMore = hashes.length > scanned;
    return { snapshot: context.snapshot, range, items, issues, scannedCommits: scanned, hasMore,
      nextCursor: hasMore ? encodeCursor({ revision: context.snapshot.revision, query, offset: offset + scanned, until: range.until }, this.cursorSecret) : null,
      complete: !hasMore && issues.length === 0, historyMode: "first-parent" };
  }

  async changeDetail(input: FileInput & { hash: string }) {
    validHash(input.hash);
    const context = await this.context(input.revision);
    this.assertPath(context, input.path, input);
    try { await git(context.repo, ["merge-base", "--is-ancestor", input.hash, context.snapshot.revision]); }
    catch { throw new Error("提交不属于所查询版本的历史"); }
    const commit = await this.commit(context, input.hash);
    const file = (await this.changedFiles(context, commit)).find((item) => item.path === input.path || item.previousPath === input.path);
    if (!file) throw new Error("该提交没有修改指定文件");
    const versions = await this.versions(context, commit, file, input.format);
    const diff = createTwoFilesPatch(file.previousPath ?? file.path, file.path, versions.beforeContent ?? "", versions.afterContent ?? "");
    return { snapshot: context.snapshot, commit, file,
      beforeExists: versions.beforeContent !== null, afterExists: versions.afterContent !== null,
      beforeFormat: versions.before?.format ?? null, afterFormat: versions.after?.format ?? null,
      changes: versions.changes, warnings: versions.warnings, diff: diff.slice(0, 100000), diffTruncated: diff.length > 100000,
      comparison: "first-parent" };
  }
}
