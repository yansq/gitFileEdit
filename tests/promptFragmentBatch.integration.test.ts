import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyPromptFragmentBatch,
  createPromptFragmentBatchPreview
} from "../server/src/git";
import type { AppConfig } from "../server/src/types";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

test("从已提交片段预览并以一个 commit 批量替换", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "git-file-edit-fragment-"));
  const remotePath = path.join(temporaryRoot, "remote.git");
  const repoPath = path.join(temporaryRoot, "repo");

  try {
    await mkdir(remotePath);
    await mkdir(repoPath);
    git(remotePath, "init", "--bare");
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Test User");
    git(repoPath, "config", "user.email", "test@example.com");
    git(repoPath, "remote", "add", "origin", remotePath);

    await mkdir(path.join(repoPath, "templates"), { recursive: true });
    await mkdir(path.join(repoPath, "configs/dev/tob-uat"), { recursive: true });
    await writeFile(
      path.join(repoPath, "templates/financial-role.xml"),
      `<role desc="金融顾问">\nnew role\n</role>\n`,
      "utf8"
    );
    await writeFile(
      path.join(repoPath, "templates/audit-role.xml"),
      `<role desc="审计顾问">\naudit role\n</role>\n`,
      "utf8"
    );
    await writeFile(
      path.join(repoPath, "configs/dev/tob-uat/customer_prompt_cn"),
      `before\n<role desc="old">old role</role>\nafter\n`,
      "utf8"
    );
    await writeFile(
      path.join(repoPath, "configs/dev/tob-uat/missing_prompt_cn"),
      `prompt without the selected tag\n`,
      "utf8"
    );
    await writeFile(
      path.join(repoPath, "configs/dev/tob-uat/duplicate_prompt_cn"),
      `<role>one</role>\n<role>two</role>\n`,
      "utf8"
    );
    git(repoPath, "add", ".");
    git(repoPath, "commit", "-m", "initial");
    git(repoPath, "push", "-u", "origin", "main");

    const config: AppConfig = {
      server: { port: 0 },
      repo: {
        localPath: repoPath,
        remoteUrl: remotePath,
        branch: "main",
        allowedExtensions: ["", ".xml", ".txt"],
        auth: { username: "", password: "" },
        commitMessagePrefix: "config: ",
        cloneOnStart: false,
        environments: [
          {
            id: "templates",
            label: "提示词片段",
            root: "templates",
            requiresAdminToEdit: true,
            kind: "fragment-library"
          },
          {
            id: "dev",
            label: "开发环境",
            root: "configs/dev",
            requiresAdminToEdit: false,
            kind: "config"
          }
        ]
      }
    };

    const blockedPreview = await createPromptFragmentBatchPreview(config, {
      sourcePath: "templates/financial-role.xml",
      environmentIds: ["dev"],
      pattern: "/tob-uat/*_prompt_cn"
    });
    assert.equal(blockedPreview.tagName, "role");
    assert.equal(blockedPreview.matchedCount, 3);
    assert.equal(blockedPreview.changedCount, 1);
    assert.equal(blockedPreview.missingCount, 1);
    assert.equal(blockedPreview.errorCount, 1);
    assert.equal(blockedPreview.canApply, false);

    const preview = await createPromptFragmentBatchPreview(config, {
      sourcePath: "templates/financial-role.xml",
      environmentIds: ["dev"],
      pattern: "/tob-uat/customer_prompt_cn"
    });
    const selectedPath = preview.items[0].path;
    await writeFile(path.join(repoPath, "local-draft.txt"), "unrelated local draft\n", "utf8");
    const result = await applyPromptFragmentBatch(config, {
      sourcePath: preview.sourcePath,
      environmentIds: preview.environmentIds,
      pattern: preview.pattern,
      baseHead: preview.baseHead,
      selectedPaths: [selectedPath],
      message: "更新金融顾问角色",
      actor: { id: "admin", role: "admin" }
    });

    assert.deepEqual(result.paths, ["configs/dev/tob-uat/customer_prompt_cn"]);
    const updated = await readFile(path.join(repoPath, selectedPath), "utf8");
    assert.equal(updated, `before\n<role desc="金融顾问">\nnew role\n</role>\nafter\n`);
    assert.equal(await readFile(path.join(repoPath, "local-draft.txt"), "utf8"), "unrelated local draft\n");
    assert.equal(git(repoPath, "status", "--porcelain"), "?? local-draft.txt");
    assert.match(git(repoPath, "log", "-1", "--format=%s"), /^config: 批量替换 更新金融顾问角色$/);
    assert.match(git(repoPath, "log", "-1", "--format=%B"), /来源片段：templates\/financial-role\.xml/);
    assert.equal(git(repoPath, "rev-parse", "HEAD"), git(remotePath, "rev-parse", "refs/heads/main"));
    assert.equal(git(repoPath, "rev-parse", "HEAD"), git(repoPath, "rev-parse", "origin/main"));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
