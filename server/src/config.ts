import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type {
  AppConfig,
  GitSettingsSummary,
  RepoEnvironmentOption,
  RepoTenantOption,
  RuntimeState
} from "./types";

export const PROJECT_ROOT = path.resolve(__dirname, "../..");
const APP_CONFIG_PATH = path.resolve(PROJECT_ROOT, "data/app.config.json");
const RUNTIME_STATE_PATH = path.resolve(PROJECT_ROOT, "data/runtime.json");
const DEFAULT_CONFIG_ROOT = "nacos-config/config";
const DEFAULT_REMOTE_URL = "http://12.103.118.207:10880/AI/aifp-config-tob.git";
const DEFAULT_BRANCH = "main";
const DEFAULT_TENANT_ID = "config";
const DEFAULT_TENANTS: RepoTenantOption[] = [
  {
    id: DEFAULT_TENANT_ID,
    label: "config",
    root: DEFAULT_CONFIG_ROOT
  }
];
const DEFAULT_ENVIRONMENTS: RepoEnvironmentOption[] = [
  {
    id: "dev",
    tenantId: DEFAULT_TENANT_ID,
    label: "开发环境",
    root: `${DEFAULT_CONFIG_ROOT}/dev`,
    requiresAdminToEdit: false,
    kind: "config"
  },
  {
    id: "sit",
    tenantId: DEFAULT_TENANT_ID,
    label: "SIT环境",
    root: `${DEFAULT_CONFIG_ROOT}/sit`,
    requiresAdminToEdit: false,
    kind: "config"
  },
  {
    id: "uat",
    tenantId: DEFAULT_TENANT_ID,
    label: "UAT环境",
    root: `${DEFAULT_CONFIG_ROOT}/uat`,
    requiresAdminToEdit: true,
    kind: "config"
  }
];

const DEFAULT_APP_CONFIG: AppConfig = {
  server: {
    port: 8090
  },
  repo: {
    localPath: "./data/repo",
    remoteUrl: DEFAULT_REMOTE_URL,
    branch: DEFAULT_BRANCH,
    configRoot: DEFAULT_CONFIG_ROOT,
    allowedExtensions: [
      "",
      ".json",
      ".yaml",
      ".yml",
      ".toml",
      ".ini",
      ".conf",
      ".properties",
      ".env",
      ".xml",
      ".txt",
      ".md"
    ],
    auth: {
      username: "rhb",
      password: "nbcb,111"
    },
    tenants: DEFAULT_TENANTS,
    commitMessagePrefix: "config: ",
    cloneOnStart: true
  }
};

const DEFAULT_RUNTIME_STATE: RuntimeState = {
  lastSyncedAt: null
};

async function ensureParent(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    await ensureParent(filePath);
    await writeFile(filePath, JSON.stringify(fallback, null, 2), "utf8");
    return fallback;
  }
}

function normalizeRoot(root: string): string {
  return root.trim().replace(/^\/+|\/+$/g, "");
}

export function isEnvironmentRootWithinTenant(environmentRoot: string, tenantRoot: string): boolean {
  if (environmentRoot.includes("\\") || !environmentRoot.startsWith(`${tenantRoot}/`)) {
    return false;
  }
  const suffix = environmentRoot.slice(tenantRoot.length + 1);
  return Boolean(suffix) && suffix.split("/").every(
    (segment) => segment && segment !== "." && segment !== ".."
  );
}

function getDefaultEnvironmentRoots(configRoot: string): RepoEnvironmentOption[] {
  const normalizedConfigRoot = normalizeRoot(configRoot || DEFAULT_CONFIG_ROOT);
  return DEFAULT_ENVIRONMENTS.map((item) => ({
    ...item,
    root: normalizedConfigRoot ? `${normalizedConfigRoot}/${item.id}` : item.root
  }));
}

function createOptionId(value: string, fallback: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

function normalizeTenantOptions(
  rawTenants: RepoTenantOption[] | undefined,
  configRoot: string
): RepoTenantOption[] {
  const normalizedConfigRoot = normalizeRoot(configRoot || DEFAULT_CONFIG_ROOT);
  const inferredId = createOptionId(path.posix.basename(normalizedConfigRoot), DEFAULT_TENANT_ID);
  const source = rawTenants?.length
    ? rawTenants
    : [{ id: inferredId, label: inferredId, root: normalizedConfigRoot }];
  const seenIds = new Set<string>();

  return source
    .map((item, index) => {
      const baseId = createOptionId(String(item.id || item.label || ""), `tenant-${index + 1}`);
      const id = seenIds.has(baseId) ? `tenant-${index + 1}` : baseId;
      seenIds.add(id);
      return {
        id,
        label: String(item.label || id).trim(),
        root: normalizeRoot(String(item.root || ""))
      };
    })
    .filter((item) => item.label && item.root);
}

function normalizeEnvironmentOptions(
  rawEnvironments: RepoEnvironmentOption[] | undefined,
  configRoot: string,
  tenants: RepoTenantOption[]
): RepoEnvironmentOption[] {
  const source = rawEnvironments?.length
    ? rawEnvironments
    : getDefaultEnvironmentRoots(configRoot);
  const seenIds = new Set<string>();

  return source
    .map((item, index) => {
      const fallback = DEFAULT_ENVIRONMENTS[index] ?? DEFAULT_ENVIRONMENTS[0];
      const id = String(item.id || fallback.id || `env-${index + 1}`)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const uniqueId = id && !seenIds.has(id) ? id : `env-${index + 1}`;
      seenIds.add(uniqueId);
      const kind: RepoEnvironmentOption["kind"] =
        item.kind === "fragment-library" ? "fragment-library" : "config";
      const root = normalizeRoot(String(item.root || fallback.root || ""));
      const requestedTenantId = String(item.tenantId || "").trim();
      const tenant = tenants.find((candidate) => candidate.id === requestedTenantId) ??
        tenants.find(
          (candidate) => root === candidate.root || root.startsWith(`${candidate.root}/`)
        ) ?? tenants[0];
      return {
        id: uniqueId,
        tenantId: tenant?.id ?? DEFAULT_TENANT_ID,
        label: String(item.label || fallback.label || uniqueId).trim(),
        root,
        requiresAdminToEdit: kind === "fragment-library" ? false : Boolean(item.requiresAdminToEdit),
        kind
      };
    })
    .filter((item) => item.label && item.root);
}

function normalizeAppConfig(rawConfig: AppConfig): AppConfig {
  const remoteUrl = rawConfig.repo?.remoteUrl || DEFAULT_APP_CONFIG.repo.remoteUrl;
  const branch = rawConfig.repo?.branch || DEFAULT_APP_CONFIG.repo.branch;
  const configRoot = rawConfig.repo?.configRoot || DEFAULT_APP_CONFIG.repo.configRoot || DEFAULT_CONFIG_ROOT;
  const tenants = normalizeTenantOptions(rawConfig.repo?.tenants, configRoot);
  return {
    server: {
      port: rawConfig.server?.port || DEFAULT_APP_CONFIG.server.port
    },
    repo: {
      localPath: rawConfig.repo?.localPath || DEFAULT_APP_CONFIG.repo.localPath,
      remoteUrl,
      branch,
      configRoot,
      visibleRoots: rawConfig.repo?.visibleRoots,
      allowedExtensions:
        rawConfig.repo?.allowedExtensions?.length
          ? rawConfig.repo.allowedExtensions
          : DEFAULT_APP_CONFIG.repo.allowedExtensions,
      auth: {
        username: rawConfig.repo?.auth?.username || DEFAULT_APP_CONFIG.repo.auth.username,
        password: rawConfig.repo?.auth?.password || DEFAULT_APP_CONFIG.repo.auth.password
      },
      tenants,
      environments: normalizeEnvironmentOptions(
        rawConfig.repo?.environments,
        configRoot,
        tenants
      ),
      commitMessagePrefix:
        rawConfig.repo?.commitMessagePrefix ?? DEFAULT_APP_CONFIG.repo.commitMessagePrefix,
      cloneOnStart: rawConfig.repo?.cloneOnStart ?? DEFAULT_APP_CONFIG.repo.cloneOnStart
    }
  };
}

export async function loadAppConfig(): Promise<AppConfig> {
  const config = await readJsonFile(APP_CONFIG_PATH, DEFAULT_APP_CONFIG);
  return normalizeAppConfig(config);
}

export async function loadRuntimeState(): Promise<RuntimeState> {
  return readJsonFile(RUNTIME_STATE_PATH, DEFAULT_RUNTIME_STATE);
}

export async function saveRuntimeState(state: RuntimeState): Promise<RuntimeState> {
  await ensureParent(RUNTIME_STATE_PATH);
  await writeFile(RUNTIME_STATE_PATH, JSON.stringify(state, null, 2), "utf8");
  return state;
}

export async function saveAppConfig(config: AppConfig): Promise<AppConfig> {
  const normalizedConfig = normalizeAppConfig(config);
  await ensureParent(APP_CONFIG_PATH);
  await writeFile(APP_CONFIG_PATH, JSON.stringify(normalizedConfig, null, 2), "utf8");
  return normalizedConfig;
}

export async function updateCommitMessagePrefix(prefix: string): Promise<AppConfig> {
  const current = await loadAppConfig();
  const next: AppConfig = {
    ...current,
    repo: {
      ...current.repo,
      commitMessagePrefix: prefix
    }
  };
  return saveAppConfig(next);
}

export async function updateEnvironmentOptions(
  environments: RepoEnvironmentOption[]
): Promise<AppConfig> {
  const current = await loadAppConfig();
  const tenants = getTenantOptions(current);
  const normalizedEnvironments = normalizeEnvironmentOptions(
    environments,
    current.repo.configRoot || DEFAULT_CONFIG_ROOT,
    tenants
  );
  if (!normalizedEnvironments.length) {
    throw new Error("至少需要保留一个环境配置");
  }

  return saveAppConfig({
    ...current,
    repo: {
      ...current.repo,
      environments: normalizedEnvironments,
      visibleRoots: normalizedEnvironments.map((item) => item.root)
    }
  });
}

export async function updateTenantEnvironmentOptions(
  tenants: RepoTenantOption[],
  environments: RepoEnvironmentOption[]
): Promise<AppConfig> {
  const current = await loadAppConfig();
  const normalizedTenants = normalizeTenantOptions(
    tenants,
    current.repo.configRoot || DEFAULT_CONFIG_ROOT
  );
  if (!normalizedTenants.length) {
    throw new Error("至少需要保留一个租户配置");
  }
  const normalizedEnvironments = normalizeEnvironmentOptions(
    environments,
    current.repo.configRoot || DEFAULT_CONFIG_ROOT,
    normalizedTenants
  );
  if (!normalizedEnvironments.length) {
    throw new Error("至少需要保留一个环境配置");
  }
  const tenantIds = new Set(normalizedTenants.map((item) => item.id));
  if (normalizedEnvironments.some((item) => !tenantIds.has(item.tenantId))) {
    throw new Error("环境必须关联有效租户");
  }
  if (normalizedTenants.some(
    (tenant) => !normalizedEnvironments.some((environment) => environment.tenantId === tenant.id)
  )) {
    throw new Error("每个租户至少需要配置一个环境");
  }
  const tenantsById = new Map(normalizedTenants.map((item) => [item.id, item]));
  if (normalizedEnvironments.some((environment) => {
    const tenant = tenantsById.get(environment.tenantId);
    return !tenant || !isEnvironmentRootWithinTenant(environment.root, tenant.root);
  })) {
    throw new Error("环境路径必须是租户目录下的有效相对路径");
  }

  return saveAppConfig({
    ...current,
    repo: {
      ...current.repo,
      tenants: normalizedTenants,
      environments: normalizedEnvironments,
      visibleRoots: normalizedEnvironments.map((item) => item.root)
    }
  });
}

export async function markLastSyncedAt(timestamp: string): Promise<RuntimeState> {
  const current = await loadRuntimeState();
  current.lastSyncedAt = timestamp;
  return saveRuntimeState(current);
}

export function resolveRepoPath(config: AppConfig): string {
  return path.resolve(PROJECT_ROOT, config.repo.localPath);
}

export function normalizeVisibleRoots(config: AppConfig): string[] {
  const rawRoots = config.repo.visibleRoots?.length
    ? config.repo.visibleRoots
    : getEnvironmentOptions(config).map((item) => item.root);

  return rawRoots
    .map((item) => item.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);
}

export function getEnvironmentOptions(config: AppConfig): RepoEnvironmentOption[] {
  const tenants = getTenantOptions(config);
  return normalizeEnvironmentOptions(
    config.repo.environments,
    config.repo.configRoot || DEFAULT_CONFIG_ROOT,
    tenants
  );
}

export function getTenantOptions(config: AppConfig): RepoTenantOption[] {
  return normalizeTenantOptions(
    config.repo.tenants,
    config.repo.configRoot || DEFAULT_CONFIG_ROOT
  );
}

export function toGitSettingsSummary(config: AppConfig): GitSettingsSummary {
  return {
    commitMessagePrefix: config.repo.commitMessagePrefix || ""
  };
}
