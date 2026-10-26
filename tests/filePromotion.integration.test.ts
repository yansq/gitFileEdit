import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { applyFilePromotion, createFilePromotionPreview, FilePromotionTargetRequiredError } from "../server/src/git";
import type { AppConfig, AuthUser } from "../server/src/types";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const admin: AuthUser = { id: "管理员", role: "admin" };
const user: AuthUser = { id: "张三", role: "user" };
const sourcePath = "configs/sit/service/env_config";
const targetPath = "configs/uat/service/env_config";
const sourceContent = "setting=来源\r\ntrailing=space  \r\n\r\n";

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), "git-file-edit-promotion-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repoPath = path.join(root, "repo");
  const remotePath = path.join(root, "remote.git");
  await mkdir(repoPath);
  git(root, "init", "--bare", remotePath);
  git(repoPath, "init", "-b", "main");
  git(repoPath, "config", "core.autocrlf", "false");
  git(repoPath, "config", "user.name", "Test");
  git(repoPath, "config", "user.email", "test@local");
  git(repoPath, "remote", "add", "origin", remotePath);
  for (const [filePath, content] of [
    [sourcePath, sourceContent], [targetPath, "setting=target\n"],
    ["configs/uat/another/env_config", "different directory\n"],
    ["configs/sit/empty", ""], ["configs/uat/empty", "not empty\n"],
    ["configs/sit/invalid.json", "{invalid}"], ["configs/uat/invalid.json", "{}\n"],
    ["configs/sit/source-only", "no target\n"], ["unrelated.txt", "initial\n"]
  ]) {
    await mkdir(path.dirname(path.join(repoPath, filePath)), { recursive: true });
    await writeFile(path.join(repoPath, filePath), content);
  }
  git(repoPath, "add", ".");
  git(repoPath, "commit", "-m", "initial");
  git(repoPath, "push", "-u", "origin", "main");
  const config: AppConfig = {
    server: { port: 0 },
    repo: {
      localPath: repoPath, remoteUrl: remotePath, branch: "main",
      allowedExtensions: ["", ".json", ".txt"], auth: { username: "", password: "" },
      tenants: [{ id: "config", label: "config", root: "configs" }, { id: "other", label: "other", root: "other" }],
      environments: [
        { id: "sit", tenantId: "config", label: "SIT环境", root: "configs/sit", kind: "config", requiresAdminToEdit: false },
        { id: "uat", tenantId: "config", label: "UAT环境", root: "configs/uat", kind: "config", requiresAdminToEdit: true },
        { id: "other", tenantId: "other", label: "其他租户", root: "other/sit", kind: "config", requiresAdminToEdit: false },
        { id: "library", tenantId: "config", label: "片段库", root: "configs/library", kind: "fragment-library", requiresAdminToEdit: false }
      ],
      commitMessagePrefix: "config: ", cloneOnStart: false
    }
  };
  const input = { sourcePath, targetEnvironmentId: "uat", actor: admin };
  return { root, repoPath, remotePath, config, input };
}

test("晋级预览不修改文件，确认只覆盖对应相对路径并生成可追溯提交", async (t) => {
  const { repoPath, remotePath, config, input } = await fixture(t);
  const head = git(repoPath, "rev-parse", "HEAD");
  const preview = await createFilePromotionPreview(config, input);
  assert.equal(preview.targetPath, targetPath);
  assert.equal(preview.beforeContent, "setting=target\n");
  assert.equal(preview.afterContent, sourceContent);
  assert.equal(preview.canApply, true);
  assert.equal(git(repoPath, "rev-parse", "HEAD"), head);
  assert.equal(await readFile(path.join(repoPath, targetPath), "utf8"), preview.beforeContent);

  await writeFile(path.join(repoPath, "unrelated.txt"), "staged draft\n");
  git(repoPath, "add", "unrelated.txt");
  const result = await applyFilePromotion(config, { ...input, baseHead: preview.baseHead, message: "业务验证完成" });
  assert.equal(result.path, targetPath);
  assert.equal(await readFile(path.join(repoPath, targetPath), "utf8"), sourceContent);
  assert.equal(await readFile(path.join(repoPath, sourcePath), "utf8"), sourceContent);
  assert.equal(await readFile(path.join(repoPath, "configs/uat/another/env_config"), "utf8"), "different directory\n");
  assert.equal(git(repoPath, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"), targetPath);
  assert.equal(git(repoPath, "diff", "--cached", "--name-only"), "unrelated.txt");
  assert.equal(git(repoPath, "rev-list", "--count", `${head}..HEAD`), "1");
  assert.equal(result.head, git(remotePath, "rev-parse", "refs/heads/main"));
  assert.match(git(repoPath, "log", "-1", "--format=%B"), /晋级 SIT环境 → UAT环境/);
  assert.match(git(repoPath, "log", "-1", "--format=%B"), /来源文件：configs\/sit\/service\/env_config/);
  assert.match(git(repoPath, "log", "-1", "--format=%B"), /业务验证完成/);
  assert.equal(git(repoPath, "log", "-1", "--format=%an"), admin.id);
  const unchanged = await createFilePromotionPreview(config, input);
  assert.equal(unchanged.canApply, false);
  await assert.rejects(applyFilePromotion(config, { ...input, baseHead: unchanged.baseHead, message: "" }), /无需晋级/);
});

test("权限由目标环境决定，预览和确认都校验权限，来源只读仍可晋级", async (t) => {
  const { config, input, repoPath } = await fixture(t);
  const preview = await createFilePromotionPreview(config, input);
  const forbidden = (error: unknown) => (error as { statusCode: number }).statusCode === 403;
  await assert.rejects(createFilePromotionPreview(config, { ...input, actor: user }), forbidden);
  await assert.rejects(applyFilePromotion(config, { ...input, actor: user, baseHead: preview.baseHead, message: "" }), forbidden);
  await assert.rejects(createFilePromotionPreview(config, { ...input, actor: undefined }), forbidden);
  assert.equal(await readFile(path.join(repoPath, targetPath), "utf8"), preview.beforeContent);
  const reverseInput = { sourcePath: targetPath, targetEnvironmentId: "sit", actor: user };
  const reverse = await createFilePromotionPreview(config, reverseInput);
  await applyFilePromotion(config, { ...reverseInput, baseHead: reverse.baseHead, message: "" });
  assert.equal(await readFile(path.join(repoPath, sourcePath), "utf8"), "setting=target\n");

  config.repo.environments![0].requiresAdminToEdit = true;
  await assert.rejects(applyFilePromotion(config, { ...reverseInput, baseHead: reverse.baseHead, message: "" }), forbidden);
});

for (const changedPath of [sourcePath, targetPath]) {
  test(`预览后远程文件 ${changedPath} 更新会拒绝旧确认`, async (t) => {
    const { root, config, input, repoPath, remotePath } = await fixture(t);
    const preview = await createFilePromotionPreview(config, input);
    const otherRepo = path.join(root, "other-repo");
    git(root, "clone", "-b", "main", remotePath, otherRepo);
    await writeFile(path.join(otherRepo, changedPath), "new remote content\n");
    git(otherRepo, "add", ".");
    git(otherRepo, "-c", "user.name=Other", "-c", "user.email=other@local", "commit", "-m", "remote update");
    git(otherRepo, "push");
    const remoteHead = git(remotePath, "rev-parse", "refs/heads/main");
    await assert.rejects(
      applyFilePromotion(config, { ...input, baseHead: preview.baseHead, message: "" }),
      (error: unknown) => (error as { statusCode: number }).statusCode === 409
    );
    assert.equal(git(remotePath, "rev-parse", "refs/heads/main"), remoteHead);
    assert.equal(await readFile(path.join(repoPath, targetPath), "utf8"), preview.beforeContent);
    const fresh = await createFilePromotionPreview(config, input);
    await applyFilePromotion(config, { ...input, baseHead: fresh.baseHead, message: "" });
    assert.equal(await readFile(path.join(repoPath, targetPath), "utf8"), fresh.afterContent);
  });
}

test("晋级拒绝缺失目标、跨租户、同环境、片段库和无效配置", async (t) => {
  const { config, input } = await fixture(t);
  for (const [change, expected] of [
    [{ targetEnvironmentId: "sit" }, /其他配置环境/],
    [{ targetEnvironmentId: "other" }, /同一租户/],
    [{ targetEnvironmentId: "library" }, /普通配置环境/],
    [{ targetEnvironmentId: "unknown" }, /普通配置环境/],
    [{ sourcePath: "configs/sit/source-only" }, /目标环境不存在/],
    [{ sourcePath: "configs/sit/invalid.json" }, /JSON 格式错误/],
    [{ sourcePath: "configs/sit/missing" }, /来源环境不存在/],
    [{ sourcePath: "../../outside" }, /不在仓库内/]
  ] as const) {
    await assert.rejects(createFilePromotionPreview(config, { ...input, ...change }), expected);
  }
  const emptyInput = { ...input, sourcePath: "configs/sit/empty" };
  const emptyPreview = await createFilePromotionPreview(config, emptyInput);
  assert.equal(emptyPreview.afterContent, "");
  assert.equal(emptyPreview.canApply, true);
  await applyFilePromotion(config, { ...emptyInput, baseHead: emptyPreview.baseHead, message: "" });
});

test("晋级保留未提交修改，拒绝覆盖脏文件", async (t) => {
  const { config, input, repoPath } = await fixture(t);
  const preview = await createFilePromotionPreview(config, input);
  await writeFile(path.join(repoPath, targetPath), "local draft\n");
  await assert.rejects(applyFilePromotion(config, { ...input, baseHead: preview.baseHead, message: "" }), /未提交修改/);
  assert.equal(await readFile(path.join(repoPath, targetPath), "utf8"), "local draft\n");
  assert.equal(git(repoPath, "rev-parse", "HEAD"), preview.baseHead);
});

test("推送失败回滚晋级提交，保留其他文件已暂存的修改", async (t) => {
  const { config, input, repoPath, remotePath } = await fixture(t);
  const preview = await createFilePromotionPreview(config, input);
  await writeFile(path.join(repoPath, "unrelated.txt"), "other draft\n");
  git(repoPath, "add", "unrelated.txt");
  const hookPath = path.join(remotePath, "hooks/pre-receive");
  await writeFile(hookPath, "#!/bin/sh\nexit 1\n");
  await chmod(hookPath, 0o755);
  await assert.rejects(applyFilePromotion(config, { ...input, baseHead: preview.baseHead, message: "" }), /declined/);
  assert.equal(git(repoPath, "rev-parse", "HEAD"), preview.baseHead);
  assert.equal(await readFile(path.join(repoPath, targetPath), "utf8"), preview.beforeContent);
  assert.equal(git(repoPath, "diff", "--cached", "--name-only"), "unrelated.txt");
  assert.equal(await readFile(path.join(repoPath, "unrelated.txt"), "utf8"), "other draft\n");
});

test("晋级不覆盖符号链接", async (t) => {
  const { config, input, repoPath } = await fixture(t);
  await rm(path.join(repoPath, targetPath));
  await symlink("../../../unrelated.txt", path.join(repoPath, targetPath));
  git(repoPath, "add", ".");
  git(repoPath, "commit", "-m", "symlink target");
  git(repoPath, "push");
  await assert.rejects(createFilePromotionPreview(config, input), /普通配置文件/);
});

test("不同环境的子目录不同时匹配同名文件，多候选必须指定目标且不能绕过环境限制", async (t) => {
  const { config, input, repoPath } = await fixture(t);
  const relocatedPath = "configs/uat/finagent-tob-uat/env_config";
  // 移除另一个同名文件，使环境内先只有一个候选。
  git(repoPath, "rm", "configs/uat/another/env_config");
  await mkdir(path.dirname(path.join(repoPath, relocatedPath)), { recursive: true });
  git(repoPath, "mv", targetPath, relocatedPath);
  git(repoPath, "commit", "-m", "different environment directories");
  git(repoPath, "push");
  const preview = await createFilePromotionPreview(config, input);
  assert.equal(preview.targetPath, relocatedPath);
  await applyFilePromotion(config, { ...input, targetPath: preview.targetPath, baseHead: preview.baseHead, message: "" });
  assert.equal(await readFile(path.join(repoPath, relocatedPath), "utf8"), sourceContent);

  const secondPath = "configs/uat/another/env_config";
  await mkdir(path.dirname(path.join(repoPath, secondPath)), { recursive: true });
  await writeFile(path.join(repoPath, secondPath), "second target\n");
  git(repoPath, "add", secondPath);
  git(repoPath, "commit", "-m", "ambiguous filename");
  git(repoPath, "push");
  await assert.rejects(createFilePromotionPreview(config, input), (error: unknown) => {
    assert.ok(error instanceof FilePromotionTargetRequiredError);
    assert.deepEqual(error.targetPaths, [secondPath, relocatedPath]);
    return true;
  });
  const selected = await createFilePromotionPreview(config, { ...input, targetPath: secondPath });
  assert.equal(selected.beforeContent, "second target\n");
  await assert.rejects(createFilePromotionPreview(config, { ...input, targetPath: sourcePath }), /目标配置文件路径/);
  await assert.rejects(createFilePromotionPreview(config, { ...input, targetPath: "configs/uat/empty" }), /目标配置文件路径/);
  await applyFilePromotion(config, { ...input, targetPath: secondPath, baseHead: selected.baseHead, message: "" });
  assert.equal(await readFile(path.join(repoPath, secondPath), "utf8"), sourceContent);
});
