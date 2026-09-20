export interface WorkspacePreference {
  tenantId: string;
  environmentId: string;
}

const storageKeyPrefix = "git-file-edit:workspace-selection:";

function getStorageKey(userId: string): string {
  return `${storageKeyPrefix}${encodeURIComponent(userId)}`;
}

export function readWorkspacePreference(userId: string): WorkspacePreference | null {
  try {
    const rawValue = window.localStorage.getItem(getStorageKey(userId));
    if (!rawValue) return null;
    const value = JSON.parse(rawValue) as Partial<WorkspacePreference>;
    if (typeof value.tenantId !== "string" || typeof value.environmentId !== "string") {
      return null;
    }
    return { tenantId: value.tenantId, environmentId: value.environmentId };
  } catch {
    return null;
  }
}

export function writeWorkspacePreference(
  userId: string,
  preference: WorkspacePreference,
): void {
  try {
    window.localStorage.setItem(getStorageKey(userId), JSON.stringify(preference));
  } catch {
    // 浏览器禁用本地存储时继续使用当前会话状态。
  }
}
