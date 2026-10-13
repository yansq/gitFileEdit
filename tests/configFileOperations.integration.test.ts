import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createConfigFile,
  deleteConfigFile,
  readFileDetail,
  renameConfigFile
} from "../server/src/git";
import type { AppConfig } from "../server/src/types";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

test("普通配置文件可以创建、重命名和删除并推送", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "git-file-edit-config-files-"));
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
    await mkdir(path.join(repoPath, "nacos-config/config/dev"), { recursive: true });
    await writeFile(path.join(repoPath, "nacos-config/config/dev/existing.properties"), "a=1\n");
    git(repoPath, "add", ".");
    git(repoPath, "commit", "-m", "initial");
    git(repoPath, "push", "-u", "origin", "main");

    const config: AppConfig = {
      server: { port: 0 },
      repo: {
        localPath: repoPath,
        remoteUrl: remotePath,
        branch: "main",
        allowedExtensions: ["", ".json", ".properties"],
        auth: { username: "", password: "" },
        tenants: [{ id: "config", label: "config", root: "nacos-config/config" }],
        environments: [{
          id: "dev",
          tenantId: "config",
          label: "开发环境",
          root: "nacos-config/config/dev",
          requiresAdminToEdit: false,
          kind: "config"
        }],
        commitMessagePrefix: "config: ",
        cloneOnStart: false
      }
    };

    await assert.rejects(
      createConfigFile(config, { environmentId: "dev", relativePath: "../outside.json" }),
      /有效文件路径/
    );
    for (const relativePath of [
      'bad"name.json', "dir:bad/file.json", "bad*.json", "bad?.json",
      "bad<.json", "bad>.json", "bad|.json", "dir\\file.json",
      "CON.json", "folder/NUL.properties", "folder./file.json", "file.json ",
      "bad\u0001name.json"
    ]) {
      await assert.rejects(
        createConfigFile(config, { environmentId: "dev", relativePath }),
        /Windows|空格或句点/
      );
    }
    await assert.rejects(
      createConfigFile(config, { environmentId: "dev", relativePath: 'bad"name.json' }),
      (error: Error & { statusCode?: number }) => error.statusCode === 400
    );
    await assert.rejects(
      renameConfigFile(config, {
        path: "nacos-config/config/dev/existing.properties",
        relativePath: 'bad"name.properties'
      }),
      /Windows/
    );
    await assert.rejects(
      renameConfigFile(config, {
        path: "nacos-config/config/dev/version-review-routing",
        relativePath: "version-review-routing-renamed"
      }),
      /来源配置文件不存在/
    );
    await assert.rejects(
      readFileDetail(config, "nacos-config/config/dev/version-review-routing"),
      /文件不存在或已被重命名/
    );
    await assert.rejects(
      renameConfigFile(config, {
        path: "nacos-config/config/dev/existing.properties",
        relativePath: "existing.json"
      }),
      /JSON 格式错误/
    );

    const created = await createConfigFile(config, {
      environmentId: "dev",
      relativePath: "service/new.json",
      actor: { id: "张三", role: "user" }
    });
    assert.equal(created.path, "nacos-config/config/dev/service/new.json");
    assert.equal(await readFile(path.join(repoPath, created.path), "utf8"), "{}\n");
    assert.match(git(repoPath, "log", "-1", "--format=%s"), /新建配置文件 service\/new\.json/);

    const renamed = await renameConfigFile(config, {
      path: created.path,
      relativePath: "service/renamed.json",
      actor: { id: "张三", role: "user" }
    });
    assert.equal(renamed.path, "nacos-config/config/dev/service/renamed.json");
    assert.match(git(repoPath, "log", "-1", "--format=%s"), /重命名配置文件 service\/renamed\.json/);

    await deleteConfigFile(config, {
      path: renamed.path,
      actor: { id: "张三", role: "user" }
    });
    assert.match(git(repoPath, "log", "-1", "--format=%s"), /删除配置文件 renamed\.json/);
    assert.equal(git(repoPath, "rev-parse", "HEAD"), git(remotePath, "rev-parse", "refs/heads/main"));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
