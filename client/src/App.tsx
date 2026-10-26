import { EditorSelection } from "@codemirror/state";
import { goToNextChunk, goToPreviousChunk } from "@codemirror/merge";
import type { EditorView } from "@codemirror/view";
import {
  startTransition,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { AuthScreen } from "./components/AuthScreen";
import { CommitConfirmDialog } from "./components/CommitConfirmDialog";
import { ChangelogDialog } from "./components/ChangelogDialog";
import { ConfigFileDialog } from "./components/ConfigFileDialog";
import { FilePromotionDialog } from "./components/FilePromotionDialog";
import { EnvironmentSwitcher } from "./components/EnvironmentSwitcher";
import { TenantSwitcher } from "./components/TenantSwitcher";
import { FileTree } from "./components/FileTree";
import { PromptFragmentBatchDialog } from "./components/PromptFragmentBatchDialog";
import { PromptFragmentFileDialog } from "./components/PromptFragmentFileDialog";
import { ToastStack } from "./components/ToastStack";
import { Badge, Button, IconButton, Modal, SegmentedControl } from "./components/ui";
import { useAuthSession } from "./features/auth/useAuthSession";
import { useFileEditor, validateEditorContent } from "./features/editor/useFileEditor";
import { useFileHistory } from "./features/history/useFileHistory";
import { useRepositoryReview } from "./features/review/useRepositoryReview";
import { ApiRequestError, requestJson } from "./lib/api";
import { buildFileTree, getPathWithinRoot, replaceEnvironmentRoot } from "./lib/filePaths";
import { formatTime, formatXml, getCommitSubject } from "./lib/format";
import { applyReplayPatch, createReplayPatch } from "./lib/replayPatch";
import {
  readWorkspacePreference,
  writeWorkspacePreference,
} from "./lib/workspacePreference";
import {
  cn,
  editorSurfaceHeightClass,
  emptyBlockClass,
  formLabelClass,
  formRowClass,
  inputClass,
  panelTitleRowClass,
  workspaceWindowClass,
} from "./lib/ui";
import type {
  BootstrapResponse,
  CommitSnapshot,
  FileConflictPayload,
  FileDetail,
  RepoEnvironmentOption,
  RepoFileSummary,
  RepoTenantOption,
} from "./types";

interface EnvironmentSettingsResponse {
  tenants: RepoTenantOption[];
  environments: RepoEnvironmentOption[];
}

interface FileValidationPayload {
  type: "file_validation";
  fileType: string;
  message: string;
}

interface PendingReplay {
  hash: string;
  sourcePath: string;
  patch: string;
}

type MainView = "review" | "workspace";
type HeaderPopover = "account" | "repository" | null;
type ActiveDialog =
  | { type: "activation" }
  | { type: "changelog" }
  | { type: "commit" }
  | { type: "environment-settings" }
  | { type: "fragment-batch" }
  | { type: "file-promotion"; sourcePath: string }
  | { type: "config-file"; mode: "create" }
  | { type: "config-file"; mode: "rename"; path: string }
  | { type: "fragment-file"; mode: "create" | "rename" }
  | null;

const fileListMinWidth = 260;
const fileListDefaultWidth = 320;
const fileListMaxWidth = 560;
const mainContentMinWidth = 520;
const searchFieldShellClass =
  "flex min-h-9 min-w-0 items-center gap-ui-2 rounded-ui-md border border-ui-border bg-surface px-ui-3 shadow-ui-xs transition-[border-color,box-shadow] duration-ui-normal focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 motion-reduce:transition-none";
const searchFieldInputClass =
  "h-8 min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-normal text-foreground outline-none placeholder:text-subtle-foreground";
const searchShortcutClass =
  "shrink-0 rounded-ui-xs border border-ui-border bg-surface-subtle px-1.5 py-0.5 font-sans text-[10px] font-medium leading-none text-subtle-foreground";
const shortcutModifier =
  typeof navigator !== "undefined" && navigator.platform.toLocaleLowerCase().includes("mac")
    ? "⌘"
    : "Ctrl";
const ConfigEditor = lazy(async () => ({
  default: (await import("./components/ConfigEditor")).ConfigEditor,
}));
const DiffView = lazy(async () => ({
  default: (await import("./components/DiffView")).DiffView,
}));
const MergeConfigEditor = lazy(async () => ({
  default: (await import("./components/MergeConfigEditor")).MergeConfigEditor,
}));

function LazyDiffView(props: ComponentProps<typeof DiffView>): JSX.Element {
  return (
    <Suspense
      fallback={<div className={cn(emptyBlockClass, props.className)}>正在加载差异预览...</div>}
    >
      <DiffView {...props} />
    </Suspense>
  );
}

function LazyConfigEditor(props: ComponentProps<typeof ConfigEditor>): JSX.Element {
  return (
    <Suspense
      fallback={<div className="h-full p-4 text-sm text-muted-foreground">正在加载编辑器...</div>}
    >
      <ConfigEditor {...props} />
    </Suspense>
  );
}

function LazyMergeConfigEditor(props: ComponentProps<typeof MergeConfigEditor>): JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="h-full p-4 text-sm text-muted-foreground">正在加载差异编辑器...</div>
      }
    >
      <MergeConfigEditor {...props} />
    </Suspense>
  );
}

function SearchIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0 text-subtle-foreground"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function ToolbarIconButton({ label, ...props }: ComponentProps<typeof IconButton>): JSX.Element {
  return (
    <span className="group/toolbar-action relative inline-flex">
      <IconButton label={label} {...props} />
      <span
        className="pointer-events-none invisible absolute right-0 top-[calc(100%+8px)] z-40 w-max max-w-56 translate-y-[-2px] rounded-ui-xs bg-foreground px-ui-2 py-ui-1 text-[11px] font-medium leading-4 text-primary-foreground opacity-0 shadow-ui-sm transition-[opacity,transform] duration-ui-fast group-hover/toolbar-action:visible group-hover/toolbar-action:translate-y-0 group-hover/toolbar-action:opacity-100 group-focus-within/toolbar-action:visible group-focus-within/toolbar-action:translate-y-0 group-focus-within/toolbar-action:opacity-100 motion-reduce:transition-none"
        role="tooltip"
      >
        {label}
      </span>
    </span>
  );
}

function UserRoleIcon({ role }: { role: "user" | "admin" }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {role === "admin" ? (
        <>
          <path d="M12 3 19 6v5c0 4.5-2.8 8.2-7 10-4.2-1.8-7-5.5-7-10V6l7-3Z" />
          <circle cx="12" cy="10" r="2" />
          <path d="M8.5 16c.8-1.4 2-2.1 3.5-2.1s2.7.7 3.5 2.1" />
        </>
      ) : (
        <>
          <circle cx="12" cy="8" r="3" />
          <path d="M5.5 20c.8-3.2 3-5 6.5-5s5.7 1.8 6.5 5" />
        </>
      )}
    </svg>
  );
}

interface FileWorkspaceHeaderProps {
  isReadOnly: boolean;
  selectedPath: string;
}

function FileWorkspaceHeader({ isReadOnly, selectedPath }: FileWorkspaceHeaderProps): JSX.Element {
  const pathSegments = selectedPath.split("/").filter(Boolean);
  const fileName = pathSegments.pop() || "请选择文件";

  return (
    <div className="mb-ui-2">
      <nav
        aria-label="当前文件路径"
        className="flex min-w-0 items-center overflow-hidden text-xs text-subtle-foreground"
        title={selectedPath || undefined}
      >
        {pathSegments.length ? (
          pathSegments.map((segment, index) => (
            <span className="flex min-w-0 items-center" key={`${segment}-${index}`}>
              <span className="truncate">{segment}</span>
              <span aria-hidden="true" className="shrink-0 px-0.5 text-ui-border-strong">
                /
              </span>
            </span>
          ))
        ) : (
          <span>尚未选择路径</span>
        )}
      </nav>
      <div className="mt-1.5 flex min-w-0 items-center justify-between gap-ui-4">
        <h2 className="m-0 min-w-0 truncate text-base font-bold text-foreground">{fileName}</h2>
        {isReadOnly ? (
          <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-ui-full bg-warning" />
            只读
          </span>
        ) : null}
      </div>
    </div>
  );
}

interface WorkspaceSectionTabsProps {
  activeSection: "editor" | "history";
  onChange: (section: "editor" | "history") => void;
}

function WorkspaceSectionTabs({ activeSection, onChange }: WorkspaceSectionTabsProps): JSX.Element {
  const items = [
    {
      value: "editor" as const,
      label: "在线编辑",
      icon: (
        <svg
          aria-hidden="true"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          viewBox="0 0 24 24"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      ),
    },
    {
      value: "history" as const,
      label: "文件历史",
      icon: (
        <svg
          aria-hidden="true"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          viewBox="0 0 24 24"
        >
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 3v5h5M12 7v5l3 2" />
        </svg>
      ),
    },
  ];

  return (
    <div
      aria-label="当前文件功能"
      className="mb-ui-2 flex h-10 shrink-0 items-stretch gap-ui-5 border-b border-ui-border"
      role="tablist"
    >
      {items.map((item) => {
        const selected = activeSection === item.value;
        return (
          <button
            aria-controls={`file-${item.value}-panel`}
            aria-selected={selected}
            className={cn(
              "relative inline-flex min-w-[92px] items-center justify-center gap-ui-2 px-ui-1 text-sm font-semibold outline-none transition-colors duration-ui-normal ease-ui-standard focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/25 motion-reduce:transition-none",
              selected ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
            id={`file-${item.value}-tab`}
            key={item.value}
            onClick={() => onChange(item.value)}
            role="tab"
            type="button"
          >
            {item.icon}
            <span>{item.label}</span>
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-x-1 bottom-0 h-0.5 origin-center rounded-t-ui-full transition-transform duration-ui-normal ease-ui-emphasized motion-reduce:transition-none",
                "bg-primary",
                selected ? "scale-x-100" : "scale-x-0",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

function isProtectedEnvironmentId(environmentId: string | undefined): boolean {
  return environmentId === "uat";
}

function createEnvironmentId(label: string, index: number): string {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || `env-${index + 1}`;
}

function getEnvironmentRootSuffix(environmentRoot: string, tenantRoot: string): string {
  const normalizedEnvironmentRoot = environmentRoot.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const normalizedTenantRoot = tenantRoot
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  if (!normalizedTenantRoot) return normalizedEnvironmentRoot.replace(/\/+$/g, "");
  if (normalizedEnvironmentRoot === normalizedTenantRoot) return "";
  if (normalizedEnvironmentRoot.startsWith(`${normalizedTenantRoot}/`)) {
    return normalizedEnvironmentRoot.slice(normalizedTenantRoot.length + 1);
  }
  return normalizedEnvironmentRoot;
}

function buildEnvironmentRoot(tenantRoot: string, suffix: string): string {
  const normalizedTenantRoot = tenantRoot
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  const normalizedSuffix = suffix.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalizedTenantRoot) return normalizedSuffix;
  return normalizedSuffix
    ? `${normalizedTenantRoot}/${normalizedSuffix}`
    : `${normalizedTenantRoot}/`;
}

function isValidEnvironmentRoot(environmentRoot: string, tenantRoot: string): boolean {
  const suffix = getEnvironmentRootSuffix(environmentRoot, tenantRoot).replace(/\/+$/g, "");
  return (
    Boolean(suffix) &&
    suffix.split("/").every((segment) => segment && segment !== "." && segment !== "..")
  );
}

function createBlankEnvironment(
  index: number,
  tenantId: string,
  tenantRoot: string,
): RepoEnvironmentOption {
  return {
    id: `env-${Date.now()}-${index + 1}`,
    tenantId,
    label: "",
    root: tenantRoot ? `${tenantRoot.replace(/^\/+|\/+$/g, "")}/` : "",
    requiresAdminToEdit: false,
    kind: "config",
  };
}

function createBlankTenant(index: number): RepoTenantOption {
  return {
    id: `tenant-${Date.now()}-${index + 1}`,
    label: "",
    root: "",
  };
}

function isFileConflictPayload(value: unknown): value is FileConflictPayload {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "conflict" &&
    typeof (value as { path?: unknown }).path === "string",
  );
}

function isFileValidationPayload(value: unknown): value is FileValidationPayload {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "file_validation" &&
    typeof (value as { message?: unknown }).message === "string",
  );
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export default function App(): JSX.Element {
  const editorSurfaceRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const fileSearchInputRef = useRef<HTMLInputElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [selectedTenant, setSelectedTenant] = useState<string>("");
  const [selectedEnvironment, setSelectedEnvironment] = useState<string>("");
  const [fileQuery, setFileQuery] = useState("");
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [fileDetail, setFileDetail] = useState<FileDetail | null>(null);
  const [activeWorkspaceSection, setActiveWorkspaceSection] = useState<"editor" | "history">(
    "editor",
  );
  const [gitForm, setGitForm] = useState({
    extraMessage: "",
  });
  const [discarding, setDiscarding] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [restoringHash, setRestoringHash] = useState<string | null>(null);
  const [pendingReplay, setPendingReplay] = useState<PendingReplay | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [openHeaderPopover, setOpenHeaderPopover] = useState<HeaderPopover>(null);
  const [fileListWidth, setFileListWidth] = useState(fileListDefaultWidth);
  const [resizingFileList, setResizingFileList] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveNotice, setLiveNotice] = useState<string | null>(null);
  const [mainView, setMainView] = useState<MainView>("workspace");
  const [environmentDraft, setEnvironmentDraft] = useState<RepoEnvironmentOption[]>([]);
  const [tenantDraft, setTenantDraft] = useState<RepoTenantOption[]>([]);
  const [selectedSettingsTenantId, setSelectedSettingsTenantId] = useState("");
  const [savingEnvironmentSettings, setSavingEnvironmentSettings] = useState(false);
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
  const [fragmentFileOperation, setFragmentFileOperation] = useState(false);
  const [configFileOperation, setConfigFileOperation] = useState(false);

  const accountMenuOpen = openHeaderPopover === "account";
  const showRepoDetails = openHeaderPopover === "repository";
  const reviewOpen = mainView === "review";
  const confirmingCommit = activeDialog?.type === "commit";
  const activationDialogOpen = activeDialog?.type === "activation";
  const environmentSettingsDialogOpen = activeDialog?.type === "environment-settings";
  const fragmentBatchOpen = activeDialog?.type === "fragment-batch";
  const configFileDialogMode = activeDialog?.type === "config-file" ? activeDialog.mode : null;
  const fragmentFileDialogMode = activeDialog?.type === "fragment-file" ? activeDialog.mode : null;
  const editorController = useFileEditor({
    active: activeWorkspaceSection === "editor" && !reviewOpen,
    filePath: selectedPath,
  });
  const {
    conflict: fileConflict,
    content: editorContent,
    dirty: editorDirty,
    search: editorSearchController,
    setConflict: setFileConflict,
    setContent: setEditorContent,
    setDirty: setEditorDirty,
    setValidationError: setFileValidationError,
    setViewMode: setEditorViewMode,
    validationError: fileValidationError,
    validationIssue: editorValidationIssue,
    viewMode: editorViewMode,
  } = editorController;
  const files: RepoFileSummary[] = bootstrap?.files ?? [];
  const tenantOptions = bootstrap?.config.tenants ?? [];
  const environmentOptions = bootstrap?.config.environments ?? [];
  const activeTenant = tenantOptions.find((item) => item.id === selectedTenant) ?? tenantOptions[0];
  const tenantEnvironmentOptions = environmentOptions.filter(
    (item) => item.tenantId === activeTenant?.id,
  );
  const selectedSettingsTenant =
    tenantDraft.find((item) => item.id === selectedSettingsTenantId) ?? tenantDraft[0];
  const activeEnvironment =
    tenantEnvironmentOptions.find((item) => item.id === selectedEnvironment) ??
    tenantEnvironmentOptions[0];
  const fileHistory = fileDetail?.history ?? [];
  const historyController = useFileHistory({
    active: activeWorkspaceSection === "history" && !reviewOpen,
    commits: fileHistory,
    onAuthRequired: handleAuthRequired,
    onError: setError,
    selectedPath,
  });
  const reviewController = useRepositoryReview({
    environmentId: activeEnvironment?.id,
    onAuthRequired: handleAuthRequired,
    onError: setError,
    onOpen: () => setMainView("review"),
  });
  const authController = useAuthSession({
    onActivated: () => {
      setActiveDialog(null);
      setOpenHeaderPopover(null);
    },
    onAuthenticated: async (user) => {
      await refreshBootstrap(undefined, false, user.id);
    },
    onError: setError,
    onMessage: setMessage,
    onSessionReset: resetWorkspaceState,
  });
  const {
    displayedIndex: displayedEditorSearchIndex,
    input: editorSearchInput,
    inputRef: editorSearchInputRef,
    isOpen: editorSearchOpen,
    matches: editorSearchMatches,
    open: openEditorSearch,
    query: editorSearch,
  } = editorSearchController;
  const {
    detail: selectedHistoryDetail,
    isLoading: historyDetailLoading,
    selectedCommit: selectedHistory,
  } = historyController;
  const {
    commits: reviewCommits,
    diff: reviewDiff,
    diffLoading: reviewDiffLoading,
    loadChanges: loadReviewChanges,
    loadDiff: loadReviewDiff,
    loading: reviewLoading,
    selectCommit: selectReviewCommit,
    selectedCommit: selectedReviewCommit,
    selectedHash: selectedReviewHash,
    selectedPath: selectedReviewPath,
    since: reviewSince,
    until: reviewUntil,
  } = reviewController;
  const {
    activate: submitActivationCode,
    activating: activatingAdmin,
    activationCode,
    checked: authChecked,
    loginForm,
    logout: logoutCurrentUser,
    mode: authMode,
    setActivationCode,
    setLoginForm,
    submit: submitLogin,
    submitting: loggingIn,
    toggleMode: toggleAuthMode,
    user: authUser,
  } = authController;

  function resetWorkspaceState(): void {
    setBootstrap(null);
    setSelectedTenant("");
    setSelectedPath("");
    setFileDetail(null);
    setEditorContent("");
    setEditorDirty(false);
    setFileConflict(null);
    setFileValidationError(null);
    setPendingReplay(null);
    setMainView("workspace");
    reviewController.clearResults();
    historyController.reset(true);
    setLiveNotice(null);
    setOpenHeaderPopover(null);
    setActiveDialog(null);
    setEnvironmentDraft([]);
    setTenantDraft([]);
    setSelectedSettingsTenantId("");
  }

  function handleAuthRequired(errorValue: unknown): boolean {
    return authController.handleAuthRequired(errorValue);
  }

  function getLatestEditorContent(): string {
    return editorViewRef.current?.state.doc.toString() ?? editorContent;
  }

  function startFileListResize(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (window.matchMedia("(max-width: 960px)").matches) {
      return;
    }

    event.preventDefault();
    setResizingFileList(true);
  }

  function switchEnvironment(nextEnvironmentId: string): void {
    if (nextEnvironmentId === activeEnvironment?.id) return;

    setSelectedEnvironment(nextEnvironmentId);
    reviewController.clearResults();
    historyController.reset();
    const nextEnvironment = environmentOptions.find((item) => item.id === nextEnvironmentId);
    if (nextEnvironment) setSelectedTenant(nextEnvironment.tenantId);
    const replacedPath = selectedPath
      ? replaceEnvironmentRoot(selectedPath, environmentOptions, nextEnvironmentId)
      : null;
    if (replacedPath && files.some((file) => file.path === replacedPath)) {
      setSelectedPath(replacedPath);
      return;
    }

    const fallbackPath = nextEnvironment
      ? (files.find((file) => getPathWithinRoot(file.path, nextEnvironment.root) !== null)?.path ??
        "")
      : "";
    setSelectedPath(fallbackPath);
  }

  function switchTenant(nextTenantId: string): void {
    if (nextTenantId === activeTenant?.id) return;
    const nextEnvironments = environmentOptions.filter((item) => item.tenantId === nextTenantId);
    const matchingEnvironment = nextEnvironments.find(
      (item) => item.label === activeEnvironment?.label && item.kind === activeEnvironment?.kind,
    );
    const nextEnvironment = matchingEnvironment ?? nextEnvironments[0];
    setSelectedTenant(nextTenantId);
    setSelectedEnvironment(nextEnvironment?.id ?? "");
    reviewController.clearResults();
    historyController.reset();

    const replacedPath =
      nextEnvironment && selectedPath
        ? replaceEnvironmentRoot(selectedPath, environmentOptions, nextEnvironment.id)
        : null;
    if (replacedPath && files.some((file) => file.path === replacedPath)) {
      setSelectedPath(replacedPath);
      return;
    }
    setSelectedPath(
      nextEnvironment
        ? (files.find((file) => getPathWithinRoot(file.path, nextEnvironment.root) !== null)
          ?.path ?? "")
        : "",
    );
  }

  async function refreshBootstrap(
    preferredPath?: string,
    preserveForm = true,
    preferenceUserId = authUser?.id,
  ): Promise<string> {
    const data = await requestJson<BootstrapResponse>("/api/bootstrap");
    const environmentOptions = data.config.environments;
    const storedPreference = preferenceUserId
      ? readWorkspacePreference(preferenceUserId)
      : null;
    const storedTenant = storedPreference
      ? data.config.tenants.find((item) => item.id === storedPreference.tenantId)
      : undefined;
    const storedEnvironment = storedTenant
      ? environmentOptions.find(
        (item) =>
          item.id === storedPreference?.environmentId && item.tenantId === storedTenant.id,
      ) ?? environmentOptions.find((item) => item.tenantId === storedTenant.id)
      : undefined;
    const validPreferredPath =
      preferredPath && data.files.some((file) => file.path === preferredPath)
        ? preferredPath
        : "";
    const validCurrentPath = data.files.some((file) => file.path === selectedPath)
      ? selectedPath
      : "";
    const nextPath = validPreferredPath || validCurrentPath || (storedEnvironment
      ? (data.files.find(
        (file) => getPathWithinRoot(file.path, storedEnvironment.root) !== null,
      )?.path ?? "")
      : (data.selectedFile ?? ""));
    const derivedEnvironmentOption =
      environmentOptions.find(
        (item) => nextPath && getPathWithinRoot(nextPath, item.root) !== null,
      ) ?? storedEnvironment ?? environmentOptions[0];

    startTransition(() => {
      setBootstrap(data);
      setSelectedTenant((current) =>
        current && data.config.tenants.some((item) => item.id === current)
          ? current
          : (derivedEnvironmentOption?.tenantId ?? data.config.tenants[0]?.id ?? ""),
      );
      setSelectedEnvironment((current) =>
        current && environmentOptions.some((item) => item.id === current)
          ? current
          : (derivedEnvironmentOption?.id ?? ""),
      );
      if (nextPath !== selectedPath) {
        historyController.reset();
      }
      setSelectedPath(nextPath);
      if (!preserveForm) {
        setGitForm({
          extraMessage: "",
        });
      }
    });
    return nextPath;
  }

  useEffect(() => {
    if (!authUser || !activeTenant || !activeEnvironment) return;
    writeWorkspacePreference(authUser.id, {
      tenantId: activeTenant.id,
      environmentId: activeEnvironment.id,
    });
  }, [activeEnvironment?.id, activeTenant?.id, authUser?.id]);

  async function refreshFile(pathValue: string, preserveDraft: boolean): Promise<void> {
    if (!pathValue) {
      startTransition(() => {
        setFileDetail(null);
        setEditorContent("");
        setEditorDirty(false);
        setFileConflict(null);
        setFileValidationError(null);
      });
      return;
    }

    const detail = await requestJson<FileDetail>(`/api/file?path=${encodeURIComponent(pathValue)}`);

    startTransition(() => {
      setFileDetail(detail);
      if (!preserveDraft || !editorDirty) {
        setEditorContent(detail.content);
        setEditorDirty(false);
        setFileConflict(null);
        setFileValidationError(null);
      }
    });
  }

  useEffect(() => {
    void refreshFile(selectedPath, false).catch((fetchError) => {
      if (handleAuthRequired(fetchError)) {
        return;
      }
      setError((fetchError as Error).message);
    });
  }, [selectedPath]);

  useEffect(() => {
    if (!authUser) {
      return;
    }

    const stream = new EventSource("/api/stream");

    stream.addEventListener("repo-changed", () => {
      void (async () => {
        try {
          // 事件路径表示仓库中发生变化的文件，不代表用户想切换到该文件。
          // 刷新目录和编辑内容时继续保留当前选中文件。
          const nextPath = await refreshBootstrap(selectedPath);
          if (nextPath) {
            await refreshFile(nextPath, true);
          }
          setLiveNotice(editorDirty ? "仓库已更新，预览已刷新" : "仓库内容已同步刷新");
        } catch (fetchError) {
          if (handleAuthRequired(fetchError)) {
            return;
          }
          setError((fetchError as Error).message);
        }
      })();
    });

    stream.onerror = () => {
      setLiveNotice("实时连接已中断，正在等待重连");
    };

    return () => {
      stream.close();
    };
  }, [authUser, selectedPath, editorDirty]);

  useEffect(() => {
    if (!resizingFileList) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function handlePointerMove(event: PointerEvent): void {
      const layoutElement = layoutRef.current;
      if (!layoutElement) {
        return;
      }

      const rect = layoutElement.getBoundingClientRect();
      const maxWidth = Math.max(
        fileListMinWidth,
        Math.min(fileListMaxWidth, rect.width - mainContentMinWidth - 22),
      );
      setFileListWidth(clampNumber(event.clientX - rect.left, fileListMinWidth, maxWidth));
    }

    function stopResizing(): void {
      setResizingFileList(false);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };
  }, [resizingFileList]);

  async function discardCurrentFile(): Promise<void> {
    if (!selectedPath) {
      return;
    }
    if (isProtectedFileReadOnly) {
      setError("普通用户在当前环境仅可查看文件与历史记录");
      return;
    }

    if (!editorDirty && !fileDetail?.isDirty) {
      setMessage("当前文件没有可丢弃的修改");
      setError(null);
      return;
    }

    if (!window.confirm("确认丢弃当前文件的未提交修改？编辑区内容会恢复到当前 HEAD。")) {
      return;
    }

    setDiscarding(true);
    setError(null);
    setMessage(null);
    setFileConflict(null);
    setFileValidationError(null);

    try {
      const detail = await requestJson<FileDetail>("/api/file/discard", {
        method: "POST",
        body: JSON.stringify({
          path: selectedPath,
        }),
      });

      startTransition(() => {
        setFileDetail(detail);
        setEditorContent(detail.content);
        setEditorDirty(false);
      });
      historyController.selectHash(detail.history[0]?.hash ?? "");
      setMessage("已丢弃当前文件的未提交修改");
      await refreshBootstrap(selectedPath);
    } catch (discardError) {
      if (handleAuthRequired(discardError)) {
        return;
      }
      setError((discardError as Error).message);
    } finally {
      setDiscarding(false);
    }
  }

  async function commitAndPush(): Promise<void> {
    if (!selectedPath) {
      return;
    }
    if (isProtectedFileReadOnly) {
      setActiveDialog(null);
      setError("普通用户在当前环境仅可查看文件与历史记录");
      return;
    }

    setActiveDialog(null);
    setCommitting(true);
    setError(null);
    setMessage(null);
    setFileValidationError(null);

    try {
      if (!fileDetail) {
        throw new Error("请先选择要提交的文件");
      }

      const latestContent = getLatestEditorContent();
      await requestJson<{ head: string; path: string }>("/api/commit", {
        method: "POST",
        body: JSON.stringify({
          path: selectedPath,
          content: latestContent,
          baseHead: fileDetail.baseHead,
          baseBlob: fileDetail.baseBlob,
          message: gitForm.extraMessage,
        }),
      });

      setFileConflict(null);
      await refreshBootstrap(selectedPath);
      await refreshFile(selectedPath, false);
      setGitForm((current) => ({
        ...current,
        extraMessage: "",
      }));
      setMessage("修改已提交并推送到远程仓库");
    } catch (commitError) {
      if (
        commitError instanceof ApiRequestError &&
        commitError.status === 409 &&
        isFileConflictPayload(commitError.payload)
      ) {
        const conflictPayload = commitError.payload;
        setFileConflict(conflictPayload);
        setFileDetail((current) =>
          current
            ? {
              ...current,
              baseHead: conflictPayload.remoteHead ?? current.baseHead,
              baseBlob: conflictPayload.remoteBlob,
              remoteHead: conflictPayload.remoteHead,
              remoteBlob: conflictPayload.remoteBlob,
              remoteContent: conflictPayload.remoteContent,
              headContent: conflictPayload.remoteContent,
            }
            : current,
        );
        setEditorDirty(true);
      } else if (handleAuthRequired(commitError)) {
        return;
      } else if (
        commitError instanceof ApiRequestError &&
        commitError.status === 400 &&
        isFileValidationPayload(commitError.payload)
      ) {
        setFileValidationError(commitError.payload.message);
      }
      setError((commitError as Error).message);
    } finally {
      setCommitting(false);
    }
  }

  function extractHistoryReplay(commit: CommitSnapshot): void {
    if (!selectedPath) {
      return;
    }
    if (authUser?.role !== "admin") {
      setError("仅管理员可提取历史修改");
      return;
    }
    if (commit.beforeContent === commit.afterContent) {
      setError("该提交没有可重放的文件修改");
      return;
    }

    setPendingReplay({
      hash: commit.hash,
      sourcePath: selectedPath,
      patch: createReplayPatch(selectedPath, commit.beforeContent, commit.afterContent),
    });
    setError(null);
    setMessage(`已提取 ${commit.hash.slice(0, 8)} 的修改，可在任意文件中尝试重放`);
  }

  function replayExtractedChange(): void {
    if (!selectedPath || !pendingReplay) {
      return;
    }
    if (authUser?.role !== "admin") {
      setError("仅管理员可重放历史修改");
      return;
    }

    const replayedContent = applyReplayPatch(getLatestEditorContent(), pendingReplay.patch);
    if (replayedContent === null) {
      setError("当前文件内容与提取修改的上下文不匹配，无法执行重放");
      return;
    }

    setEditorContent(replayedContent);
    setEditorDirty(true);
    setFileValidationError(null);
    setError(null);
    setMessage(`已重放 ${pendingReplay.hash.slice(0, 8)} 的修改，尚未提交`);
  }

  async function restoreHistoryCommit(commit: CommitSnapshot): Promise<void> {
    if (!selectedPath || !fileDetail) {
      return;
    }
    if (isProtectedFileReadOnly) {
      setError("普通用户在当前环境仅可查看文件与历史记录");
      return;
    }

    if (
      editorDirty &&
      !window.confirm("编辑区有未提交的内容，回滚会用历史版本覆盖当前文件。确认继续？")
    ) {
      return;
    }

    setRestoringHash(commit.hash);
    setError(null);
    setMessage(null);
    setFileValidationError(null);

    try {
      await requestJson<{ head: string; path: string }>("/api/file/restore", {
        method: "POST",
        body: JSON.stringify({
          path: selectedPath,
          hash: commit.hash,
          baseHead: fileDetail.baseHead,
          baseBlob: fileDetail.baseBlob,
        }),
      });

      setFileConflict(null);
      await refreshBootstrap(selectedPath);
      await refreshFile(selectedPath, false);
      setMessage("已回滚到所选历史版本并推送到远程仓库");
    } catch (restoreError) {
      if (
        restoreError instanceof ApiRequestError &&
        restoreError.status === 409 &&
        isFileConflictPayload(restoreError.payload)
      ) {
        const conflictPayload = restoreError.payload;
        setFileConflict(conflictPayload);
        setFileDetail((current) =>
          current
            ? {
              ...current,
              baseHead: conflictPayload.remoteHead ?? current.baseHead,
              baseBlob: conflictPayload.remoteBlob,
              remoteHead: conflictPayload.remoteHead,
              remoteBlob: conflictPayload.remoteBlob,
              remoteContent: conflictPayload.remoteContent,
              headContent: conflictPayload.remoteContent,
            }
            : current,
        );
        setEditorDirty(true);
      } else if (handleAuthRequired(restoreError)) {
        return;
      } else if (
        restoreError instanceof ApiRequestError &&
        restoreError.status === 400 &&
        isFileValidationPayload(restoreError.payload)
      ) {
        setFileValidationError(restoreError.payload.message);
      }
      setError((restoreError as Error).message);
    } finally {
      setRestoringHash(null);
    }
  }

  async function syncRepository(): Promise<void> {
    setSyncing(true);
    setError(null);
    setMessage(null);

    try {
      await requestJson<BootstrapResponse>("/api/repo/sync", {
        method: "POST",
      });
      await refreshBootstrap(selectedPath || undefined);
      if (selectedPath) {
        await refreshFile(selectedPath, true);
      }
      setMessage("仓库已同步");
    } catch (syncError) {
      if (handleAuthRequired(syncError)) {
        return;
      }
      setError((syncError as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  async function openEnvironmentSettings(): Promise<void> {
    if (authUser?.role !== "admin") {
      setError("仅管理员可配置环境");
      return;
    }

    setError(null);
    setMessage(null);
    try {
      const payload = await requestJson<EnvironmentSettingsResponse>("/api/settings/environments");
      setTenantDraft(payload.tenants);
      setEnvironmentDraft(payload.environments);
      setSelectedSettingsTenantId(payload.tenants[0]?.id ?? "");
      setActiveDialog({ type: "environment-settings" });
    } catch (settingsError) {
      if (handleAuthRequired(settingsError)) {
        return;
      }
      setError((settingsError as Error).message);
    }
  }

  function updateEnvironmentDraft(index: number, patch: Partial<RepoEnvironmentOption>): void {
    setEnvironmentDraft((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    );
  }

  function addEnvironmentDraft(tenantId?: string): void {
    const tenant = tenantDraft.find((item) => item.id === tenantId) ?? tenantDraft[0];
    if (!tenant) return;
    setEnvironmentDraft((current) => {
      return [...current, createBlankEnvironment(current.length, tenant.id, tenant.root)];
    });
  }

  function removeEnvironmentDraft(index: number): void {
    setEnvironmentDraft((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function updateTenantDraft(index: number, patch: Partial<RepoTenantOption>): void {
    const previousTenant = tenantDraft[index];
    setTenantDraft((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    );
    if (previousTenant && patch.root !== undefined) {
      setEnvironmentDraft((current) =>
        current.map((environment) => {
          if (environment.tenantId !== previousTenant.id) return environment;
          const suffix = getEnvironmentRootSuffix(environment.root, previousTenant.root);
          return { ...environment, root: buildEnvironmentRoot(patch.root ?? "", suffix) };
        }),
      );
    }
  }

  function addTenantDraft(): void {
    const tenant = createBlankTenant(tenantDraft.length);
    setTenantDraft((current) => [...current, tenant]);
    setSelectedSettingsTenantId(tenant.id);
  }

  function removeTenantDraft(index: number): void {
    const tenant = tenantDraft[index];
    if (!tenant) return;
    const remainingTenants = tenantDraft.filter((_, itemIndex) => itemIndex !== index);
    setTenantDraft((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setEnvironmentDraft((current) => current.filter((item) => item.tenantId !== tenant.id));
    if (selectedSettingsTenantId === tenant.id) {
      setSelectedSettingsTenantId(
        remainingTenants[Math.min(index, remainingTenants.length - 1)]?.id ?? "",
      );
    }
  }

  async function saveEnvironmentSettings(): Promise<void> {
    const normalizedTenants = tenantDraft.map((item) => ({
      ...item,
      label: item.label.trim(),
      root: item.root.trim().replace(/^\/+|\/+$/g, ""),
    }));
    const normalized = environmentDraft.map((item, index) => ({
      ...item,
      id: item.id.trim() || createEnvironmentId(item.label, index),
      label: item.label.trim(),
      root: item.root.trim().replace(/^\/+|\/+$/g, ""),
    }));
    if (!normalizedTenants.length) {
      setError("至少需要保留一个租户配置");
      return;
    }
    if (normalizedTenants.some((item) => !item.label || !item.root)) {
      setError("租户名称和租户目录不能为空");
      return;
    }
    if (!normalized.length) {
      setError("至少需要保留一个环境配置");
      return;
    }
    if (normalized.some((item) => !item.label || !item.root)) {
      setError("环境名称和展示目录不能为空");
      return;
    }
    if (
      normalizedTenants.some((tenant) => !normalized.some((item) => item.tenantId === tenant.id))
    ) {
      setError("每个租户至少需要配置一个环境");
      return;
    }
    const tenantById = new Map(normalizedTenants.map((item) => [item.id, item]));
    if (
      normalized.some((item) => {
        const tenant = tenantById.get(item.tenantId);
        return !tenant || !isValidEnvironmentRoot(item.root, tenant.root);
      })
    ) {
      setError("环境路径必须填写租户目录后的有效相对路径，且不能包含 . 或 .. 路径段");
      return;
    }

    setSavingEnvironmentSettings(true);
    setError(null);
    setMessage(null);
    try {
      const payload = await requestJson<EnvironmentSettingsResponse>("/api/settings/environments", {
        method: "PUT",
        body: JSON.stringify({
          tenants: normalizedTenants,
          environments: normalized,
        }),
      });
      setTenantDraft(payload.tenants);
      setEnvironmentDraft(payload.environments);
      await refreshBootstrap(selectedPath || undefined);
      setActiveDialog(null);
      setMessage("环境配置已保存");
    } catch (settingsError) {
      if (handleAuthRequired(settingsError)) {
        return;
      }
      setError((settingsError as Error).message);
    } finally {
      setSavingEnvironmentSettings(false);
    }
  }

  async function submitFragmentFileDialog(values: {
    relativePath: string;
    tagName: string;
  }): Promise<void> {
    const environment = bootstrap?.config.environments.find(
      (item) => item.id === selectedEnvironment && item.kind === "fragment-library",
    );
    if (!environment || !fragmentFileDialogMode) return;

    setFragmentFileOperation(true);
    setError(null);
    try {
      const result = await requestJson<{ head: string; path: string }>(
        fragmentFileDialogMode === "create"
          ? "/api/prompt-fragments/files"
          : "/api/prompt-fragments/files/rename",
        {
          method: "POST",
          body: JSON.stringify(
            fragmentFileDialogMode === "create"
              ? {
                environmentId: environment.id,
                relativePath: values.relativePath,
                tagName: values.tagName,
              }
              : {
                path: selectedPath,
                relativePath: values.relativePath,
              },
          ),
        },
      );
      setActiveDialog(null);
      await refreshBootstrap(result.path);
      setMessage(
        fragmentFileDialogMode === "create" ? "提示词片段已创建并提交" : "提示词片段已重命名并提交",
      );
    } catch (operationError) {
      if (!handleAuthRequired(operationError)) setError((operationError as Error).message);
    } finally {
      setFragmentFileOperation(false);
    }
  }

  async function deleteFragment(pathValue: string): Promise<void> {
    if (!window.confirm(`确认删除提示词片段 ${pathValue}？删除会立即提交并推送。`)) return;
    setFragmentFileOperation(true);
    setError(null);
    try {
      await requestJson<{ head: string; path: string }>("/api/prompt-fragments/files", {
        method: "DELETE",
        body: JSON.stringify({ path: pathValue }),
      });
      await refreshBootstrap(undefined);
      setMessage("提示词片段已删除并推送");
    } catch (operationError) {
      if (!handleAuthRequired(operationError)) setError((operationError as Error).message);
    } finally {
      setFragmentFileOperation(false);
    }
  }

  async function submitConfigFileDialog(relativePath: string): Promise<void> {
    const environment = bootstrap?.config.environments.find(
      (item) => item.id === selectedEnvironment && item.kind === "config",
    );
    if (!environment || activeDialog?.type !== "config-file") return;

    const dialog = activeDialog;

    setConfigFileOperation(true);
    setError(null);
    try {
      const result = await requestJson<{ head: string; path: string }>(
        dialog.mode === "create" ? "/api/config-files" : "/api/config-files/rename",
        {
          method: "POST",
          body: JSON.stringify(
            dialog.mode === "create"
              ? { environmentId: environment.id, relativePath }
              : { path: dialog.path, relativePath },
          ),
        },
      );
      setActiveDialog(null);
      await refreshBootstrap(result.path);
      setMessage(
        dialog.mode === "create" ? "配置文件已创建并提交" : "配置文件已重命名并提交",
      );
    } catch (operationError) {
      if (!handleAuthRequired(operationError)) setError((operationError as Error).message);
    } finally {
      setConfigFileOperation(false);
    }
  }

  async function deleteConfig(pathValue: string): Promise<void> {
    if (!window.confirm(`确认删除配置文件 ${pathValue}？删除会立即提交并推送。\n\n删除操作不会同步 nacos，需在 nacos 上单独执行删除操作`)) return;
    setConfigFileOperation(true);
    setError(null);
    try {
      await requestJson<{ head: string; path: string }>("/api/config-files", {
        method: "DELETE",
        body: JSON.stringify({ path: pathValue }),
      });
      await refreshBootstrap(undefined);
      setMessage("配置文件已删除并推送");
    } catch (operationError) {
      if (!handleAuthRequired(operationError)) setError((operationError as Error).message);
    } finally {
      setConfigFileOperation(false);
    }
  }

  const isFragmentLibrary = activeEnvironment?.kind === "fragment-library";
  const selectedFragmentRelativePath =
    isFragmentLibrary && selectedPath && activeEnvironment
      ? (getPathWithinRoot(selectedPath, activeEnvironment.root) ?? "")
      : "";
  const configFileDialogPath =
    activeDialog?.type === "config-file" && activeDialog.mode === "rename"
      ? activeDialog.path
      : "";
  const selectedConfigRelativePath =
    !isFragmentLibrary && configFileDialogPath && activeEnvironment
      ? (getPathWithinRoot(configFileDialogPath, activeEnvironment.root) ?? "")
      : "";
  const selectedFileEnvironment =
    environmentOptions.find(
      (item) => selectedPath && getPathWithinRoot(selectedPath, item.root) !== null,
    ) ?? activeEnvironment;
  const displayRoot = activeEnvironment
    ? activeEnvironment.root
    : bootstrap?.config.visibleRoots?.join(" / ") || "-";
  const repoHead = bootstrap?.repoStatus.head ?? null;
  const remoteUrl = bootstrap?.config.remoteUrl || "-";
  const currentRoleLabel = authUser?.role === "admin" ? "管理员" : "普通用户";
  const isProtectedFileReadOnly =
    authUser?.role !== "admin" &&
    (selectedFileEnvironment?.requiresAdminToEdit ??
      isProtectedEnvironmentId(selectedFileEnvironment?.id));
  const isActiveEnvironmentReadOnly =
    authUser?.role !== "admin" &&
    (activeEnvironment?.requiresAdminToEdit ?? isProtectedEnvironmentId(activeEnvironment?.id));
  const fileOperationInProgress = fragmentFileOperation || configFileOperation;
  const canOperateCurrentEnvironmentFiles = !fileOperationInProgress && !isActiveEnvironmentReadOnly;
  const environmentFiles = useMemo(
    () =>
      activeEnvironment
        ? files.filter((file) => getPathWithinRoot(file.path, activeEnvironment.root) !== null)
        : files,
    [activeEnvironment, files],
  );
  const visibleFiles = environmentFiles;
  const normalizedFileQuery = fileQuery.trim().toLocaleLowerCase();
  const filteredVisibleFiles = useMemo(
    () =>
      normalizedFileQuery
        ? visibleFiles.filter((file) => {
          const searchTarget = (file.path.split("/").pop() ?? "").toLocaleLowerCase();
          return searchTarget.includes(normalizedFileQuery);
        })
        : visibleFiles,
    [activeEnvironment, normalizedFileQuery, visibleFiles],
  );
  const fileTree = useMemo(
    () =>
      activeEnvironment
        ? buildFileTree(
          filteredVisibleFiles,
          (file) => getPathWithinRoot(file.path, activeEnvironment.root),
          activeEnvironment.root,
        )
        : [],
    [activeEnvironment, filteredVisibleFiles],
  );
  const repoReady = bootstrap?.repoStatus.ready ?? false;
  const pendingBaseContent = fileDetail?.headContent ?? "";
  const hasPendingChanges =
    Boolean(selectedPath) && (editorDirty || pendingBaseContent !== (fileDetail?.content ?? ""));
  const canDiscardCurrentFile =
    Boolean(selectedPath) &&
    !isProtectedFileReadOnly &&
    !committing &&
    (editorDirty || Boolean(fileDetail?.isDirty));
  const workspaceLayoutStyle = {
    "--file-list-grid": `${fileListWidth}px minmax(0, 1fr)`,
  } as CSSProperties;

  useEffect(() => {
    function handleSearchShortcut(event: KeyboardEvent): void {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
        return;
      }

      if (!authUser || mainView !== "workspace" || activeDialog !== null) {
        return;
      }

      const key = event.key.toLocaleLowerCase();
      if (key === "p") {
        event.preventDefault();
        event.stopPropagation();
        fileSearchInputRef.current?.focus();
        fileSearchInputRef.current?.select();
        return;
      }

      if (key === "f" && activeWorkspaceSection === "editor" && selectedPath) {
        event.preventDefault();
        event.stopPropagation();
        openEditorSearch();
      }
    }

    window.addEventListener("keydown", handleSearchShortcut, true);
    return () => window.removeEventListener("keydown", handleSearchShortcut, true);
  }, [activeDialog, activeWorkspaceSection, authUser, mainView, selectedPath]);

  function scrollToEditorSearchMatch(match: { from: number; to: number }): void {
    const view = editorViewRef.current;
    if (!view) {
      return;
    }

    const block = view.lineBlockAt(match.from);
    view.dispatch({
      selection: EditorSelection.single(match.from, match.to),
    });

    const scrollContainer =
      editorViewMode === "diff"
        ? (view.dom.closest<HTMLElement>(".cm-mergeView") ?? view.scrollDOM)
        : view.scrollDOM;
    const blockTop =
      scrollContainer === view.scrollDOM
        ? block.top
        : view.dom.getBoundingClientRect().top -
        scrollContainer.getBoundingClientRect().top +
        scrollContainer.scrollTop +
        block.top;
    const maxScrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight;
    const nextScrollTop = Math.max(
      0,
      Math.min(maxScrollTop, blockTop - scrollContainer.clientHeight / 2 + block.height / 2),
    );
    scrollContainer.scrollTop = nextScrollTop;
  }

  function findAdjacentEditorSearchMatch(direction: -1 | 1): void {
    const currentContent = getLatestEditorContent();
    if (currentContent !== editorContent) {
      setEditorContent(currentContent);
    }
    const match = editorSearchController.findAdjacent(currentContent, direction);
    if (match) scrollToEditorSearchMatch(match);
  }

  function updateEditorSearch(value: string): void {
    const currentContent = getLatestEditorContent();
    if (currentContent !== editorContent) {
      setEditorContent(currentContent);
    }
    const match = editorSearchController.setInput(value, currentContent);
    if (match) scrollToEditorSearchMatch(match);
  }

  function goToAdjacentChange(direction: -1 | 1): void {
    const view = editorViewRef.current;
    if (!view || editorViewMode !== "diff") {
      return;
    }
    const moved = (direction > 0 ? goToNextChunk : goToPreviousChunk)({
      state: view.state,
      dispatch: view.dispatch,
    });
    if (moved) {
      const lineEnd = view.state.doc.lineAt(view.state.selection.main.head).to;
      view.dispatch({ selection: EditorSelection.cursor(lineEnd) });
      view.focus();
    }
  }

  function validateEditorAsYaml(): void {
    if (!selectedPath) {
      return;
    }

    const validationError =
      validateEditorContent(selectedPath, editorContent, true)?.message ?? null;
    if (validationError) {
      setMessage(null);
      setError(validationError);
      return;
    }

    setError(null);
    setMessage("YAML 格式校验通过");
  }

  function formatEditorAsXml(): void {
    if (!selectedPath) return;

    try {
      const formatted = formatXml(getLatestEditorContent());
      setEditorContent(formatted);
      setEditorDirty(true);
      setFileValidationError(null);
      setError(null);
      setMessage("XML 格式化完成");
    } catch (formatError) {
      setMessage(null);
      setError(`XML 格式错误：${(formatError as Error).message}`);
    }
  }

  if (!authChecked) {
    return <div className="p-7 text-muted-foreground">正在加载...</div>;
  }

  if (!authUser) {
    return (
      <AuthScreen
        authMode={authMode}
        error={error}
        loggingIn={loggingIn}
        loginForm={loginForm}
        onSubmit={(event) => void submitLogin(event)}
        onFormChange={setLoginForm}
        onModeToggle={toggleAuthMode}
      />
    );
  }

  return (
    <div className="h-screen min-w-[1080px] overflow-hidden bg-canvas">
      <ToastStack
        error={error}
        liveNotice={liveNotice}
        message={message}
        onDismissError={() => setError(null)}
        onDismissLiveNotice={() => setLiveNotice(null)}
        onDismissMessage={() => setMessage(null)}
      />
      {confirmingCommit && !isProtectedFileReadOnly ? (
        <CommitConfirmDialog
          selectedPath={selectedPath}
          commitMessage={gitForm.extraMessage}
          committing={committing}
          onCancel={() => setActiveDialog(null)}
          onConfirm={() => void commitAndPush()}
        />
      ) : null}
      {fragmentFileDialogMode ? (
        <PromptFragmentFileDialog
          mode={fragmentFileDialogMode}
          initialRelativePath={
            fragmentFileDialogMode === "rename" ? selectedFragmentRelativePath : ""
          }
          onClose={() => setActiveDialog(null)}
          onSubmit={submitFragmentFileDialog}
        />
      ) : null}
      {configFileDialogMode ? (
        <ConfigFileDialog
          mode={configFileDialogMode}
          initialRelativePath={
            configFileDialogMode === "rename" ? selectedConfigRelativePath : ""
          }
          onClose={() => setActiveDialog(null)}
          onSubmit={submitConfigFileDialog}
        />
      ) : null}
      {fragmentBatchOpen && selectedPath ? (
        <PromptFragmentBatchDialog
          sourcePath={selectedPath}
          environments={environmentOptions.filter(
            (item) =>
              item.tenantId === activeTenant?.id &&
              (authUser?.role === "admin" || !item.requiresAdminToEdit),
          )}
          onClose={() => setActiveDialog(null)}
          onError={(batchError) => setError(batchError)}
          onApplied={async (paths) => {
            setActiveDialog(null);
            await refreshBootstrap(selectedPath);
            setMessage(`已批量替换并提交 ${paths.length} 个文件`);
          }}
        />
      ) : null}
      {activeDialog?.type === "file-promotion" && selectedFileEnvironment ? (
        <FilePromotionDialog
          sourcePath={activeDialog.sourcePath}
          sourceEnvironment={selectedFileEnvironment}
          environments={environmentOptions}
          isAdmin={authUser?.role === "admin"}
          onClose={() => setActiveDialog(null)}
          onAuthError={(promotionError) => { handleAuthRequired(promotionError); }}
          onApplied={async (targetPath) => {
            setActiveDialog(null);
            setMessage(`已晋级到 ${targetPath}，并提交推送到远程仓库`);
            await refreshBootstrap(selectedPath);
          }}
        />
      ) : null}
      {activeDialog?.type === "changelog" ? (
        <ChangelogDialog onClose={() => setActiveDialog(null)} />
      ) : null}
      <header className="relative z-50 flex min-h-[52px] items-center justify-between gap-4 overflow-visible border-b border-ui-border bg-surface px-ui-4 py-ui-2">
        <div className="flex min-w-0 items-center gap-ui-3">
          <div className="min-w-0">
            <h1 className="m-0 truncate text-base font-bold text-foreground">
              {isFragmentLibrary ? "提示词片段库" : "配置工作台"}
            </h1>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-ui-1">
          <div className="relative mr-ui-1 flex items-center gap-0 border-r border-ui-border pr-ui-1">
            <Button
              aria-expanded={showRepoDetails}
              onClick={() =>
                setOpenHeaderPopover((current) => (current === "repository" ? null : "repository"))
              }
              size="sm"
              variant="ghost"
            >
              <span
                className={cn("h-2 w-2 rounded-full", repoReady ? "bg-success" : "bg-warning")}
              />
              {repoReady ? "仓库可用" : "仓库未就绪"}
              <span className="text-xs text-subtle-foreground">
                {formatTime(bootstrap?.repoStatus.lastSyncedAt ?? null)}
              </span>
            </Button>
            {showRepoDetails ? (
              <div className="absolute right-0 top-[calc(100%+8px)] z-30 grid w-[360px] gap-ui-3 rounded-ui-lg border border-ui-border bg-surface p-ui-4 text-sm shadow-ui-overlay">
                <div>
                  <span className="block text-xs text-subtle-foreground">远程仓库</span>
                  <span className="mt-1 block break-all text-foreground">{remoteUrl}</span>
                </div>
                <div className="grid grid-cols-2 gap-ui-3">
                  <div>
                    <span className="block text-xs text-subtle-foreground">分支</span>
                    <span className="mt-1 block truncate text-foreground">
                      {bootstrap?.config.branch || "-"}
                    </span>
                  </div>
                  <div>
                    <span className="block text-xs text-subtle-foreground">当前 HEAD</span>
                    <span className="mt-1 block truncate font-mono text-xs text-foreground">
                      {repoHead || "-"}
                    </span>
                  </div>
                </div>
                <div>
                  <span className="block text-xs text-subtle-foreground">展示目录</span>
                  <span className="mt-1 block break-all text-foreground">{displayRoot}</span>
                </div>
              </div>
            ) : null}
            <ToolbarIconButton
              onClick={() => {
                setOpenHeaderPopover(null);
                void syncRepository();
              }}
              disabled={syncing}
              label={syncing ? "正在同步仓库" : "同步仓库"}
              variant="ghost"
            >
              <svg
                aria-hidden="true"
                className={cn("h-4 w-4", syncing && "animate-spin motion-reduce:animate-none")}
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
                viewBox="0 0 24 24"
              >
                <path d="M20 7v5h-5" />
                <path d="M4 17v-5h5" />
                <path d="M6.1 9a7 7 0 0 1 11.6-2.6L20 8M4 16l2.3 1.6A7 7 0 0 0 17.9 15" />
              </svg>
            </ToolbarIconButton>
          </div>
          <Button
            aria-expanded={activeDialog?.type === "changelog"}
            aria-haspopup="dialog"
            className="px-ui-2"
            onClick={() => {
              setOpenHeaderPopover(null);
              setActiveDialog({ type: "changelog" });
            }}
            size="sm"
            variant="ghost"
          >
            <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">
              <rect height="18" rx="2" width="14" x="5" y="3" />
              <path d="M9 7h6M9 11h6M9 15h4" />
            </svg>
            更新日志
          </Button>
          <Button
            aria-label={reviewOpen ? "返回文件工作区" : "打开版本比对"}
            className={cn("px-ui-2", reviewOpen && "bg-primary-soft text-primary")}
            onClick={() => {
              setOpenHeaderPopover(null);
              if (reviewOpen) {
                setMainView("workspace");
              } else {
                void loadReviewChanges();
              }
            }}
            size="sm"
            variant="ghost"
          >
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
              viewBox="0 0 24 24"
            >
              {reviewOpen ? (
                <path d="m15 18-6-6 6-6" />
              ) : (
                <>
                  <path d="M8 5H5v14h3M16 5h3v14h-3" />
                  <path d="m10 9 4 3-4 3" />
                </>
              )}
            </svg>
            {reviewOpen ? "返回编辑" : "版本比对"}
          </Button>
          <div className="relative">
            <Button
              aria-expanded={accountMenuOpen}
              aria-label={`${authUser.id}，${currentRoleLabel}，用户选项`}
              className={cn("gap-ui-2 px-ui-2 font-medium", accountMenuOpen && "bg-surface-muted")}
              onClick={() =>
                setOpenHeaderPopover((current) => (current === "account" ? null : "account"))
              }
              size="sm"
              variant="ghost"
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-ui-full bg-surface-muted text-foreground">
                <UserRoleIcon role={authUser.role} />
              </span>
              <span className="max-w-28 truncate">{authUser.id}</span>
              <svg
                aria-hidden="true"
                className={cn(
                  "h-3.5 w-3.5 text-subtle-foreground transition-transform duration-ui-normal motion-reduce:transition-none",
                  accountMenuOpen && "rotate-180",
                )}
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path d="m7 10 5 5 5-5" />
              </svg>
            </Button>
            {accountMenuOpen ? (
              <div className="absolute right-0 z-30 mt-2 grid w-48 gap-1 rounded-ui-lg border border-ui-border bg-surface p-1.5 shadow-ui-overlay">
                {authUser.role === "admin" ? (
                  <button
                    className="rounded-ui-md border-0 bg-transparent px-ui-3 py-ui-2 text-left text-foreground hover:bg-surface-muted"
                    onClick={() => {
                      setOpenHeaderPopover(null);
                      void openEnvironmentSettings();
                    }}
                    type="button"
                  >
                    租户与环境配置
                  </button>
                ) : null}
                <button
                  className="rounded-ui-md border-0 bg-transparent px-ui-3 py-ui-2 text-left text-foreground hover:bg-surface-muted"
                  onClick={() => {
                    setActiveDialog({ type: "activation" });
                    setOpenHeaderPopover(null);
                  }}
                  type="button"
                >
                  输入激活码
                </button>
                <button
                  className="rounded-ui-md border-0 bg-transparent px-ui-3 py-ui-2 text-left text-foreground hover:bg-surface-muted"
                  onClick={() => void logoutCurrentUser()}
                  type="button"
                >
                  退出登录
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {activationDialogOpen ? (
        <Modal
          className="max-w-md p-ui-4"
          closeDisabled={activatingAdmin}
          labelledBy="activation-dialog-title"
          onClose={() => {
            setActiveDialog(null);
            setActivationCode("");
          }}
        >
          <form onSubmit={(event) => void submitActivationCode(event)}>
            <div className="mb-4">
              <h2 className="m-0 text-xl" id="activation-dialog-title">
                输入激活码
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                激活码和当前账号绑定，校验成功后该账号会升级为管理员。
              </p>
            </div>
            <label className={formRowClass}>
              <span className={formLabelClass}>激活码</span>
              <input
                className={inputClass}
                onChange={(event) => setActivationCode(event.target.value)}
                placeholder="ADM1-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                value={activationCode}
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setActiveDialog(null);
                  setActivationCode("");
                }}
                type="button"
              >
                取消
              </Button>
              <Button
                variant="primary"
                disabled={!activationCode.trim() || activatingAdmin}
                type="submit"
              >
                {activatingAdmin ? "激活中..." : "激活"}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {environmentSettingsDialogOpen ? (
        <Modal
          className="flex h-[min(760px,calc(100vh-2rem))] max-w-6xl flex-col overflow-hidden"
          closeDisabled={savingEnvironmentSettings}
          labelledBy="environment-settings-title"
          onClose={() => {
            setActiveDialog(null);
            setTenantDraft([]);
            setEnvironmentDraft([]);
            setSelectedSettingsTenantId("");
          }}
        >
          <div className="border-b border-ui-border px-ui-5 py-ui-4">
            <h2 className="m-0 text-lg" id="environment-settings-title">
              租户与环境配置
            </h2>
            <div className="mt-1.5 text-sm text-muted-foreground">
              配置结构为“租户 → 环境”。选择左侧租户后，在右侧维护该租户及其环境。
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)] overflow-hidden">
            <aside className="flex min-h-0 flex-col border-r border-ui-border bg-surface-subtle">
              <div className="flex items-center justify-between border-b border-ui-border px-ui-3 py-ui-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">租户</div>
                  <div className="mt-0.5 text-xs text-subtle-foreground">
                    共 {tenantDraft.length} 个
                  </div>
                </div>
                <Button
                  aria-label="新增租户"
                  onClick={addTenantDraft}
                  size="icon"
                  type="button"
                  variant="secondary"
                >
                  <svg
                    aria-hidden="true"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-ui-2">
                {tenantDraft.map((tenant) => {
                  const selected = tenant.id === selectedSettingsTenant?.id;
                  const environmentCount = environmentDraft.filter(
                    (item) => item.tenantId === tenant.id,
                  ).length;
                  return (
                    <button
                      aria-current={selected ? "true" : undefined}
                      className={cn(
                        "mb-ui-1 flex w-full items-center gap-ui-2 rounded-ui-md border px-ui-3 py-ui-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/20",
                        selected
                          ? "border-primary/20 bg-surface text-foreground shadow-ui-xs"
                          : "border-transparent text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                      )}
                      key={tenant.id}
                      onClick={() => setSelectedSettingsTenantId(tenant.id)}
                      type="button"
                    >
                      <span
                        className={cn(
                          "grid h-8 w-8 shrink-0 place-items-center rounded-ui-sm text-xs font-bold",
                          selected
                            ? "bg-primary-soft text-primary"
                            : "bg-surface-muted text-muted-foreground",
                        )}
                      >
                        {tenant.label.trim().slice(0, 1).toLocaleUpperCase() || "租"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {tenant.label || "未命名租户"}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-subtle-foreground">
                          {environmentCount} 个环境
                        </span>
                      </span>
                      <svg
                        aria-hidden="true"
                        className="h-4 w-4 shrink-0 text-subtle-foreground"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                      >
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </button>
                  );
                })}
              </div>
            </aside>

            <div className="min-h-0 overflow-auto bg-surface p-ui-4">
              {selectedSettingsTenant ? (
                (() => {
                  const tenantIndex = tenantDraft.findIndex(
                    (item) => item.id === selectedSettingsTenant.id,
                  );
                  const tenantEnvironments = environmentDraft
                    .map((environment, index) => ({ environment, index }))
                    .filter(
                      ({ environment }) => environment.tenantId === selectedSettingsTenant.id,
                    );
                  return (
                    <div className="mx-auto grid max-w-4xl gap-ui-4">
                      <div className="flex flex-wrap items-center justify-between gap-ui-3">
                        <div className="flex min-w-0 items-center gap-ui-2 text-sm">
                          <span className="font-semibold text-muted-foreground">租户</span>
                          <svg
                            aria-hidden="true"
                            className="h-3.5 w-3.5 text-subtle-foreground"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            viewBox="0 0 24 24"
                          >
                            <path d="m9 18 6-6-6-6" />
                          </svg>
                          <span className="truncate font-semibold text-foreground">
                            {selectedSettingsTenant.label || "未命名租户"}
                          </span>
                        </div>
                        <Button
                          disabled={tenantDraft.length <= 1}
                          onClick={() => removeTenantDraft(tenantIndex)}
                          size="sm"
                          type="button"
                          variant="danger"
                        >
                          删除租户
                        </Button>
                      </div>

                      <section className="rounded-ui-lg border border-ui-border bg-surface-subtle p-ui-3">
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className={formRowClass}>
                            <span className={formLabelClass}>租户名称</span>
                            <input
                              className={inputClass}
                              onChange={(event) =>
                                updateTenantDraft(tenantIndex, { label: event.target.value })
                              }
                              placeholder="例如：config"
                              value={selectedSettingsTenant.label}
                            />
                          </label>
                          <label className={formRowClass}>
                            <span className={formLabelClass}>租户目录</span>
                            <input
                              className={inputClass}
                              onChange={(event) =>
                                updateTenantDraft(tenantIndex, { root: event.target.value })
                              }
                              placeholder="nacos-config/config"
                              value={selectedSettingsTenant.root}
                            />
                          </label>
                        </div>
                      </section>

                      <section>
                        <div className="mb-ui-2 flex flex-wrap items-center justify-between gap-ui-3">
                          <div>
                            <div className="flex items-center gap-ui-2">
                              <h3 className="m-0 text-base text-foreground">环境</h3>
                              <span className="rounded-ui-full bg-surface-muted px-ui-2 py-0.5 text-xs font-medium text-muted-foreground">
                                {tenantEnvironments.length}
                              </span>
                            </div>
                          </div>
                          <Button
                            onClick={() => addEnvironmentDraft(selectedSettingsTenant.id)}
                            size="sm"
                            type="button"
                            variant="secondary"
                          >
                            <svg
                              aria-hidden="true"
                              className="h-4 w-4"
                              fill="none"
                              stroke="currentColor"
                              strokeLinecap="round"
                              strokeWidth="2"
                              viewBox="0 0 24 24"
                            >
                              <path d="M12 5v14M5 12h14" />
                            </svg>
                            新增环境
                          </Button>
                        </div>

                        <div className="grid gap-ui-2 pl-ui-3">
                          {tenantEnvironments.map(({ environment, index }, environmentIndex) => (
                            <div
                              className="grid gap-ui-3 rounded-ui-lg border border-ui-border bg-surface p-ui-3 shadow-ui-xs"
                              key={environment.id || index}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-ui-3">
                                <div className="flex items-center gap-ui-2">
                                  <span className="grid h-6 min-w-6 place-items-center rounded-ui-full bg-primary-soft px-1.5 text-[11px] font-bold text-primary">
                                    {environmentIndex + 1}
                                  </span>
                                  <strong className="text-sm text-foreground">
                                    {environment.label || "未命名环境"}
                                  </strong>
                                </div>
                                <div className="flex flex-wrap items-center gap-ui-3">
                                  <label className="inline-flex items-center gap-ui-2 text-sm font-medium text-muted-foreground">
                                    <input
                                      checked={environment.requiresAdminToEdit}
                                      disabled={environment.kind === "fragment-library"}
                                      onChange={(event) =>
                                        updateEnvironmentDraft(index, {
                                          requiresAdminToEdit: event.target.checked,
                                        })
                                      }
                                      type="checkbox"
                                    />
                                    仅管理员可编辑
                                  </label>
                                  <Button
                                    disabled={tenantEnvironments.length <= 1}
                                    onClick={() => removeEnvironmentDraft(index)}
                                    size="sm"
                                    type="button"
                                    variant="danger"
                                  >
                                    删除
                                  </Button>
                                </div>
                              </div>
                              <div className="grid gap-3 xl:grid-cols-[minmax(150px,0.65fr)_minmax(180px,0.75fr)_minmax(300px,1.4fr)]">
                                <label className={cn(formRowClass, "min-w-0")}>
                                  <span className={formLabelClass}>环境名称</span>
                                  <input
                                    className={cn(inputClass, "min-w-0 w-full")}
                                    onChange={(event) =>
                                      updateEnvironmentDraft(index, { label: event.target.value })
                                    }
                                    placeholder="例如：dev"
                                    value={environment.label}
                                  />
                                </label>
                                <label className={cn(formRowClass, "min-w-0")}>
                                  <span className={formLabelClass}>环境类型</span>
                                  <select
                                    className={cn(inputClass, "min-w-0 w-full")}
                                    onChange={(event) => {
                                      const kind =
                                        event.target.value === "fragment-library"
                                          ? "fragment-library"
                                          : "config";
                                      updateEnvironmentDraft(index, {
                                        kind,
                                        requiresAdminToEdit:
                                          kind === "fragment-library"
                                            ? false
                                            : environment.requiresAdminToEdit,
                                      });
                                    }}
                                    value={environment.kind}
                                  >
                                    <option value="config">普通配置环境</option>
                                    <option value="fragment-library">提示词片段库</option>
                                  </select>
                                </label>
                                <label className={cn(formRowClass, "min-w-0")}>
                                  <span className={formLabelClass}>环境路径</span>
                                  <span className="flex h-9 min-w-0 overflow-hidden rounded-ui-md border border-ui-border bg-surface shadow-ui-xs transition-[border-color,box-shadow] focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10">
                                    <span
                                      className="flex max-w-[62%] shrink-0 items-center truncate border-r border-ui-border bg-surface-muted px-ui-3 font-mono text-xs text-muted-foreground"
                                      title={`${selectedSettingsTenant.root.replace(/^\/+|\/+$/g, "")}/`}
                                    >
                                      {selectedSettingsTenant.root.replace(/^\/+|\/+$/g, "") ||
                                        "租户目录"}
                                      /
                                    </span>
                                    <input
                                      aria-label={`${environment.label || "环境"}的租户内相对路径`}
                                      className="h-full min-w-0 flex-1 border-0 bg-transparent px-ui-3 font-mono text-sm text-foreground outline-none placeholder:text-subtle-foreground"
                                      onChange={(event) =>
                                        updateEnvironmentDraft(index, {
                                          root: buildEnvironmentRoot(
                                            selectedSettingsTenant.root,
                                            event.target.value,
                                          ),
                                        })
                                      }
                                      placeholder="dev"
                                      value={getEnvironmentRootSuffix(
                                        environment.root,
                                        selectedSettingsTenant.root,
                                      )}
                                    />
                                  </span>
                                </label>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    </div>
                  );
                })()
              ) : (
                <div className={emptyBlockClass}>请先新增租户</div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end border-t border-ui-border bg-surface-subtle px-ui-5 py-ui-3">
            <div className="flex gap-ui-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setActiveDialog(null);
                  setTenantDraft([]);
                  setEnvironmentDraft([]);
                  setSelectedSettingsTenantId("");
                }}
                type="button"
              >
                取消
              </Button>
              <Button
                variant="primary"
                disabled={savingEnvironmentSettings}
                onClick={() => void saveEnvironmentSettings()}
                type="button"
              >
                {savingEnvironmentSettings ? "保存中..." : "保存配置"}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      <div
        ref={layoutRef}
        className={cn(
          "grid h-[calc(100vh-52px)] min-h-0 gap-0 overflow-hidden bg-surface",
          reviewOpen ? "grid-cols-1" : "grid-cols-[var(--file-list-grid)]",
        )}
        style={workspaceLayoutStyle}
      >
        {!reviewOpen ? (
          <aside className="relative flex min-h-0 min-w-0 flex-col overflow-x-hidden border-r border-ui-border bg-surface-subtle px-ui-3 pt-ui-3">
            <TenantSwitcher
              tenants={tenantOptions}
              onValueChange={switchTenant}
              value={activeTenant?.id ?? ""}
            />
            <EnvironmentSwitcher
              environments={tenantEnvironmentOptions}
              onValueChange={switchEnvironment}
              value={activeEnvironment?.id ?? ""}
            />

            <div className="mb-ui-3 flex items-center gap-ui-2">
              <label className={cn(searchFieldShellClass, "min-w-0 flex-1")}>
                <SearchIcon />
                <input
                  aria-label="搜索文件名"
                  className={searchFieldInputClass}
                  ref={fileSearchInputRef}
                  value={fileQuery}
                  onChange={(event) => setFileQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder="搜索文件名"
                />
                <kbd className={searchShortcutClass}>{shortcutModifier}P</kbd>
              </label>
              {activeEnvironment ? (
                <ToolbarIconButton
                  className="h-9 w-9 shrink-0"
                  disabled={!canOperateCurrentEnvironmentFiles}
                  label={isFragmentLibrary ? "新建片段" : "新建配置文件"}
                  onClick={() => setActiveDialog({
                    type: isFragmentLibrary ? "fragment-file" : "config-file",
                    mode: "create",
                  })}
                  variant="secondary"
                >
                  <svg
                    aria-hidden="true"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="1.8"
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </ToolbarIconButton>
              ) : null}
            </div>

            <div className="-mx-1 min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-ui-2 py-ui-2">
              {visibleFiles.length === 0 ? (
                <div className={emptyBlockClass}>仓库中还没有可展示的文本文件</div>
              ) : filteredVisibleFiles.length === 0 ? (
                <div className={emptyBlockClass}>没有匹配当前检索条件的文件</div>
              ) : (
                <FileTree
                  nodes={fileTree}
                  selectedPath={selectedPath}
                  onSelect={setSelectedPath}
                  onRename={
                    canOperateCurrentEnvironmentFiles
                      ? (pathValue) => {
                        setSelectedPath(pathValue);
                        setActiveDialog(
                          isFragmentLibrary
                            ? { type: "fragment-file", mode: "rename" }
                            : { type: "config-file", mode: "rename", path: pathValue },
                        );
                      }
                      : undefined
                  }
                  onDelete={
                    canOperateCurrentEnvironmentFiles
                      ? (pathValue) => void (isFragmentLibrary
                        ? deleteFragment(pathValue)
                        : deleteConfig(pathValue))
                      : undefined
                  }
                  tone={isFragmentLibrary ? "fragment" : "config"}
                />
              )}
            </div>
            <button
              type="button"
              aria-label="拖动调整文件列表宽度"
              className={cn(
                "absolute inset-y-0 right-0 hidden w-3 cursor-col-resize touch-none after:absolute after:inset-y-0 after:right-0 after:w-0.5 after:transition-colors min-[961px]:block",
                resizingFileList ? "after:bg-primary/70" : "hover:after:bg-ui-border-strong",
              )}
              onPointerDown={startFileListResize}
            />
          </aside>
        ) : null}

        <main className="flex min-h-0 min-w-0 flex-col">
          {reviewOpen ? (
            <section className={cn(workspaceWindowClass, "flex flex-col bg-surface p-ui-4")}>
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="m-0 text-lg">版本比对</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span>
                      租户：
                      <span className="font-medium text-foreground">
                        {activeTenant?.label ?? "当前租户"}
                      </span>
                    </span>
                    <span>
                      环境：
                      <span className="font-medium text-foreground">
                        {activeEnvironment?.label ?? "当前环境"}
                      </span>
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <input
                        className={cn(inputClass, "review-date-input h-[34px] w-[160px] py-1.5")}
                        type="date"
                        value={reviewSince}
                        onChange={(event) => reviewController.setSince(event.target.value)}
                      />
                      <span className="text-subtle-foreground">-</span>
                      <input
                        className={cn(inputClass, "review-date-input h-[34px] w-[160px] py-1.5")}
                        type="date"
                        value={reviewUntil}
                        onChange={(event) => reviewController.setUntil(event.target.value)}
                      />
                    </div>
                  </div>
                  <Button
                    className="w-[72px] px-0"
                    variant="secondary"
                    type="button"
                    onClick={() => void loadReviewChanges()}
                    disabled={reviewLoading}
                  >
                    {reviewLoading ? "查询中..." : "查询"}
                  </Button>
                </div>
              </div>

              {reviewLoading && reviewCommits.length === 0 ? (
                <div className={emptyBlockClass}>正在查询版本改动...</div>
              ) : reviewCommits.length === 0 ? (
                <div className={emptyBlockClass}>当前环境在该日期之后没有配置改动</div>
              ) : (
                <div className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)] gap-3 overflow-hidden">
                  <div className="min-h-0 overflow-hidden rounded-ui-md border border-ui-border bg-surface-subtle">
                    <div className="border-b border-ui-border px-ui-3 py-ui-2 text-sm font-semibold text-foreground">
                      {reviewCommits.length >= 200
                        ? "最近 200 次相关提交"
                        : `${reviewCommits.length} 次相关提交`}
                    </div>
                    <div className="h-full min-h-0 overflow-auto p-2">
                      {reviewCommits.map((commit) => {
                        const isSelected = commit.hash === selectedReviewCommit?.hash;
                        return (
                          <button
                            key={commit.hash}
                            className={cn(
                              "mb-1.5 w-full rounded-lg border px-3 py-2.5 text-left transition duration-200",
                              isSelected
                                ? "border-primary/25 bg-surface shadow-ui-sm"
                                : "border-transparent bg-transparent hover:bg-surface/75",
                            )}
                            type="button"
                            onClick={() => selectReviewCommit(commit)}
                          >
                            <span className="block break-words text-sm font-semibold text-foreground">
                              {commit.message || "更新配置"}
                            </span>
                            <span className="mt-2 flex flex-wrap items-center gap-ui-2 text-xs text-muted-foreground">
                              <span>{commit.authorName}</span>
                              <span>{formatTime(commit.committedAt)}</span>
                              <span>{commit.files.length} 个文件</span>
                            </span>
                            <span className="mt-2 block break-all font-mono text-[12px] text-subtle-foreground">
                              {commit.hash}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="min-h-0 min-w-0 overflow-auto">
                    {selectedReviewCommit ? (
                      <>
                        <div className="mb-3.5 flex flex-wrap items-center gap-2">
                          <span className="break-all font-mono text-xs text-muted-foreground">
                            {selectedReviewCommit.hash}
                          </span>
                          <span className="rounded-ui-full bg-primary-soft px-ui-3 py-1.5 text-xs text-primary">
                            {selectedReviewCommit.files.length} 个文件
                          </span>
                        </div>
                        <div className="mb-3 grid max-h-[220px] gap-1.5 overflow-auto rounded-ui-md border border-ui-border bg-surface-subtle p-ui-2">
                          {selectedReviewCommit.files.map((file) => (
                            <button
                              key={`${selectedReviewCommit.hash}-${file.path}`}
                              className={cn(
                                "grid grid-cols-[48px_minmax(0,1fr)] items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition",
                                selectedReviewPath === file.path
                                  ? "bg-surface text-foreground shadow-ui-xs"
                                  : "text-muted-foreground hover:bg-surface/75",
                              )}
                              type="button"
                              onClick={() => void loadReviewDiff(selectedReviewCommit, file.path)}
                            >
                              <span className="font-mono text-xs text-subtle-foreground">
                                {file.status}
                              </span>
                              <span className="min-w-0 break-all">{file.path}</span>
                            </button>
                          ))}
                        </div>
                        {reviewDiffLoading ? (
                          <div className={emptyBlockClass}>正在加载文件差异...</div>
                        ) : reviewDiff ? (
                          <LazyDiffView
                            before={reviewDiff.beforeContent}
                            after={reviewDiff.afterContent}
                            emptyText="该文件在此提交中没有内容变化"
                            className="max-h-[520px] overflow-auto"
                          />
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              )}
            </section>
          ) : null}

          <section
            aria-hidden={reviewOpen || activeWorkspaceSection !== "editor"}
            aria-labelledby="file-editor-tab"
            className={cn(
              workspaceWindowClass,
              "h-auto flex-1 bg-surface p-ui-4",
              !reviewOpen && activeWorkspaceSection === "editor" ? "flex flex-col" : "hidden",
            )}
            id="file-editor-panel"
            role="tabpanel"
          >
            <FileWorkspaceHeader isReadOnly={isProtectedFileReadOnly} selectedPath={selectedPath} />
            <WorkspaceSectionTabs
              activeSection={activeWorkspaceSection}
              onChange={(section) => {
                setActiveWorkspaceSection(section);
                if (section === "editor") {
                  window.requestAnimationFrame(() => editorViewRef.current?.requestMeasure());
                }
              }}
            />

            {fileConflict ? (
              <div className="mb-3 grid gap-2 rounded-ui-md border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <strong>检测到远程冲突</strong>
                    <div className="mt-1 text-danger">远程文件已更新，你的编辑内容已保留。</div>
                  </div>
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => {
                      setEditorContent(fileConflict.remoteContent);
                      setEditorDirty(false);
                      setFileDetail((current) =>
                        current
                          ? {
                            ...current,
                            content: fileConflict.remoteContent,
                            remoteContent: fileConflict.remoteContent,
                            headContent: fileConflict.remoteContent,
                            baseHead: fileConflict.remoteHead ?? current.baseHead,
                            baseBlob: fileConflict.remoteBlob,
                            remoteHead: fileConflict.remoteHead,
                            remoteBlob: fileConflict.remoteBlob,
                            isDirty: false,
                          }
                          : current,
                      );
                      setFileConflict(null);
                    }}
                  >
                    使用远程版本
                  </Button>
                </div>
                <LazyDiffView
                  before={fileConflict.remoteContent}
                  after={fileConflict.localContent}
                  emptyText="远程版本与我的修改没有内容差异"
                />
              </div>
            ) : null}

            <div className="flex min-h-[42px] min-w-0 items-center justify-between gap-ui-3 rounded-t-ui-md border border-ui-border bg-surface-subtle px-ui-2 py-0.5">
              <div className="flex shrink-0 items-center pl-ui-1">
                <SegmentedControl
                  ariaLabel="编辑模式"
                  className="w-[124px] shrink-0"
                  items={[
                    { value: "editor", label: "编辑" },
                    { value: "diff", label: "对比" },
                  ]}
                  onValueChange={setEditorViewMode}
                  size="sm"
                  tone="neutral"
                  value={editorViewMode}
                />
              </div>
              <div className="flex min-w-0 items-center gap-ui-1">
                {pendingReplay && editorViewMode === "editor" ? (
                  <Button
                    onClick={replayExtractedChange}
                    disabled={!selectedPath || authUser?.role !== "admin"}
                    size="sm"
                    variant="secondary"
                  >
                    重放修改 {pendingReplay.hash.slice(0, 8)}
                  </Button>
                ) : null}
                <ToolbarIconButton
                  aria-expanded={editorSearchOpen}
                  className={editorSearchOpen ? "bg-primary-soft text-primary" : undefined}
                  onClick={() =>
                    editorSearchOpen ? editorSearchController.close() : openEditorSearch()
                  }
                  disabled={!selectedPath}
                  label={`搜索内容（${shortcutModifier}F）`}
                  variant="ghost"
                >
                  <svg
                    aria-hidden="true"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                    viewBox="0 0 24 24"
                  >
                    <circle cx="11" cy="11" r="6.5" />
                    <path d="m16 16 4 4" />
                  </svg>
                </ToolbarIconButton>
                <ToolbarIconButton
                  onClick={isFragmentLibrary ? formatEditorAsXml : validateEditorAsYaml}
                  disabled={!selectedPath}
                  label={isFragmentLibrary ? "格式化 XML" : "校验 YAML"}
                  variant="ghost"
                >
                  <svg
                    aria-hidden="true"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                    viewBox="0 0 24 24"
                  >
                    <path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3" />
                    {isFragmentLibrary ? (
                      <path d="m9 9-2 3 2 3M15 9l2 3-2 3M13 8l-2 8" />
                    ) : (
                      <path d="m8 12 2.5 2.5L16 9" />
                    )}
                  </svg>
                </ToolbarIconButton>
                {editorViewMode === "diff" ? (
                  <div
                    className="ml-ui-1 flex items-center gap-ui-1 border-l border-ui-border pl-ui-2"
                    aria-label="差异导航"
                  >
                    <ToolbarIconButton
                      onClick={() => goToAdjacentChange(-1)}
                      disabled={!selectedPath}
                      label="上个差异"
                      variant="ghost"
                    >
                      <svg
                        aria-hidden="true"
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                      >
                        <path d="m7 14 5-5 5 5" />
                      </svg>
                    </ToolbarIconButton>
                    <ToolbarIconButton
                      onClick={() => goToAdjacentChange(1)}
                      disabled={!selectedPath}
                      label="下个差异"
                      variant="ghost"
                    >
                      <svg
                        aria-hidden="true"
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                      >
                        <path d="m7 10 5 5 5-5" />
                      </svg>
                    </ToolbarIconButton>
                  </div>
                ) : null}
                {!isFragmentLibrary ? (
                  <span
                    className="ml-ui-1 inline-flex border-l border-ui-border pl-ui-2"
                    title={hasPendingChanges ? "请先提交当前文件，再执行晋级" : undefined}
                  >
                    <Button
                      disabled={!selectedPath || !fileDetail || hasPendingChanges || fileOperationInProgress || committing || syncing}
                      onClick={() => setActiveDialog({ type: "file-promotion", sourcePath: selectedPath })}
                    >
                      晋级
                    </Button>
                  </span>
                ) : null}
                {isFragmentLibrary ? (
                  <span
                    className="ml-ui-1 inline-flex border-l border-ui-border pl-ui-2"
                    title={
                      !selectedPath
                        ? "请先选择一个片段"
                        : hasPendingChanges
                          ? "请先提交当前片段，再执行批量替换"
                          : fragmentFileOperation
                            ? "正在处理片段文件"
                            : undefined
                    }
                  >
                    <Button
                      disabled={!selectedPath || hasPendingChanges || fragmentFileOperation}
                      onClick={() => setActiveDialog({ type: "fragment-batch" })}
                      variant="primary"
                    >
                      批量替换
                    </Button>
                  </span>
                ) : null}
              </div>
            </div>

            <div
              className={cn(
                "relative min-h-0 flex-1 overflow-hidden border border-t-0 border-ui-border",
                !fileValidationError && !hasPendingChanges && "rounded-b-ui-md",
              )}
            >
              {editorSearchOpen ? (
                <div
                  className={cn(
                    searchFieldShellClass,
                    "absolute right-ui-2 top-ui-2 z-20 w-[560px] max-w-[calc(100%_-_16px)] py-ui-1 shadow-ui-overlay",
                  )}
                  role="search"
                >
                  <SearchIcon />
                  <input
                    aria-label="搜索当前文件内容"
                    className={searchFieldInputClass}
                    disabled={!selectedPath}
                    onChange={(event) => updateEditorSearch(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        findAdjacentEditorSearchMatch(event.shiftKey ? -1 : 1);
                      }
                      if (event.key === "Escape") {
                        editorSearchController.close();
                        editorViewRef.current?.focus();
                      }
                    }}
                    placeholder="搜索当前文件内容"
                    ref={editorSearchInputRef}
                    value={editorSearchInput}
                  />
                  <Badge variant="neutral">
                    {editorSearch
                      ? `${displayedEditorSearchIndex + 1 || 0}/${editorSearchMatches.length}`
                      : "0/0"}
                  </Badge>
                  <IconButton
                    disabled={!editorSearchInput}
                    label="查找上一处"
                    onClick={() => findAdjacentEditorSearchMatch(-1)}
                    size="sm"
                    variant="ghost"
                  >
                    ↑
                  </IconButton>
                  <IconButton
                    disabled={!editorSearchInput}
                    label="查找下一处"
                    onClick={() => findAdjacentEditorSearchMatch(1)}
                    size="sm"
                    variant="ghost"
                  >
                    ↓
                  </IconButton>
                  <IconButton
                    label="关闭内容搜索"
                    onClick={() => {
                      editorSearchController.close();
                      editorViewRef.current?.focus();
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    ×
                  </IconButton>
                </div>
              ) : null}
              {!reviewOpen && activeWorkspaceSection === "editor" ? (
                editorViewMode === "diff" ? (
                  <div
                    ref={editorSurfaceRef}
                    className="relative h-full min-h-0 overflow-hidden bg-surface-subtle/95"
                  >
                    <LazyMergeConfigEditor
                      filePath={selectedPath}
                      languageMode={isFragmentLibrary ? "xml" : "auto"}
                      original={pendingBaseContent}
                      value={editorContent}
                      disabled={!selectedPath || isProtectedFileReadOnly}
                      placeholderText="请选择要编辑的文件"
                      validationIssue={editorValidationIssue}
                      searchMatches={editorSearchOpen ? editorSearchMatches : []}
                      activeSearchMatchIndex={
                        editorSearchOpen ? displayedEditorSearchIndex : -1
                      }
                      onViewReady={(view) => {
                        editorViewRef.current = view;
                      }}
                      onChange={(view) => {
                        setEditorDirty(true);
                        setFileValidationError(null);
                        setEditorContent(view.state.doc.toString());
                      }}
                    />
                  </div>
                ) : (
                  <div key="editor" className="h-full min-h-0">
                    <div
                      ref={editorSurfaceRef}
                      className={cn(
                        "relative overflow-hidden bg-surface-subtle/95",
                        editorSurfaceHeightClass,
                      )}
                    >
                      <LazyConfigEditor
                        filePath={selectedPath}
                        languageMode={isFragmentLibrary ? "xml" : "auto"}
                        value={editorContent}
                        disabled={!selectedPath || isProtectedFileReadOnly}
                        placeholderText="请选择要编辑的文件"
                        validationIssue={editorValidationIssue}
                        searchMatches={editorSearchOpen ? editorSearchMatches : []}
                        activeSearchMatchIndex={
                          editorSearchOpen ? displayedEditorSearchIndex : -1
                        }
                        onViewReady={(view) => {
                          editorViewRef.current = view;
                        }}
                        onChange={(view) => {
                          setEditorDirty(true);
                          setFileValidationError(null);
                          setEditorContent(view.state.doc.toString());
                        }}
                      />
                    </div>
                  </div>
                )
              ) : null}
            </div>

            {fileValidationError ? (
              <div
                className={cn(
                  "flex items-start gap-ui-2 border border-t-0 border-danger/15 bg-danger-soft px-ui-3 py-ui-2 text-sm text-danger",
                  !hasPendingChanges && "rounded-b-ui-md",
                )}
              >
                <strong className="shrink-0">格式校验未通过</strong>
                <span className="min-w-0 break-words">{fileValidationError}</span>
              </div>
            ) : null}

            {hasPendingChanges ? (
              <div className="grid grid-cols-[minmax(260px,1fr)_auto] items-center gap-ui-2 rounded-b-ui-md border border-t-0 border-ui-border bg-surface px-ui-3 py-ui-2">
                <textarea
                  className={cn(inputClass, "min-h-9 resize-none py-ui-2 text-sm")}
                  disabled={isProtectedFileReadOnly}
                  rows={1}
                  value={gitForm.extraMessage}
                  placeholder={
                    isProtectedFileReadOnly ? "当前环境仅管理员可提交" : "填写本次修改说明"
                  }
                  onChange={(event) =>
                    setGitForm((current) => ({
                      ...current,
                      extraMessage: event.target.value,
                    }))
                  }
                />
                <div className="flex items-center gap-ui-2">
                  <Button
                    className="text-muted-foreground hover:bg-danger-soft hover:text-danger"
                    variant="ghost"
                    onClick={() => void discardCurrentFile()}
                    disabled={!canDiscardCurrentFile || discarding}
                    size="sm"
                    title="丢弃当前文件的全部未提交修改"
                  >
                    {discarding ? "丢弃中..." : "丢弃"}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      if (isProtectedFileReadOnly) {
                        setError("普通用户在当前环境仅可查看文件与历史记录");
                        return;
                      }
                      setActiveDialog({ type: "commit" });
                    }}
                    disabled={!selectedPath || isProtectedFileReadOnly || committing || discarding}
                  >
                    {committing ? "提交中..." : "提交并推送"}
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          <section
            aria-hidden={reviewOpen || activeWorkspaceSection !== "history"}
            aria-labelledby="file-history-tab"
            className={cn(
              workspaceWindowClass,
              "h-auto flex-1 bg-surface p-ui-4",
              !reviewOpen && activeWorkspaceSection === "history" ? "flex flex-col" : "hidden",
            )}
            id="file-history-panel"
            role="tabpanel"
          >
            <FileWorkspaceHeader isReadOnly={isProtectedFileReadOnly} selectedPath={selectedPath} />
            <WorkspaceSectionTabs
              activeSection={activeWorkspaceSection}
              onChange={(section) => {
                setActiveWorkspaceSection(section);
                if (section === "editor") {
                  window.requestAnimationFrame(() => editorViewRef.current?.requestMeasure());
                }
              }}
            />

            {selectedHistory ? (
              <div className="grid min-h-0 flex-1 gap-3 min-[1080px]:grid-cols-[340px_minmax(0,1fr)]">
                <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-ui-border bg-surface-subtle">
                  <div className="border-b border-ui-border px-ui-3 py-ui-2 text-sm font-semibold text-foreground">
                    历史提交
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto p-2">
                    {fileHistory.map((commit) => {
                      const isSelected = commit.hash === selectedHistory.hash;
                      const commitSubject = getCommitSubject(commit.message);
                      return (
                        <button
                          key={commit.hash}
                          className={cn(
                            "mb-1.5 w-full rounded-lg border px-3 py-2.5 text-left transition duration-200",
                            isSelected
                              ? "border-primary/25 bg-surface shadow-ui-sm"
                              : "border-transparent bg-transparent hover:bg-surface/75",
                          )}
                          type="button"
                          onClick={() => {
                            if (commit.hash !== selectedHistory?.hash) {
                              historyController.selectHash(commit.hash);
                            }
                          }}
                        >
                          <span className="block break-words text-sm font-semibold text-foreground">
                            {commitSubject}
                          </span>
                          <span className="mt-2 flex flex-wrap items-center gap-ui-2 text-xs text-muted-foreground">
                            <span>{commit.authorName}</span>
                            <span>{formatTime(commit.committedAt)}</span>
                          </span>
                          <span className="mt-2 block break-all font-mono text-[12px] text-subtle-foreground">
                            {commit.hash}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex min-h-0 min-w-0 flex-col">
                  <div className="mb-3.5 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="break-words text-base font-bold text-foreground">
                        {getCommitSubject(selectedHistory.message)}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2.5 text-[13px] text-muted-foreground">
                        <span className="inline-flex min-h-7 items-center rounded-ui-full bg-foreground/[0.06] px-ui-3">
                          {selectedHistory.authorName}
                        </span>
                        <span className="inline-flex min-h-7 items-center rounded-ui-full bg-foreground/[0.06] px-ui-3">
                          {formatTime(selectedHistory.committedAt)}
                        </span>
                        <span className="inline-flex min-h-7 max-w-full items-center break-all rounded-ui-full bg-foreground/[0.06] px-ui-3 font-mono text-[13px]">
                          {selectedHistory.hash}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="secondary"
                          type="button"
                          onClick={() =>
                            selectedHistoryDetail && extractHistoryReplay(selectedHistoryDetail)
                          }
                          disabled={
                            !selectedPath ||
                            authUser?.role !== "admin" ||
                            !selectedHistoryDetail ||
                            selectedHistoryDetail.beforeContent ===
                            selectedHistoryDetail.afterContent
                          }
                        >
                          {pendingReplay?.hash === selectedHistory.hash &&
                            pendingReplay.sourcePath === selectedPath
                            ? "已提取修改"
                            : "提取修改"}
                        </Button>
                        <span className="group/help relative inline-flex">
                          <IconButton
                            aria-describedby="history-replay-help"
                            className="h-6 w-6 rounded-ui-full text-[length:var(--font-size-ui-xs)] font-bold"
                            label="查看提取修改说明"
                            size="sm"
                          >
                            ?
                          </IconButton>
                          <span
                            id="history-replay-help"
                            role="tooltip"
                            className="pointer-events-none invisible absolute bottom-[calc(100%+10px)] right-0 z-30 w-80 max-w-[calc(100vw-32px)] translate-y-1 rounded-ui-md border border-foreground/10 bg-foreground px-3.5 py-ui-3 text-left text-xs font-normal leading-relaxed text-primary-foreground opacity-0 shadow-ui-overlay transition duration-150 group-hover/help:visible group-hover/help:translate-y-0 group-hover/help:opacity-100 group-focus-within/help:visible group-focus-within/help:translate-y-0 group-focus-within/help:opacity-100 motion-reduce:transition-none"
                          >
                            <span className="block font-semibold">
                              提取修改后，可尝试重放到任意环境或文件。
                            </span>
                            <span className="mt-1.5 block text-primary-foreground/75">
                              仅当待修改内容及其前后各约 4
                              行上下文完全匹配时才会成功。内容已变更、上下文不足或存在重复时，不会执行重放。
                            </span>
                            <span className="absolute -bottom-1 right-2.5 h-2 w-2 rotate-45 bg-foreground" />
                          </span>
                        </span>
                      </div>
                      <Button
                        variant="primary"
                        type="button"
                        onClick={() =>
                          selectedHistoryDetail && void restoreHistoryCommit(selectedHistoryDetail)
                        }
                        disabled={
                          !selectedPath ||
                          isProtectedFileReadOnly ||
                          restoringHash !== null ||
                          !selectedHistoryDetail
                        }
                      >
                        {restoringHash === selectedHistory.hash ? "回滚中..." : "回滚到此版本"}
                      </Button>
                    </div>
                  </div>
                  {historyDetailLoading ? (
                    <div className={emptyBlockClass}>正在加载历史差异...</div>
                  ) : selectedHistoryDetail ? (
                    <LazyDiffView
                      before={selectedHistoryDetail.beforeContent}
                      after={selectedHistoryDetail.afterContent}
                      emptyText="该提交没有内容变化"
                      display="unified"
                      className="min-h-0 flex-1 overflow-auto"
                    />
                  ) : (
                    <div className={emptyBlockClass}>历史差异加载失败，请重新选择该提交</div>
                  )}
                </div>
              </div>
            ) : (
              <div className={cn(emptyBlockClass, "flex flex-1 items-center justify-center")}>
                当前文件还没有历史记录可展示
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
