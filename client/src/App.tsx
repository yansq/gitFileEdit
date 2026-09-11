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
import { FileTree } from "./components/FileTree";
import { PromptFragmentBatchDialog } from "./components/PromptFragmentBatchDialog";
import { PromptFragmentFileDialog } from "./components/PromptFragmentFileDialog";
import { ToastStack } from "./components/ToastStack";
import { Badge, Button, IconButton, SegmentedControl } from "./components/ui";
import { useAuthSession } from "./features/auth/useAuthSession";
import { useFileEditor, validateEditorContent } from "./features/editor/useFileEditor";
import { useFileHistory } from "./features/history/useFileHistory";
import { useRepositoryReview } from "./features/review/useRepositoryReview";
import { ApiRequestError, requestJson } from "./lib/api";
import { buildFileTree, getPathWithinRoot, replaceEnvironmentRoot } from "./lib/filePaths";
import { formatTime, formatXml, getCommitSubject } from "./lib/format";
import { applyReplayPatch, createReplayPatch } from "./lib/replayPatch";
import {
  cn,
  editorSurfaceHeightClass,
  emptyBlockClass,
  formLabelClass,
  formRowClass,
  inputClass,
  panelTitleRowClass,
  primaryButtonClass,
  secondaryButtonClass,
  workspaceWindowClass,
} from "./lib/ui";
import type {
  BootstrapResponse,
  CommitSnapshot,
  FileConflictPayload,
  FileDetail,
  RepoEnvironmentOption,
  RepoFileSummary,
} from "./types";

interface EnvironmentSettingsResponse {
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

type MainView = "environment-settings" | "review" | "workspace";
type HeaderPopover = "account" | "repository" | null;
type ActiveDialog =
  | { type: "activation" }
  | { type: "commit" }
  | { type: "fragment-batch" }
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
    <Suspense fallback={<div className="h-full p-4 text-sm text-[#6c7d84]">正在加载编辑器...</div>}>
      <ConfigEditor {...props} />
    </Suspense>
  );
}

function LazyMergeConfigEditor(props: ComponentProps<typeof MergeConfigEditor>): JSX.Element {
  return (
    <Suspense
      fallback={<div className="h-full p-4 text-sm text-[#6c7d84]">正在加载差异编辑器...</div>}
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

function createBlankEnvironment(
  index: number,
  fallback?: RepoEnvironmentOption,
): RepoEnvironmentOption {
  return {
    id: `env-${Date.now()}-${index + 1}`,
    label: "",
    root: fallback?.root ?? "",
    requiresAdminToEdit: false,
    kind: "config",
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
  const [savingEnvironmentSettings, setSavingEnvironmentSettings] = useState(false);
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
  const [fragmentFileOperation, setFragmentFileOperation] = useState(false);

  const accountMenuOpen = openHeaderPopover === "account";
  const showRepoDetails = openHeaderPopover === "repository";
  const showEnvironmentSettings = mainView === "environment-settings";
  const reviewOpen = mainView === "review";
  const confirmingCommit = activeDialog?.type === "commit";
  const activationDialogOpen = activeDialog?.type === "activation";
  const fragmentBatchOpen = activeDialog?.type === "fragment-batch";
  const fragmentFileDialogMode =
    activeDialog?.type === "fragment-file" ? activeDialog.mode : null;
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
  const environmentOptions = bootstrap?.config.environments ?? [];
  const activeEnvironment =
    environmentOptions.find((item) => item.id === selectedEnvironment) ?? environmentOptions[0];
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
    onAuthenticated: () => refreshBootstrap(undefined, false),
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

  async function refreshBootstrap(preferredPath?: string, preserveForm = true): Promise<void> {
    const data = await requestJson<BootstrapResponse>("/api/bootstrap");
    const nextPath =
      preferredPath && data.files.some((file) => file.path === preferredPath)
        ? preferredPath
        : (data.selectedFile ?? "");
    const environmentOptions = data.config.environments;
    const derivedEnvironment =
      environmentOptions.find((item) => nextPath && getPathWithinRoot(nextPath, item.root) !== null)
        ?.id ||
      environmentOptions[0]?.id ||
      "";

    startTransition(() => {
      setBootstrap(data);
      setSelectedEnvironment((current) =>
        current && environmentOptions.some((item) => item.id === current)
          ? current
          : derivedEnvironment,
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
  }

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
          await refreshBootstrap(selectedPath);
          if (selectedPath) {
            await refreshFile(selectedPath, true);
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
    if (!authUser || !message) {
      return;
    }

    const timer = window.setTimeout(() => {
      setMessage(null);
    }, 3200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [authUser, message]);

  useEffect(() => {
    if (!authUser || !liveNotice) {
      return;
    }

    const timer = window.setTimeout(() => {
      setLiveNotice(null);
    }, 3200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [authUser, liveNotice]);

  useEffect(() => {
    if (!authUser || !error) {
      return;
    }

    const timer = window.setTimeout(() => {
      setError(null);
    }, 5200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [authUser, error]);

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
      setEnvironmentDraft(payload.environments);
      setMainView("environment-settings");
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

  function addEnvironmentDraft(): void {
    setEnvironmentDraft((current) => [
      ...current,
      createBlankEnvironment(current.length, current[current.length - 1]),
    ]);
  }

  function removeEnvironmentDraft(index: number): void {
    setEnvironmentDraft((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function saveEnvironmentSettings(): Promise<void> {
    const normalized = environmentDraft.map((item, index) => ({
      ...item,
      id: item.id.trim() || createEnvironmentId(item.label, index),
      label: item.label.trim(),
      root: item.root.trim().replace(/^\/+|\/+$/g, ""),
    }));
    if (!normalized.length) {
      setError("至少需要保留一个环境配置");
      return;
    }
    if (normalized.some((item) => !item.label || !item.root)) {
      setError("环境名称和展示目录不能为空");
      return;
    }

    setSavingEnvironmentSettings(true);
    setError(null);
    setMessage(null);
    try {
      const payload = await requestJson<EnvironmentSettingsResponse>("/api/settings/environments", {
        method: "PUT",
        body: JSON.stringify({
          environments: normalized,
        }),
      });
      setEnvironmentDraft(payload.environments);
      await refreshBootstrap(selectedPath || undefined);
      setMainView("workspace");
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

  const isFragmentLibrary = activeEnvironment?.kind === "fragment-library";
  const selectedFragmentRelativePath =
    isFragmentLibrary && selectedPath && activeEnvironment
      ? (getPathWithinRoot(selectedPath, activeEnvironment.root) ?? "")
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
  }, [
    activeDialog,
    activeWorkspaceSection,
    authUser,
    mainView,
    selectedPath,
  ]);

  function scrollToEditorSearchMatch(match: { from: number; to: number }): void {
    const view = editorViewRef.current;
    if (!view) {
      return;
    }

    const line = view.state.doc.lineAt(match.from);
    const block = view.lineBlockAt(match.from);
    const maxScrollTop = view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight;
    view.dispatch({
      selection: EditorSelection.single(match.from, match.to),
    });
    const nextScrollTop = Math.max(
      0,
      Math.min(maxScrollTop, block.top - view.scrollDOM.clientHeight / 2 + block.height / 2),
    );
    view.scrollDOM.scrollTop = nextScrollTop;
  }

  function findAdjacentEditorSearchMatch(direction: -1 | 1): void {
    const currentContent = getLatestEditorContent();
    if (currentContent !== editorContent) {
      setEditorContent(currentContent);
    }
    const match = editorSearchController.findAdjacent(currentContent, direction);
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
    return <div className="p-7 text-[#43555d]">正在加载...</div>;
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
      <ToastStack message={message} liveNotice={liveNotice} error={error} />
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
      {fragmentBatchOpen && selectedPath ? (
        <PromptFragmentBatchDialog
          sourcePath={selectedPath}
          environments={environmentOptions.filter(
            (item) => authUser?.role === "admin" || !item.requiresAdminToEdit,
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
      <header className="relative z-50 flex min-h-[52px] items-center justify-between gap-4 overflow-visible border-b border-ui-border bg-surface px-ui-4 py-ui-2">
        <div className="flex min-w-0 items-center gap-ui-3">
          <span
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-ui-md text-sm font-bold text-white",
              isFragmentLibrary ? "bg-[#7654ca]" : "bg-primary",
            )}
          >
            {isFragmentLibrary ? "PF" : "GF"}
          </span>
          <div className="min-w-0">
            <h1 className="m-0 truncate text-base font-bold text-foreground">
              {isFragmentLibrary ? "提示词片段库" : "配置工作台"}
            </h1>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-ui-2">
          <div className="relative">
            <Button
              aria-expanded={showRepoDetails}
              onClick={() =>
                setOpenHeaderPopover((current) =>
                  current === "repository" ? null : "repository",
                )
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
          </div>
          {!showEnvironmentSettings ? (
            <>
              <Button
                onClick={() =>
                  reviewOpen ? setMainView("workspace") : void loadReviewChanges()
                }
                size="sm"
                variant={reviewOpen ? "primary" : "secondary"}
              >
                {reviewOpen ? "返回文件" : "版本比对"}
              </Button>
              <Button
                onClick={() => void syncRepository()}
                disabled={syncing}
                size="sm"
                variant="secondary"
              >
                {syncing ? "同步中..." : "同步"}
              </Button>
            </>
          ) : null}
          <div className="relative">
            <Button
              aria-expanded={accountMenuOpen}
              onClick={() =>
                setOpenHeaderPopover((current) => (current === "account" ? null : "account"))
              }
              size="sm"
              variant="secondary"
            >
              <span className="max-w-28 truncate">{authUser.id}</span>
              <Badge variant={authUser.role === "admin" ? "primary" : "neutral"}>
                {currentRoleLabel}
              </Badge>
            </Button>
            {accountMenuOpen ? (
              <div className="absolute right-0 z-30 mt-2 grid w-48 gap-1 rounded-ui-lg border border-ui-border bg-surface p-1.5 shadow-ui-overlay">
                {authUser.role === "admin" ? (
                  <button
                    className="rounded-lg border-0 bg-transparent px-3 py-2 text-left text-[#183039] hover:bg-[#143138]/[0.08]"
                    onClick={() => {
                      setOpenHeaderPopover(null);
                      void openEnvironmentSettings();
                    }}
                    type="button"
                  >
                    环境配置
                  </button>
                ) : null}
                <button
                  className="rounded-lg border-0 bg-transparent px-3 py-2 text-left text-[#183039] hover:bg-[#143138]/[0.08]"
                  onClick={() => {
                    setActiveDialog({ type: "activation" });
                    setOpenHeaderPopover(null);
                  }}
                  type="button"
                >
                  输入激活码
                </button>
                <button
                  className="rounded-lg border-0 bg-transparent px-3 py-2 text-left text-[#183039] hover:bg-[#143138]/[0.08]"
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
        <div className="fixed inset-0 z-[100] grid place-items-center bg-[#10262b]/35 px-4">
          <form
            className="w-full max-w-md rounded-lg border border-slate-900/10 bg-white p-4 shadow-[0_28px_80px_rgba(16,38,43,0.24)]"
            onSubmit={(event) => void submitActivationCode(event)}
          >
            <div className="mb-4">
              <h2 className="m-0 text-xl">输入激活码</h2>
              <p className="mt-2 text-sm text-[#728188]">
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
              <button
                className={secondaryButtonClass}
                onClick={() => {
                  setActiveDialog(null);
                  setActivationCode("");
                }}
                type="button"
              >
                取消
              </button>
              <button
                className={primaryButtonClass}
                disabled={!activationCode.trim() || activatingAdmin}
                type="submit"
              >
                {activatingAdmin ? "激活中..." : "激活"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {showEnvironmentSettings ? (
        <main className="h-[calc(100vh-52px)] overflow-auto bg-surface p-ui-4">
          <div className={panelTitleRowClass}>
            <div>
              <h2 className="m-0 text-lg">环境配置</h2>
              <div className="mt-1.5 text-sm text-[#728188]">
                配置环境名称、类型、展示目录和编辑权限。
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                className={secondaryButtonClass}
                onClick={() => {
                  setMainView("workspace");
                  setEnvironmentDraft([]);
                }}
                type="button"
              >
                返回
              </button>
              <button
                className={primaryButtonClass}
                disabled={savingEnvironmentSettings}
                onClick={() => void saveEnvironmentSettings()}
                type="button"
              >
                {savingEnvironmentSettings ? "保存中..." : "保存环境配置"}
              </button>
            </div>
          </div>

          <div className="grid gap-3">
            {environmentDraft.map((environment, index) => (
              <div
                className="grid gap-2 rounded-lg border border-[#183039]/10 bg-[#f6f9f7]/85 p-3"
                key={environment.id || index}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <strong className="text-[#183039]">环境 {index + 1}</strong>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="inline-flex items-center gap-2 text-sm font-semibold text-[#40545b]">
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
                      需要管理员权限编辑
                    </label>
                    <button
                      className="rounded-lg border-0 bg-[#c94a35]/10 px-3 py-2 text-[#9f2f20] transition duration-200 hover:-translate-y-px hover:bg-[#c94a35]/15 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 motion-reduce:hover:translate-y-0 motion-reduce:transition-none"
                      disabled={environmentDraft.length <= 1}
                      onClick={() => removeEnvironmentDraft(index)}
                      type="button"
                    >
                      删除
                    </button>
                  </div>
                </div>
                <div className="grid gap-3 xl:grid-cols-[minmax(160px,0.7fr)_minmax(180px,0.7fr)_minmax(320px,1.4fr)]">
                  <label className={formRowClass}>
                    <span className={formLabelClass}>环境名称</span>
                    <input
                      className={inputClass}
                      onChange={(event) =>
                        updateEnvironmentDraft(index, {
                          label: event.target.value,
                        })
                      }
                      value={environment.label}
                    />
                  </label>
                  <label className={formRowClass}>
                    <span className={formLabelClass}>环境类型</span>
                    <select
                      className={inputClass}
                      onChange={(event) => {
                        const kind =
                          event.target.value === "fragment-library" ? "fragment-library" : "config";
                        updateEnvironmentDraft(index, {
                          kind,
                          requiresAdminToEdit:
                            kind === "fragment-library" ? false : environment.requiresAdminToEdit,
                        });
                      }}
                      value={environment.kind}
                    >
                      <option value="config">普通配置环境</option>
                      <option value="fragment-library">提示词片段库</option>
                    </select>
                  </label>
                  <label className={formRowClass}>
                    <span className={formLabelClass}>展示目录</span>
                    <input
                      className={inputClass}
                      onChange={(event) =>
                        updateEnvironmentDraft(index, {
                          root: event.target.value,
                        })
                      }
                      placeholder="nacos-config/config/dev"
                      value={environment.root}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>

          <button
            className={cn(secondaryButtonClass, "mt-3")}
            onClick={addEnvironmentDraft}
            type="button"
          >
            新增环境
          </button>
        </main>
      ) : (
        <div
          ref={layoutRef}
          className={cn(
            "grid h-[calc(100vh-52px)] min-h-0 gap-0 overflow-hidden bg-surface",
            reviewOpen ? "grid-cols-1" : "grid-cols-[var(--file-list-grid)]",
          )}
          style={workspaceLayoutStyle}
        >
          {!reviewOpen ? (
            <aside
              className={cn(
                "relative flex min-h-0 min-w-0 flex-col overflow-x-hidden border-r border-ui-border bg-surface-subtle p-ui-3",
                isFragmentLibrary && "bg-[#faf9fd]",
              )}
            >
              <div className="mb-ui-3 flex items-center justify-between gap-ui-2">
                <h2 className="m-0 text-base font-bold text-foreground">
                  {isFragmentLibrary ? "提示词片段" : "配置项"}
                </h2>
                <Badge
                  className={isFragmentLibrary ? "bg-[#eee9fb] text-[#6848b8]" : undefined}
                  variant={isFragmentLibrary ? "neutral" : "primary"}
                >
                  {isFragmentLibrary ? "片段库" : "配置环境"}
                </Badge>
              </div>

              <div className={formRowClass}>
                <span className={formLabelClass}>当前环境</span>
                <select
                  className={inputClass}
                  value={activeEnvironment?.id ?? ""}
                  onChange={(event) => {
                    const nextEnvironmentId = event.target.value;
                    setSelectedEnvironment(nextEnvironmentId);
                    reviewController.clearResults();
                    historyController.reset();
                    const nextEnvironment = environmentOptions.find(
                      (item) => item.id === nextEnvironmentId,
                    );
                    const replacedPath = selectedPath
                      ? replaceEnvironmentRoot(selectedPath, environmentOptions, nextEnvironmentId)
                      : null;
                    const nextPath = selectedPath ? replacedPath : null;
                    if (nextPath && files.some((file) => file.path === nextPath)) {
                      setSelectedPath(nextPath);
                      return;
                    }

                    const fallbackPath = nextEnvironment
                      ? (files.find(
                        (file) => getPathWithinRoot(file.path, nextEnvironment.root) !== null,
                      )?.path ?? "")
                      : "";
                    setSelectedPath(fallbackPath);
                  }}
                >
                  {environmentOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              {isFragmentLibrary ? (
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <button
                    className={secondaryButtonClass}
                    disabled={fragmentFileOperation}
                    onClick={() => setActiveDialog({ type: "fragment-file", mode: "create" })}
                    type="button"
                  >
                    新建片段
                  </button>
                  <button
                    className={primaryButtonClass}
                    disabled={!selectedPath || editorDirty || fragmentFileOperation}
                    onClick={() => setActiveDialog({ type: "fragment-batch" })}
                    title={editorDirty ? "请先提交当前片段，再执行批量替换" : undefined}
                    type="button"
                  >
                    批量替换
                  </button>
                </div>
              ) : null}

              <label className={cn(searchFieldShellClass, "mb-ui-3")}>
                <SearchIcon />
                <input
                  aria-label="搜索文件名"
                  className={searchFieldInputClass}
                  ref={fileSearchInputRef}
                  value={fileQuery}
                  onChange={(event) => setFileQuery(event.target.value)}
                  placeholder="搜索文件名"
                />
                <kbd className={searchShortcutClass}>{shortcutModifier}P</kbd>
              </label>

              <div
                className={cn(
                  "-mx-1 min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden rounded-ui-md px-ui-2 py-ui-2",
                  isFragmentLibrary ? "bg-[#f4f1fa]" : "bg-surface-muted/55",
                )}
              >
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
                      isFragmentLibrary && !fragmentFileOperation
                        ? (pathValue) => {
                          setSelectedPath(pathValue);
                          setActiveDialog({ type: "fragment-file", mode: "rename" });
                        }
                        : undefined
                    }
                    onDelete={
                      isFragmentLibrary && !fragmentFileOperation
                        ? (pathValue) => void deleteFragment(pathValue)
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
                  "absolute inset-y-4 right-0 hidden w-3 cursor-col-resize touch-none rounded-full transition min-[961px]:block",
                  resizingFileList ? "bg-[#0e6b72]/15" : "hover:bg-[#0e6b72]/10",
                )}
                onPointerDown={startFileListResize}
              >
                <span
                  className={cn(
                    "absolute inset-y-3 left-1/2 w-px -translate-x-1/2 rounded-full transition",
                    resizingFileList ? "bg-[#0e6b72]/70" : "bg-[#183039]/15",
                  )}
                />
              </button>
            </aside>
          ) : null}

          <main className="flex min-h-0 min-w-0 flex-col">
            {reviewOpen ? (
              <section className={cn(workspaceWindowClass, "flex flex-col bg-surface p-ui-4")}>
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="m-0 text-lg">版本比对</h2>
                    <div className="mt-2 text-sm text-[#5d7077]">
                      {activeEnvironment?.label ?? "当前环境"}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="text-sm text-[#4d6269]">
                      <div className="flex items-center gap-2">
                        <input
                          className={cn(inputClass, "review-date-input h-[34px] w-[160px] py-1.5")}
                          type="date"
                          value={reviewSince}
                          onChange={(event) => reviewController.setSince(event.target.value)}
                        />
                        <span className="text-[#8a999f]">-</span>
                        <input
                          className={cn(inputClass, "review-date-input h-[34px] w-[160px] py-1.5")}
                          type="date"
                          value={reviewUntil}
                          onChange={(event) => reviewController.setUntil(event.target.value)}
                        />
                      </div>
                    </div>
                    <button
                      className={cn(secondaryButtonClass, "w-[72px] justify-center px-0")}
                      type="button"
                      onClick={() => void loadReviewChanges()}
                      disabled={reviewLoading}
                    >
                      {reviewLoading ? "查询中..." : "查询"}
                    </button>
                  </div>
                </div>

                {reviewLoading && reviewCommits.length === 0 ? (
                  <div className={emptyBlockClass}>正在查询版本改动...</div>
                ) : reviewCommits.length === 0 ? (
                  <div className={emptyBlockClass}>当前环境在该日期之后没有配置改动</div>
                ) : (
                  <div className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)] gap-3 overflow-hidden">
                    <div className="min-h-0 overflow-hidden rounded-lg border border-[#183039]/10 bg-[#f6f9f7]/85">
                      <div className="border-b border-[#183039]/10 px-3 py-2 text-sm font-semibold text-[#20404a]">
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
                                  ? "border-[#0e6b72]/25 bg-white shadow-[0_14px_32px_rgba(28,64,54,0.12)]"
                                  : "border-transparent bg-transparent hover:bg-white/75",
                              )}
                              type="button"
                              onClick={() => selectReviewCommit(commit)}
                            >
                              <span className="block break-words text-sm font-semibold text-[#183039]">
                                {commit.message || "更新配置"}
                              </span>
                              <span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#61747b]">
                                <span>{commit.authorName}</span>
                                <span>{formatTime(commit.committedAt)}</span>
                                <span>{commit.files.length} 个文件</span>
                              </span>
                              <span className="mt-2 block break-all font-mono text-[12px] text-[#6b7d84]">
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
                            <span className="break-all font-mono text-xs text-[#5d7077]">
                              {selectedReviewCommit.hash}
                            </span>
                            <span className="rounded-full bg-[#134e5e]/10 px-3 py-1.5 text-xs text-[#214954]">
                              {selectedReviewCommit.files.length} 个文件
                            </span>
                          </div>
                          <div className="mb-3 grid max-h-[220px] gap-1.5 overflow-auto rounded-lg border border-[#183039]/10 bg-[#f6f9f7]/85 p-2">
                            {selectedReviewCommit.files.map((file) => (
                              <button
                                key={`${selectedReviewCommit.hash}-${file.path}`}
                                className={cn(
                                  "grid grid-cols-[48px_minmax(0,1fr)] items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition",
                                  selectedReviewPath === file.path
                                    ? "bg-white text-[#183039] shadow-[0_8px_20px_rgba(28,64,54,0.08)]"
                                    : "text-[#40545b] hover:bg-white/75",
                                )}
                                type="button"
                                onClick={() => void loadReviewDiff(selectedReviewCommit, file.path)}
                              >
                                <span className="font-mono text-xs text-[#7b8d94]">
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

            {!reviewOpen ? (
              <div
                aria-label="当前文件功能"
                className="flex h-12 shrink-0 items-stretch gap-ui-5 border-b border-ui-border bg-surface px-ui-4"
                role="tablist"
              >
                {[
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
                ].map((item) => {
                  const selected = activeWorkspaceSection === item.value;
                  return (
                    <button
                      aria-controls={`file-${item.value}-panel`}
                      aria-selected={selected}
                      className={cn(
                        "relative inline-flex min-w-[92px] items-center justify-center gap-ui-2 px-ui-1 text-sm font-semibold outline-none transition-colors duration-ui-normal ease-ui-standard focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/25 motion-reduce:transition-none",
                        selected
                          ? isFragmentLibrary
                            ? "text-[#6848b8]"
                            : "text-primary"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      id={`file-${item.value}-tab`}
                      key={item.value}
                      onClick={() => {
                        setActiveWorkspaceSection(item.value);
                        if (item.value === "editor") {
                          window.requestAnimationFrame(() =>
                            editorViewRef.current?.requestMeasure(),
                          );
                        }
                      }}
                      role="tab"
                      type="button"
                    >
                      {item.icon}
                      <span>{item.label}</span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute inset-x-1 bottom-0 h-0.5 origin-center rounded-t-ui-full transition-transform duration-ui-normal ease-ui-emphasized motion-reduce:transition-none",
                          isFragmentLibrary ? "bg-[#7654ca]" : "bg-primary",
                          selected ? "scale-x-100" : "scale-x-0",
                        )}
                      />
                    </button>
                  );
                })}
              </div>
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
              <div className="mb-ui-3 flex min-h-12 items-center justify-between gap-ui-4 border-b border-ui-border pb-ui-3">
                <div className="min-w-0">
                  <h2 className="m-0 truncate text-base font-bold text-foreground">
                    {selectedPath ? selectedPath.split("/").pop() : "请选择文件"}
                  </h2>
                  <div className="mt-1 truncate text-xs text-subtle-foreground">
                    {selectedPath || "从左侧文件资源中选择要查看的文件"}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-ui-2 text-xs text-muted-foreground">
                  <Badge
                    className={isFragmentLibrary ? "bg-[#eee9fb] text-[#6848b8]" : undefined}
                    variant={isFragmentLibrary ? "neutral" : "primary"}
                  >
                    {activeEnvironment?.label ?? "未选择环境"}
                  </Badge>
                  {hasPendingChanges ? <Badge variant="warning">有未提交修改</Badge> : null}
                  {isProtectedFileReadOnly ? <Badge variant="warning">普通用户只读</Badge> : null}
                </div>
              </div>

              {fileConflict ? (
                <div className="mb-3 grid gap-2 rounded-lg border border-[#c94a35]/20 bg-[#c94a35]/10 px-3 py-2 text-sm text-[#79301f]">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <strong>检测到远程冲突</strong>
                      <div className="mt-1 text-[#8d3322]">
                        远程文件已更新，你的编辑内容已保留。
                      </div>
                    </div>
                    <button
                      className={secondaryButtonClass}
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
                    </button>
                  </div>
                  <LazyDiffView
                    before={fileConflict.remoteContent}
                    after={fileConflict.localContent}
                    emptyText="远程版本与我的修改没有内容差异"
                  />
                </div>
              ) : null}

              <div className="flex min-h-[42px] min-w-0 items-center justify-between gap-ui-3 border-y border-ui-border bg-surface-subtle px-ui-2 py-ui-1">
                <div className="flex shrink-0 items-center gap-ui-2 pl-ui-2">
                  <span className="text-xs font-semibold text-muted-foreground">编辑模式</span>
                  <SegmentedControl
                    ariaLabel="编辑模式"
                    className="w-[148px] shrink-0 border-ui-border bg-surface"
                    items={[
                      { value: "editor", label: "纯编辑" },
                      { value: "diff", label: "对比" },
                    ]}
                    onValueChange={setEditorViewMode}
                    size="sm"
                    tone="neutral"
                    value={editorViewMode}
                  />
                </div>
                <div className="flex min-w-0 items-center gap-ui-1">
                  {editorViewMode === "diff" ? (
                    <div
                      className="mr-ui-1 flex items-center gap-ui-1 border-r border-ui-border pr-ui-2"
                      aria-label="差异导航"
                    >
                      <Button
                        onClick={() => goToAdjacentChange(-1)}
                        disabled={!selectedPath}
                        size="sm"
                        variant="ghost"
                      >
                        ↑ 上个差异
                      </Button>
                      <Button
                        onClick={() => goToAdjacentChange(1)}
                        disabled={!selectedPath}
                        size="sm"
                        variant="ghost"
                      >
                        ↓ 下个差异
                      </Button>
                    </div>
                  ) : null}
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
                  <Button
                    aria-expanded={editorSearchOpen}
                    onClick={() =>
                      editorSearchOpen
                        ? editorSearchController.close()
                        : openEditorSearch()
                    }
                    disabled={!selectedPath}
                    size="sm"
                    variant={editorSearchOpen ? "secondary" : "ghost"}
                  >
                    搜索内容
                    <kbd className={searchShortcutClass}>{shortcutModifier}F</kbd>
                  </Button>
                  <Button
                    onClick={isFragmentLibrary ? formatEditorAsXml : validateEditorAsYaml}
                    disabled={!selectedPath}
                    size="sm"
                    variant="secondary"
                  >
                    {isFragmentLibrary ? "格式化 XML" : "校验 YAML"}
                  </Button>
                </div>
              </div>

              <div className="relative mt-ui-2 min-h-0 flex-1 overflow-hidden rounded-ui-md border border-ui-border">
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
                      onChange={(event) => editorSearchController.setInput(event.target.value)}
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
                      className="relative h-full min-h-0 overflow-hidden bg-[#fafcfb]/95"
                    >
                      <LazyMergeConfigEditor
                        original={pendingBaseContent}
                        value={editorContent}
                        disabled={!selectedPath || isProtectedFileReadOnly}
                        placeholderText="请选择要编辑的文件"
                        validationIssue={editorValidationIssue}
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
                          "relative overflow-hidden bg-[#fafcfb]/95",
                          editorSurfaceHeightClass,
                        )}
                      >
                        <LazyConfigEditor
                          filePath={selectedPath}
                          value={editorContent}
                          disabled={!selectedPath || isProtectedFileReadOnly}
                          placeholderText="请选择要编辑的文件"
                          validationIssue={editorValidationIssue}
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
                <div className="mt-ui-2 flex items-start gap-ui-2 rounded-ui-md border border-danger/15 bg-danger-soft px-ui-3 py-ui-2 text-sm text-danger">
                  <strong className="shrink-0">格式校验未通过</strong>
                  <span className="min-w-0 break-words">{fileValidationError}</span>
                </div>
              ) : null}

              {hasPendingChanges ? (
                <div className="mt-ui-2 grid grid-cols-[minmax(160px,0.75fr)_minmax(260px,1.3fr)_auto] items-center gap-ui-2 rounded-ui-md border border-ui-border-strong bg-surface px-ui-3 py-ui-2 shadow-ui-sm">
                  <div className="min-w-0">
                    <strong className="block text-sm text-foreground">当前文件有未提交修改</strong>
                  </div>
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
                      variant="danger"
                      onClick={() => void discardCurrentFile()}
                      disabled={!canDiscardCurrentFile || discarding}
                    >
                      {discarding ? "丢弃中..." : "丢弃修改"}
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
                      disabled={
                        !selectedPath || isProtectedFileReadOnly || committing || discarding
                      }
                    >
                      {committing ? "提交中..." : "提交并推送"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-ui-2 flex min-h-9 items-center justify-between rounded-ui-md border border-ui-border bg-surface-subtle px-ui-3 text-xs text-muted-foreground">
                  <span>{selectedPath ? "当前文件没有未提交修改" : "选择文件后可开始编辑"}</span>
                </div>
              )}
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
              <div className="mb-ui-3 flex min-h-12 items-center justify-between gap-ui-4 border-b border-ui-border pb-ui-3">
                <div className="min-w-0">
                  <h2 className="m-0 truncate text-base font-bold text-foreground">
                    {selectedPath ? selectedPath.split("/").pop() : "请选择文件"}
                  </h2>
                  <div className="mt-1 truncate text-xs text-subtle-foreground">
                    {selectedPath || "从左侧文件资源中选择要查看的文件"}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-ui-2 text-xs text-muted-foreground">
                  <Badge
                    className={isFragmentLibrary ? "bg-[#eee9fb] text-[#6848b8]" : undefined}
                    variant={isFragmentLibrary ? "neutral" : "primary"}
                  >
                    {activeEnvironment?.label ?? "未选择环境"}
                  </Badge>
                  <Badge variant="neutral">
                    {fileHistory.length ? `最近 ${fileHistory.length} 次提交` : "暂无提交记录"}
                  </Badge>
                </div>
              </div>

              {selectedHistory ? (
                <div className="grid min-h-0 flex-1 gap-3 min-[1080px]:grid-cols-[340px_minmax(0,1fr)]">
                  <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[#183039]/10 bg-[#f6f9f7]/85">
                    <div className="border-b border-[#183039]/10 px-3 py-2 text-sm font-semibold text-[#20404a]">
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
                                ? "border-[#0e6b72]/25 bg-white shadow-[0_14px_32px_rgba(28,64,54,0.12)]"
                                : "border-transparent bg-transparent hover:bg-white/75",
                            )}
                            type="button"
                            onClick={() => {
                              if (commit.hash !== selectedHistory?.hash) {
                                historyController.selectHash(commit.hash);
                              }
                            }}
                          >
                            <span className="block break-words text-sm font-semibold text-[#183039]">
                              {commitSubject}
                            </span>
                            <span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#61747b]">
                              <span>{commit.authorName}</span>
                              <span>{formatTime(commit.committedAt)}</span>
                            </span>
                            <span className="mt-2 block break-all font-mono text-[12px] text-[#6b7d84]">
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
                        <div className="break-words text-base font-bold text-[#183039]">
                          {getCommitSubject(selectedHistory.message)}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2.5 text-[13px] text-[#55686f]">
                          <span className="inline-flex min-h-7 items-center rounded-full bg-[#143138]/[0.06] px-3">
                            {selectedHistory.authorName}
                          </span>
                          <span className="inline-flex min-h-7 items-center rounded-full bg-[#143138]/[0.06] px-3">
                            {formatTime(selectedHistory.committedAt)}
                          </span>
                          <span className="inline-flex min-h-7 max-w-full items-center break-all rounded-full bg-[#143138]/[0.06] px-3 font-mono text-[13px]">
                            {selectedHistory.hash}
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <div className="flex items-center gap-1">
                          <button
                            className={secondaryButtonClass}
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
                          </button>
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
                              className="pointer-events-none invisible absolute bottom-[calc(100%+10px)] right-0 z-30 w-80 max-w-[calc(100vw-32px)] translate-y-1 rounded-lg border border-[#183039]/10 bg-[#183039] px-3.5 py-3 text-left text-xs font-normal leading-relaxed text-white opacity-0 shadow-[0_14px_36px_rgba(24,48,57,0.24)] transition duration-150 group-hover/help:visible group-hover/help:translate-y-0 group-hover/help:opacity-100 group-focus-within/help:visible group-focus-within/help:translate-y-0 group-focus-within/help:opacity-100 motion-reduce:transition-none"
                            >
                              <span className="block font-semibold">
                                提取修改后，可尝试重放到任意环境或文件。
                              </span>
                              <span className="mt-1.5 block text-white/75">
                                仅当待修改内容及其前后各约 4
                                行上下文完全匹配时才会成功。内容已变更、上下文不足或存在重复时，不会执行重放。
                              </span>
                              <span className="absolute -bottom-1 right-2.5 h-2 w-2 rotate-45 bg-[#183039]" />
                            </span>
                          </span>
                        </div>
                        <button
                          className={primaryButtonClass}
                          type="button"
                          onClick={() =>
                            selectedHistoryDetail &&
                            void restoreHistoryCommit(selectedHistoryDetail)
                          }
                          disabled={
                            !selectedPath ||
                            isProtectedFileReadOnly ||
                            restoringHash !== null ||
                            !selectedHistoryDetail
                          }
                        >
                          {restoringHash === selectedHistory.hash ? "回滚中..." : "回滚到此版本"}
                        </button>
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
      )}
    </div>
  );
}
