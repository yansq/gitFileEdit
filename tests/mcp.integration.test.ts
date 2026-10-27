import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ConfigQueries } from "../server/src/mcp/queries";
import { createMcpRouter } from "../server/src/mcp/server";
import type { AppConfig } from "../server/src/types";

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
const file = "configs/dev/service/env_config";
const yamlFile = "configs/dev/service/application";

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), "git-file-edit-mcp-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  const remote = path.join(root, "remote.git");
  await mkdir(repo);
  git(root, "init", "--bare", remote);
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "张三");
  git(repo, "config", "user.email", "test@local");
  git(repo, "remote", "add", "origin", remote);
  async function write(filePath: string, content: string) {
    await mkdir(path.dirname(path.join(repo, filePath)), { recursive: true });
    await writeFile(path.join(repo, filePath), content);
  }
  function commit(message: string, author = "张三", date = "2026-10-01T04:00:00Z") {
    git(repo, "add", ".");
    execFileSync("git", ["-c", `user.name=${author}`, "commit", "--allow-empty", "-m", message], {
      cwd: repo, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, stdio: "pipe"
    });
    git(repo, "push", "origin", "main");
    return git(repo, "rev-parse", "HEAD");
  }
  await write(file, "timeout=30\nport=8080\nempty=\n");
  await write(yamlFile, "server:\n  port: 8080\n  enabled: true\n");
  await write("configs/dev/ambiguous", "timeout: 30\n");
  await write("configs/dev/unsupported.json", '{"timeout": 99}\n');
  await write("configs/uat/env_config", "timeout=99\n");
  await write("hidden/secret", "timeout=hidden\n");
  const initial = commit("初始配置");
  const config: AppConfig = { server: { port: 0 }, repo: {
    localPath: repo, remoteUrl: remote, branch: "main", allowedExtensions: ["", ".yaml", ".properties", ".json", ".xml"],
    auth: { username: "", password: "" }, commitMessagePrefix: "config: ", cloneOnStart: false,
    tenants: [{ id: "config", label: "配置", root: "configs" }],
    environments: [
      { id: "dev", label: "开发环境", tenantId: "config", root: "configs/dev", requiresAdminToEdit: false, kind: "config" },
      { id: "uat", label: "验收环境", tenantId: "config", root: "configs/uat", requiresAdminToEdit: true, kind: "config" }
    ]
  } };
  const options = { loadConfig: async () => config, refreshIntervalMs: 0 };
  return { root, repo, remote, config, initial, options, queries: new ConfigQueries(options), write, commit };
}

test("读取远端固定快照，排除草稿、未推送提交，搜索保留重名结果与格式诊断", async (t) => {
  const f = await fixture(t);
  const env = await f.queries.listEnvironments();
  assert.equal(env.environments.length, 2);
  assert.equal(env.snapshot.stale, false);
  assert.equal(env.snapshot.revision, f.initial);
  await f.write(file, "timeout=draft\n");
  const value = await f.queries.value({ path: file, key: "timeout" });
  assert.equal(value.value, "30");
  git(f.repo, "add", file);
  git(f.repo, "commit", "-m", "local only");
  assert.equal((await f.queries.value({ path: file, key: "timeout" })).value, "30");
  const search = await f.queries.search({ query: "timeout", exact: true });
  assert.equal(search.items.length, 2);
  assert.ok(search.issues.some((item) => item.path === "configs/dev/ambiguous"));
  assert.ok(search.issues.some((item) => item.path.endsWith(".json")));
  assert.ok(!search.items.some((item) => String(item.path).startsWith("hidden/")));
  assert.equal((await f.queries.search({ query: "service", mode: "filename" })).items.length, 0);
  assert.equal((await f.queries.search({ query: "timeout", mode: "content", environmentId: "dev" })).items.length, 3);
  assert.equal((await f.queries.value({ path: yamlFile, key: "server.port" })).value, 8080);
  assert.equal((await f.queries.value({ path: file, key: "empty" })).value, "");
  assert.equal((await f.queries.value({ path: file, key: "missing" })).status, "not_found");
  assert.equal((await f.queries.value({ path: "configs/dev/ambiguous", key: "timeout" })).status, "unparsed");
  assert.equal((await f.queries.value({ path: "configs/dev/ambiguous", key: "timeout", format: "yaml" })).value, 30);
  const override = new ConfigQueries({ ...f.options, formatOverrides: { "configs/dev/ambiguous": "properties" } });
  assert.equal((await override.value({ path: "configs/dev/ambiguous", key: "timeout" })).value, "30");
});

test("配置项历史归因忽略同文件其他修改和格式调整，保留恢复过程并跟踪重命名/删除", async (t) => {
  const f = await fixture(t);
  await f.write(file, "timeout=60\nport=8080\nempty=\n");
  const changed = f.commit("修改 timeout", "王五", "2026-10-02T04:00:00Z");
  await f.write(file, "timeout=60\nport=9090\nempty=\n");
  f.commit("只修改 port", "李四", "2026-10-03T04:00:00Z");
  await f.write(file, "# 格式调整\ntimeout = 60\nport=9090\nempty=\n");
  f.commit("调整格式", "李四", "2026-10-04T04:00:00Z");
  const history = await f.queries.history({ path: file, key: "timeout" });
  assert.equal(history.items[0].authorName, "王五");
  assert.equal(history.items[0].hash, changed);
  assert.equal(history.items.length, 2);
  assert.equal(history.items[0].beforeValue, "30");
  assert.equal(history.items[0].afterValue, "60");
  const renamed = "configs/dev/service/renamed";
  git(f.repo, "mv", file, renamed);
  f.commit("重命名", "李四", "2026-10-05T04:00:00Z");
  await f.write(renamed, "timeout=30\nport=9090\nempty=\n");
  const restored = f.commit("恢复 timeout", "赵六", "2026-10-06T04:00:00Z");
  const followed = await f.queries.history({ path: renamed, key: "timeout", limit: 1 });
  assert.equal(followed.items[0].hash, restored);
  assert.equal(followed.hasMore, true);
  const next = await f.queries.history({ path: renamed, key: "timeout", limit: 1, cursor: followed.nextCursor! });
  assert.equal(next.items[0].hash, changed);
  const oldest = await f.queries.history({ path: renamed, key: "timeout", limit: 1, cursor: next.nextCursor! });
  assert.deepEqual(oldest.items.map((item) => item.hash), [f.initial]);
  assert.deepEqual(oldest.issues, []);
  assert.equal(oldest.hasMore, false);
  assert.equal(oldest.complete, true);
  const detail = await f.queries.changeDetail({ path: file, hash: changed });
  assert.equal(detail.changes?.[0].key, "timeout");
  assert.match(detail.diff, /-timeout=30/);
  git(f.repo, "rm", renamed);
  const deleted = f.commit("删除配置", "赵六", "2026-10-07T04:00:00Z");
  const deletedHistory = await f.queries.history({ path: renamed, key: "timeout" });
  assert.equal(deletedHistory.items[0].hash, deleted);
  assert.equal(deletedHistory.items[0].afterExists, false);
  const deletedDetail = await f.queries.changeDetail({ path: renamed, hash: deleted });
  assert.equal(deletedDetail.beforeExists, true);
  assert.equal(deletedDetail.afterExists, false);
});

test("配置项历史小页跳过无关修改，固定快照并最终结束翻页", async (t) => {
  const f = await fixture(t);
  await f.write(file, "timeout=60\nport=8080\nempty=\n");
  const changed = f.commit("修改 timeout");
  for (const port of [8081, 8082, 8083, 8084]) {
    await f.write(file, `timeout=60\nport=${port}\nempty=\n`);
    f.commit("只修改 port");
  }
  for (let index = 0; index < 6; index++) {
    await f.write(yamlFile, `server:\n  port: ${9000 + index}\n`);
    f.commit("修改其他文件");
  }
  const input = { path: file, key: "timeout", limit: 1 };
  const first = await f.queries.history(input);
  assert.equal(first.items[0].hash, changed);
  assert.equal(first.scannedCommits, 5);
  assert.equal(first.hasMore, true);
  await f.write(file, "timeout=90\nport=8084\nempty=\n");
  f.commit("翻页期间更新 timeout");
  const next = await f.queries.history({ ...input, cursor: first.nextCursor! });
  assert.equal(next.snapshot.revision, first.snapshot.revision);
  assert.deepEqual(next.items.map((item) => item.hash), [f.initial]);
  assert.equal(next.hasMore, false);
  assert.equal(next.nextCursor, null);
  assert.equal(next.complete, true);
  assert.deepEqual(next.issues, []);
});

test("环境日期使用提交时间和上海整日边界，分页与快照保持一致", async (t) => {
  const f = await fixture(t);
  await f.write(file, "timeout=40\n");
  const beforeDay = f.commit("边界前", "张三", "2026-10-01T15:59:59Z");
  await f.write(file, "timeout=50\n");
  const startDay = f.commit("当天开始", "张三", "2026-10-01T16:00:00Z");
  await f.write(file, "timeout=60\n");
  const endDay = f.commit("当天结束", "李四", "2026-10-02T15:59:59Z");
  await f.write(file, "timeout=70\n");
  f.commit("次日开始", "李四", "2026-10-02T16:00:00Z");
  const input = { environmentId: "dev", since: "2026-10-02", until: "2026-10-02", limit: 1 };
  const first = await f.queries.environmentChanges(input);
  assert.equal(first.items[0].hash, endDay);
  await f.write(file, "timeout=80\n");
  f.commit("并发更新", "李四", "2026-10-02T12:00:00Z");
  const next = await f.queries.environmentChanges({ ...input, cursor: first.nextCursor! });
  assert.equal(next.items[0].hash, startDay);
  assert.equal(next.snapshot.revision, first.snapshot.revision);
  const all = await f.queries.environmentChanges({ ...input, limit: 100, revision: first.snapshot.revision });
  assert.deepEqual(all.items.map((item) => item.hash), [endDay, startDay]);
  assert.ok(!all.items.some((item) => item.hash === beforeDay));
  await assert.rejects(f.queries.environmentChanges({ ...input, since: "2026-02-30" }), /日期无效/);
  await assert.rejects(f.queries.environmentChanges({ ...input, since: "2026-10-03" }), /开始时间/);
});

test("搜索游标跨请求与提交一致，篡改游标、跨环境路径和任意提交被拒绝", async (t) => {
  const f = await fixture(t);
  const first = await f.queries.search({ query: "timeout", exact: true, limit: 1 });
  assert.equal(first.hasMore, true);
  const next = await f.queries.search({ query: "timeout", exact: true, limit: 1, cursor: first.nextCursor! });
  assert.notEqual(next.items[0].path, first.items[0].path);
  assert.equal(next.snapshot.revision, first.snapshot.revision);
  await assert.rejects(f.queries.search({ query: "other", cursor: first.nextCursor! }), /游标/);
  const [payload, signature] = first.nextCursor!.split(".");
  const altered = JSON.parse(Buffer.from(payload, "base64url").toString());
  altered.offset = 1000;
  await assert.rejects(f.queries.search({ query: "timeout", exact: true, cursor: `${Buffer.from(JSON.stringify(altered)).toString("base64url")}.${signature}` }), /游标/);
  for (const filePath of ["../secret", "/etc/passwd", "configs/dev/../uat/env_config", "hidden/secret"]) {
    await assert.rejects(f.queries.value({ path: filePath, key: "timeout" }));
  }
  await assert.rejects(f.queries.value({ path: file, environmentId: "uat", key: "timeout" }), /范围/);
  await assert.rejects(f.queries.value({ path: file, environmentId: "missing", key: "timeout" }), /环境/);
  await assert.rejects(f.queries.changeDetail({ path: file, hash: "a".repeat(40) }), /提交不属于/);
  git(f.repo, "checkout", "-b", "other");
  await f.write(file, "timeout=secret\n");
  git(f.repo, "add", ".");
  git(f.repo, "commit", "-m", "other branch");
  const otherHash = git(f.repo, "rev-parse", "HEAD");
  await assert.rejects(f.queries.value({ path: file, key: "timeout", revision: otherHash }), /不属于/);
});

test("远端同步失败明确返回 stale；不会改变网页工作区和本地分支", async (t) => {
  const f = await fixture(t);
  const beforeStatus = git(f.repo, "status", "--porcelain");
  await f.queries.listEnvironments();
  assert.equal(git(f.repo, "status", "--porcelain"), beforeStatus);
  assert.equal(git(f.repo, "rev-parse", "HEAD"), f.initial);
  await rm(f.remote, { recursive: true, force: true });
  const value = await f.queries.value({ path: file, key: "timeout" });
  assert.equal(value.value, "30");
  assert.equal(value.snapshot.stale, true);
  assert.ok(value.snapshot.lastFetchedAt);
  assert.match(value.snapshot.syncError!, /同步失败/);
  assert.ok(!value.snapshot.syncError!.includes(f.remote));
});

test("超过 200 条提交完整翻页，扫描空页仍可继续，没有隐式总量截断", async (t) => {
  const f = await fixture(t);
  let stream = "";
  for (let index = 0; index < 207; index++) {
    const content = `timeout=${index}\n`;
    const message = `change ${index}`;
    stream += `commit refs/heads/main\nauthor Test <test@local> ${1790812800 + index} +0000\ncommitter Test <test@local> ${1790812800 + index} +0000\ndata ${Buffer.byteLength(message)}\n${message}\n`;
    if (index === 0) stream += `from ${f.initial}\n`;
    stream += `M 100644 inline ${file}\ndata ${Buffer.byteLength(content)}\n${content}\n`;
  }
  execFileSync("git", ["fast-import", "--quiet"], { cwd: f.repo, input: stream, stdio: ["pipe", "pipe", "pipe"] });
  git(f.repo, "push", "origin", "main");
  const hashes = new Set<string>();
  let cursor: string | undefined;
  let calls = 0;
  do {
    const page = await f.queries.environmentChanges({ environmentId: "dev", since: "2026-01-01", until: "2026-12-31", limit: 100, cursor });
    for (const item of page.items) {
      assert.ok(!hashes.has(item.hash as string));
      hashes.add(item.hash as string);
    }
    cursor = page.nextCursor ?? undefined;
    calls++;
  } while (cursor && calls < 10);
  assert.equal(hashes.size, 208);
  assert.equal(calls, 3);
  const sparse = await f.queries.history({ path: file, key: "nonexistent" });
  assert.equal(sparse.items.length, 0);
  assert.equal(sparse.hasMore, true);
  const last = await f.queries.history({ path: file, key: "nonexistent", cursor: sparse.nextCursor! });
  assert.equal(last.hasMore, true);
  const final = await f.queries.history({ path: file, key: "nonexistent", cursor: last.nextCursor! });
  assert.equal(final.items.length, 0);
  assert.equal(final.scannedCommits, 8);
  assert.equal(final.hasMore, false);
  assert.equal(final.nextCursor, null);
  assert.equal(final.complete, true);
});

test("YAML null、无效历史、合并引入、符号链接及大文件有明确结果", async (t) => {
  const f = await fixture(t);
  await f.write(yamlFile, "server:\n  port: null\n");
  const yamlChange = f.commit("YAML null", "张三", "2026-10-02T04:00:00Z");
  const value = await f.queries.value({ path: yamlFile, key: "server.port" });
  assert.equal(value.found, true);
  assert.equal(value.value, null);
  const detail = await f.queries.changeDetail({ path: yamlFile, hash: yamlChange });
  const portChange = detail.changes?.find((change) => change.key === "server.port");
  assert.equal(portChange?.afterExists, true);
  assert.equal(portChange?.afterValue, null);
  await f.write(yamlFile, "server: [broken");
  f.commit("无效 YAML", "张三", "2026-10-03T04:00:00Z");
  const history = await f.queries.history({ path: yamlFile, key: "server.port" });
  assert.ok(history.issues.length > 0);
  assert.equal(history.complete, false);
  git(f.repo, "checkout", "-b", "feature");
  await f.write(file, "timeout=merged\n");
  git(f.repo, "add", file);
  git(f.repo, "commit", "-m", "feature value");
  git(f.repo, "checkout", "main");
  git(f.repo, "merge", "--no-ff", "feature", "-m", "merge feature");
  git(f.repo, "push", "origin", "main");
  const merge = git(f.repo, "rev-parse", "HEAD");
  const merged = await f.queries.history({ path: file, key: "timeout" });
  assert.equal(merged.items[0].hash, merge);
  assert.equal(merged.items[0].afterValue, "merged");
  await f.write("configs/dev/oversize", "a=" + "x".repeat(512 * 1024));
  const { symlink } = await import("node:fs/promises");
  await symlink("../../../hidden/secret", path.join(f.repo, "configs/dev/link"));
  f.commit("large file and link");
  await assert.rejects(f.queries.value({ path: "configs/dev/oversize", key: "a" }), /512 KiB/);
  await assert.rejects(f.queries.value({ path: "configs/dev/link", key: "timeout" }), /普通配置文件/);
});

test("真实 MCP 客户端完成握手、工具发现、结构化调用、错误处理与可选 Bearer 鉴权", async (t) => {
  const f = await fixture(t);
  await f.write(file, "timeout=30\nport=9090\nempty=\n");
  const portChange = f.commit("修改 port");
  await f.write(yamlFile, "server:\n  port: 9090\n");
  f.commit("修改其他文件");
  const app = express();
  app.use(express.json());
  app.use("/mcp", createMcpRouter({ ...f.options, token: "test-mcp-token", allowedOrigins: ["http://trusted.local"] }));
  app.use("/open-mcp", createMcpRouter(f.options));
  const http = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => http.once("listening", resolve));
  t.after(() => new Promise<void>((resolve) => { http.closeAllConnections(); http.close(() => resolve()); }));
  const address = http.address();
  assert.ok(address && typeof address === "object");
  const url = new URL(`http://127.0.0.1:${address.port}/mcp`);
  assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401);
  assert.equal((await fetch(url, { method: "POST", headers: { Origin: "http://untrusted.local", Authorization: "Bearer test-mcp-token" } })).status, 403);
  const client = new Client({ name: "mcp-test-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: "Bearer test-mcp-token" } } }));
  t.after(() => client.close());
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 6);
  assert.ok(tools.tools.every((tool) => tool.annotations?.readOnlyHint && tool.outputSchema));
  const result = await client.callTool({ name: "get_config_value", arguments: { path: file, key: "timeout" } });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent?.value, "30");
  const history = await client.callTool({ name: "get_config_history", arguments: { path: file, key: "timeout" } });
  assert.ok(Array.isArray(history.structuredContent?.items));
  const historyInput = { path: file, key: "port", limit: 1 };
  const firstPage = await client.callTool({ name: "get_config_history", arguments: historyInput });
  assert.ok(!firstPage.isError);
  assert.equal((firstPage.structuredContent?.items as { hash: string }[])[0].hash, portChange);
  assert.equal(firstPage.structuredContent?.hasMore, true);
  const lastPage = await client.callTool({ name: "get_config_history", arguments: { ...historyInput, cursor: firstPage.structuredContent?.nextCursor } });
  assert.ok(!lastPage.isError);
  assert.equal((lastPage.structuredContent?.items as { hash: string }[])[0].hash, f.initial);
  assert.equal(lastPage.structuredContent?.snapshot && (lastPage.structuredContent.snapshot as { revision: string }).revision,
    (firstPage.structuredContent?.snapshot as { revision: string }).revision);
  assert.equal(lastPage.structuredContent?.hasMore, false);
  assert.equal(lastPage.structuredContent?.nextCursor, null);
  for (const call of [
    { name: "list_environments", arguments: {} },
    { name: "search_configs", arguments: { query: "timeout" } },
    { name: "list_environment_changes", arguments: { environmentId: "dev", since: "2026-01-01" } },
    { name: "get_change_detail", arguments: { path: file, hash: f.initial } }
  ]) {
    const output = await client.callTool(call);
    assert.ok(!output.isError, JSON.stringify(output));
    assert.ok(output.structuredContent?.snapshot);
  }
  const failed = await client.callTool({ name: "get_config_value", arguments: { path: "../secret", key: "timeout" } });
  assert.equal(failed.isError, true);
  const invalid = await client.callTool({ name: "search_configs", arguments: { query: "timeout", limit: 1000 } });
  assert.equal(invalid.isError, true);
  assert.equal((await fetch(url, { headers: { Authorization: "Bearer test-mcp-token" } })).status, 405);
  const openClient = new Client({ name: "open-test-agent", version: "1.0.0" });
  await openClient.connect(new StreamableHTTPClientTransport(new URL("/open-mcp", url)));
  t.after(() => openClient.close());
  const openValue = await openClient.callTool({ name: "get_config_value", arguments: { path: file, key: "timeout" } });
  assert.equal(openValue.structuredContent?.value, "30");
});
