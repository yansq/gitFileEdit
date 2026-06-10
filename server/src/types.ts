export interface AppConfig {
  server: {
    port: number;
  };
  repo: {
    localPath: string;
    remoteUrl: string;
    branch: string;
    defaultFile: string;
    visibleRoots: string[];
    allowedExtensions: string[];
    cloneOnStart: boolean;
  };
}

export interface RuntimeGitSettings {
  username: string;
  email: string;
  password: string;
  defaultCommitMessage: string;
}

export interface RuntimeState {
  git: RuntimeGitSettings;
  lastSyncedAt: string | null;
}

export interface RepoFileSummary {
  path: string;
  size: number;
  modifiedAt: string;
}

export interface RepoStatus {
  ready: boolean;
  exists: boolean;
  repoPath: string;
  remoteUrl: string;
  branch: string;
  defaultFile: string;
  currentBranch: string | null;
  head: string | null;
  lastError: string | null;
  lastSyncedAt: string | null;
}

export interface CommitSnapshot {
  hash: string;
  authorName: string;
  authorEmail: string;
  committedAt: string;
  message: string;
  beforeContent: string;
  afterContent: string;
}

export interface FileDetail {
  path: string;
  content: string;
  headContent: string;
  isDirty: boolean;
  modifiedAt: string;
  lastCommit: CommitSnapshot | null;
}

export interface GitSettingsSummary {
  username: string;
  email: string;
  defaultCommitMessage: string;
  hasPassword: boolean;
}
