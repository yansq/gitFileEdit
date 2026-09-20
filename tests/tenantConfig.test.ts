import assert from "node:assert/strict";
import test from "node:test";
import {
  getEnvironmentOptions,
  getTenantOptions,
  isEnvironmentRootWithinTenant
} from "../server/src/config";
import type { AppConfig } from "../server/src/types";

function createBaseConfig(repo: AppConfig["repo"]): AppConfig {
  return { server: { port: 0 }, repo };
}

test("旧环境配置自动归入 configRoot 对应的默认租户", () => {
  const config = createBaseConfig({
    localPath: "./repo",
    remoteUrl: "./remote.git",
    branch: "main",
    configRoot: "nacos-config/config",
    allowedExtensions: [".yaml"],
    auth: { username: "", password: "" },
    environments: [
      {
        id: "dev",
        label: "开发环境",
        root: "nacos-config/config/dev",
        requiresAdminToEdit: false,
        kind: "config"
      }
    ] as AppConfig["repo"]["environments"],
    commitMessagePrefix: "",
    cloneOnStart: false
  });

  assert.deepEqual(getTenantOptions(config), [
    { id: "config", label: "config", root: "nacos-config/config" }
  ]);
  assert.equal(getEnvironmentOptions(config)[0]?.tenantId, "config");
});

test("不同租户保留各自的环境归属和目录", () => {
  const config = createBaseConfig({
    localPath: "./repo",
    remoteUrl: "./remote.git",
    branch: "main",
    allowedExtensions: [".yaml"],
    auth: { username: "", password: "" },
    tenants: [
      { id: "config", label: "config", root: "nacos-config/config" },
      { id: "lite", label: "lite", root: "nacos-config/lite" }
    ],
    environments: [
      { id: "config-dev", tenantId: "config", label: "dev", root: "nacos-config/config/dev", requiresAdminToEdit: false, kind: "config" },
      { id: "lite-sit", tenantId: "lite", label: "sit", root: "nacos-config/lite/sit", requiresAdminToEdit: false, kind: "config" }
    ],
    commitMessagePrefix: "",
    cloneOnStart: false
  });

  assert.deepEqual(
    getEnvironmentOptions(config).map(({ id, tenantId, root }) => ({ id, tenantId, root })),
    [
      { id: "config-dev", tenantId: "config", root: "nacos-config/config/dev" },
      { id: "lite-sit", tenantId: "lite", root: "nacos-config/lite/sit" }
    ]
  );
});

test("环境路径只能使用租户目录后的有效相对路径", () => {
  assert.equal(
    isEnvironmentRootWithinTenant("nacos-config/config/dev", "nacos-config/config"),
    true
  );
  assert.equal(
    isEnvironmentRootWithinTenant("nacos-config/config", "nacos-config/config"),
    false
  );
  assert.equal(
    isEnvironmentRootWithinTenant("nacos-config/config/../lite", "nacos-config/config"),
    false
  );
  assert.equal(
    isEnvironmentRootWithinTenant("nacos-config/lite/sit", "nacos-config/config"),
    false
  );
});
