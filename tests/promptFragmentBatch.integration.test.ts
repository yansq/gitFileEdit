import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyPromptFragmentBatch,
  commitAndPushFile,
  createPromptFragmentFile,
  createPromptFragmentBatchPreview,
  renamePromptFragmentFile
} from "../server/src/git";
import { getEnvironmentOptions } from "../server/src/config";
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
    await mkdir(path.join(repoPath, "configs/dev/nested"), { recursive: true });
    await mkdir(path.join(repoPath, "configs/sit/finagent-tob-sit"), { recursive: true });
    await mkdir(path.join(repoPath, "configs/uat/tob-uat"), { recursive: true });
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
      path.join(repoPath, "templates/citation-rules.xml"),
      "<citation_rules>\n新引用规则\n</citation_rules>\n",
      "utf8"
    );
    const aaaFragment = "<role>\n  <test></test>\n</role>";
    const sitRole = "  <role>\n    <citation_rules>fasdf\n    <citation_rules>\n  </role>";
    const sitContent = [
      "system: |",
      "  <core_taask>",
      "    <citation_rules>sdfsd",
      "  </core_taask>",
      sitRole,
      "  <citation_rules>aaa</citation_rules>",
      "route.primary=/api/config/review/v2",
      "route.fallback=/api/config/review-fallback",
      "route.compare=/api/config/review/compare",
      "route.rollback=/api/config/review/rollback",
      "route.grayUsers=zhangsan,lisi,wangwu,zhaoliu",
      "<role>",
      "",
      "audit.level=detail",
      "audit.keepDays=30",
      "notify.webhook=https://sit.example.internal/config/review-v2",
      "notify.onDiffTooLarge=true",
      "notify.owner=finagent-sit",
      "notify.dingTalkKeyword=SIT版本比对",
      ""
    ].join("\n");
    const sitPath = "configs/sit/finagent-tob-sit/version-compare-demo.properties";
    await writeFile(path.join(repoPath, "templates/aaa"), `${aaaFragment}\n`, "utf8");
    await writeFile(path.join(repoPath, sitPath), sitContent, "utf8");
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
    await writeFile(
      path.join(repoPath, "configs/dev/nested/target_prompt_cn"),
      "<role><role><role>111</role>",
      "utf8"
    );
    await writeFile(
      path.join(repoPath, "configs/dev/nested/citation_prompt_cn"),
      "说明 <citation_rules> 的用途\n<citation_rules>\n旧引用规则\n</citation_rules>\n继续说明 <citation_rules> 标签\n",
      "utf8"
    );
    await writeFile(
      path.join(repoPath, "configs/uat/tob-uat/customer_prompt_cn"),
      `<role>protected role</role>\n`,
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
        allowedExtensions: ["", ".xml", ".txt", ".properties"],
        auth: { username: "", password: "" },
        commitMessagePrefix: "config: ",
        cloneOnStart: false,
        environments: [
          {
            id: "templates",
            tenantId: "config",
            label: "提示词片段",
            root: "templates",
            requiresAdminToEdit: true,
            kind: "fragment-library"
          },
          {
            id: "dev",
            tenantId: "config",
            label: "开发环境",
            root: "configs/dev",
            requiresAdminToEdit: false,
            kind: "config"
          },
          {
            id: "sit",
            tenantId: "config",
            label: "SIT环境",
            root: "configs/sit",
            requiresAdminToEdit: false,
            kind: "config"
          },
          {
            id: "uat",
            tenantId: "config",
            label: "UAT环境",
            root: "configs/uat",
            requiresAdminToEdit: true,
            kind: "config"
          }
        ]
      }
    };

    for (const relativePath of ['bad"role.xml', "CON.xml", "dir\\role.xml"]) {
      await assert.rejects(
        createPromptFragmentFile(config, { environmentId: "templates", relativePath, tagName: "role" }),
        /Windows/
      );
    }
    await assert.rejects(
      renamePromptFragmentFile(config, {
        path: "templates/financial-role.xml",
        relativePath: "NUL.xml"
      }),
      /Windows/
    );

    assert.equal(
      getEnvironmentOptions(config).find((item) => item.id === "templates")?.requiresAdminToEdit,
      false
    );
    await assert.rejects(
      createPromptFragmentBatchPreview(config, {
        sourcePath: "templates/financial-role.xml",
        environmentIds: ["uat"],
        pattern: "/tob-uat/customer_prompt_cn",
        actor: { id: "user", role: "user" }
      }),
      (error: Error & { statusCode?: number }) =>
        error.statusCode === 403 && /不需要管理员权限/.test(error.message)
    );
    const adminPreview = await createPromptFragmentBatchPreview(config, {
      sourcePath: "templates/financial-role.xml",
      environmentIds: ["uat"],
      pattern: "/tob-uat/customer_prompt_cn",
      actor: { id: "admin", role: "admin" }
    });
    assert.equal(adminPreview.changedCount, 1);

    const preview = await createPromptFragmentBatchPreview(config, {
      sourcePath: "templates/financial-role.xml",
      environmentIds: ["dev"],
      pattern: "/tob-uat/*_prompt_cn"
    });
    assert.equal(preview.tagName, "role");
    assert.equal(preview.matchedCount, 3);
    assert.equal(preview.changedCount, 1);
    assert.equal(preview.missingCount, 1);
    assert.equal(preview.errorCount, 1);
    assert.equal(preview.canApply, true);

    const errorOnlyPreview = await createPromptFragmentBatchPreview(config, {
      sourcePath: "templates/financial-role.xml",
      environmentIds: ["dev"],
      pattern: "/tob-uat/duplicate_prompt_cn"
    });
    assert.equal(errorOnlyPreview.errorCount, 1);
    assert.equal(errorOnlyPreview.changedCount, 0);
    assert.equal(errorOnlyPreview.canApply, false);

    const selectedPath = preview.items.find((item) => item.status === "changed")!.path;
    const headBeforeApply = git(repoPath, "rev-parse", "HEAD");
    for (const item of preview.items.filter((item) => item.status !== "changed")) {
      for (const selectedPaths of [[item.path], [selectedPath, item.path]]) {
        await assert.rejects(
          applyPromptFragmentBatch(config, {
            sourcePath: preview.sourcePath,
            environmentIds: preview.environmentIds,
            pattern: preview.pattern,
            baseHead: preview.baseHead,
            selectedPaths,
            message: "不能提交不可替换文件"
          }),
          /可替换文件/
        );
      }
    }
    assert.equal(git(repoPath, "rev-parse", "HEAD"), headBeforeApply);
    assert.equal(git(remotePath, "rev-parse", "refs/heads/main"), headBeforeApply);
    assert.equal(git(repoPath, "status", "--porcelain"), "");
    await writeFile(path.join(repoPath, "local-draft.txt"), "unrelated local draft\n", "utf8");
    const result = await applyPromptFragmentBatch(config, {
      sourcePath: preview.sourcePath,
      environmentIds: preview.environmentIds,
      pattern: preview.pattern,
      baseHead: preview.baseHead,
      selectedPaths: [selectedPath],
      message: "更新金融顾问角色",
      actor: { id: "user", role: "user" }
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
    assert.equal(git(repoPath, "rev-list", "--count", `${headBeforeApply}..HEAD`), "1");
    assert.equal(git(repoPath, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"), selectedPath);
    for (const item of preview.items.filter((item) => item.status !== "changed")) {
      assert.equal(git(repoPath, "diff", headBeforeApply, "HEAD", "--", item.path), "");
    }

    const noChangesPreview = await createPromptFragmentBatchPreview(config, {
      sourcePath: preview.sourcePath,
      environmentIds: preview.environmentIds,
      pattern: preview.pattern
    });
    assert.equal(noChangesPreview.changedCount, 0);
    assert.equal(noChangesPreview.unchangedCount, 1);
    assert.equal(noChangesPreview.errorCount, 1);
    assert.equal(noChangesPreview.canApply, false);
    await assert.rejects(
      applyPromptFragmentBatch(config, {
        sourcePath: noChangesPreview.sourcePath,
        environmentIds: noChangesPreview.environmentIds,
        pattern: noChangesPreview.pattern,
        baseHead: noChangesPreview.baseHead,
        selectedPaths: [selectedPath],
        message: "不能提交内容相同的文件"
      }),
      /可替换文件/
    );

    const nestedPreview = await createPromptFragmentBatchPreview(config, {
      sourcePath: "templates/financial-role.xml",
      environmentIds: ["dev"],
      pattern: "/nested/target_prompt_cn"
    });
    assert.equal(nestedPreview.errorCount, 0);
    assert.equal(nestedPreview.changedCount, 1);
    assert.equal(nestedPreview.items[0].afterContent, "<role><role><role desc=\"金融顾问\">\nnew role\n</role>");
    await applyPromptFragmentBatch(config, {
      sourcePath: nestedPreview.sourcePath,
      environmentIds: nestedPreview.environmentIds,
      pattern: nestedPreview.pattern,
      baseHead: nestedPreview.baseHead,
      selectedPaths: [nestedPreview.items[0].path],
      message: "替换未闭合外层中的片段"
    });
    assert.equal(
      git(remotePath, "show", "refs/heads/main:configs/dev/nested/target_prompt_cn"),
      nestedPreview.items[0].afterContent
    );

    const citationPreview = await createPromptFragmentBatchPreview(config, {
      sourcePath: "templates/citation-rules.xml",
      environmentIds: ["dev"],
      pattern: "/nested/citation_prompt_cn"
    });
    assert.equal(citationPreview.errorCount, 0);
    assert.equal(citationPreview.changedCount, 1);
    assert.equal(
      citationPreview.items[0].afterContent,
      "说明 <citation_rules> 的用途\n<citation_rules>\n新引用规则\n</citation_rules>\n继续说明 <citation_rules> 标签\n"
    );
    await applyPromptFragmentBatch(config, {
      sourcePath: citationPreview.sourcePath,
      environmentIds: citationPreview.environmentIds,
      pattern: citationPreview.pattern,
      baseHead: citationPreview.baseHead,
      selectedPaths: [citationPreview.items[0].path],
      message: "更新引用规则"
    });
    assert.equal(
      git(remotePath, "show", "refs/heads/main:configs/dev/nested/citation_prompt_cn"),
      citationPreview.items[0].afterContent.trim()
    );

    const sitPreview = await createPromptFragmentBatchPreview(config, {
      sourcePath: "templates/aaa",
      environmentIds: ["sit"],
      pattern: "**/version-compare-demo.properties"
    });
    const expectedSitContent = sitContent.replace(sitRole, "  <role>\n    <test></test>\n  </role>");
    assert.equal(sitPreview.matchedCount, 1);
    assert.equal(sitPreview.changedCount, 1);
    assert.equal(sitPreview.errorCount, 0);
    assert.equal(sitPreview.canApply, true);
    assert.equal(sitPreview.items[0].afterContent, expectedSitContent);
    const beforeSitHead = git(repoPath, "rev-parse", "HEAD");
    await applyPromptFragmentBatch(config, {
      sourcePath: sitPreview.sourcePath,
      environmentIds: sitPreview.environmentIds,
      pattern: sitPreview.pattern,
      baseHead: sitPreview.baseHead,
      selectedPaths: [sitPath],
      message: "使用 aaa 替换 SIT 角色片段"
    });
    assert.equal(await readFile(path.join(repoPath, sitPath), "utf8"), expectedSitContent);
    assert.equal(git(remotePath, "show", `refs/heads/main:${sitPath}`), expectedSitContent.trim());
    assert.equal(git(repoPath, "rev-list", "--count", `${beforeSitHead}..HEAD`), "1");
    assert.equal(git(repoPath, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"), sitPath);

    const fragmentPath = "templates/financial-role.xml";
    const malformedInnerXml = "<role><b></role>\n";
    await commitAndPushFile(config, { lastSyncedAt: null }, {
      path: fragmentPath,
      content: malformedInnerXml,
      message: "更新片段内容",
      baseHead: git(repoPath, "rev-parse", "HEAD"),
      baseBlob: git(repoPath, "rev-parse", `HEAD:${fragmentPath}`),
      actor: { id: "user", role: "user" }
    });
    assert.equal(git(remotePath, "show", `refs/heads/main:${fragmentPath}`), malformedInnerXml.trim());
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
