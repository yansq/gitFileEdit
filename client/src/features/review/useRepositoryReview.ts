import { useReducer, useRef } from "react";
import { requestJson } from "../../lib/api";
import type { EnvironmentReviewCommit, EnvironmentReviewDiff } from "../../types";

interface ReviewState {
  since: string;
  until: string;
  loading: boolean;
  commits: EnvironmentReviewCommit[];
  selectedHash: string;
  selectedPath: string;
  diff: EnvironmentReviewDiff | null;
  diffLoading: boolean;
}

type ReviewAction =
  | { type: "clearResults" }
  | { type: "diffFailed" }
  | { type: "diffStarted"; hash: string; path: string }
  | { type: "diffSucceeded"; diff: EnvironmentReviewDiff }
  | { type: "queryFailed" }
  | { type: "queryStarted" }
  | { type: "querySucceeded"; commits: EnvironmentReviewCommit[] }
  | { type: "selectCommit"; hash: string }
  | { type: "setSince"; value: string }
  | { type: "setUntil"; value: string };

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createInitialState(): ReviewState {
  return {
    since: toDateInputValue(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)),
    until: toDateInputValue(new Date()),
    loading: false,
    commits: [],
    selectedHash: "",
    selectedPath: "",
    diff: null,
    diffLoading: false,
  };
}

function reducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case "setSince":
      return { ...state, since: action.value };
    case "setUntil":
      return { ...state, until: action.value };
    case "clearResults":
      return {
        ...state,
        loading: false,
        commits: [],
        selectedHash: "",
        selectedPath: "",
        diff: null,
        diffLoading: false,
      };
    case "queryStarted":
      return { ...state, loading: true };
    case "querySucceeded":
      return { ...state, loading: false, commits: action.commits };
    case "queryFailed":
      return { ...state, loading: false };
    case "selectCommit":
      return {
        ...state,
        selectedHash: action.hash,
        selectedPath: "",
        diff: null,
        diffLoading: false,
      };
    case "diffStarted":
      return {
        ...state,
        selectedHash: action.hash,
        selectedPath: action.path,
        diff: null,
        diffLoading: true,
      };
    case "diffSucceeded":
      return { ...state, diff: action.diff, diffLoading: false };
    case "diffFailed":
      return { ...state, diffLoading: false };
  }
}

export function useRepositoryReview(options: {
  environmentId?: string;
  onAuthRequired: (error: unknown) => boolean;
  onError: (message: string | null) => void;
  onOpen: () => void;
}) {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);
  const requestIdRef = useRef(0);
  const diffRequestIdRef = useRef(0);
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  async function loadDiff(
    commit: EnvironmentReviewCommit,
    filePath: string,
    environmentId = options.environmentId,
  ): Promise<void> {
    if (!environmentId) return;

    const requestId = diffRequestIdRef.current + 1;
    diffRequestIdRef.current = requestId;
    callbacksRef.current.onError(null);
    dispatch({ type: "diffStarted", hash: commit.hash, path: filePath });

    try {
      const params = new URLSearchParams({ environmentId, hash: commit.hash, path: filePath });
      const diff = await requestJson<EnvironmentReviewDiff>(
        `/api/review/diff?${params.toString()}`,
      );
      if (requestId === diffRequestIdRef.current) {
        dispatch({ type: "diffSucceeded", diff });
      }
    } catch (error) {
      if (requestId !== diffRequestIdRef.current) return;
      if (callbacksRef.current.onAuthRequired(error)) return;
      dispatch({ type: "diffFailed" });
      callbacksRef.current.onError((error as Error).message);
    }
  }

  function selectCommit(
    commit: EnvironmentReviewCommit | null,
    environmentId = options.environmentId,
  ): void {
    dispatch({ type: "selectCommit", hash: commit?.hash ?? "" });
    if (commit?.files.length === 1) {
      void loadDiff(commit, commit.files[0].path, environmentId);
    } else {
      diffRequestIdRef.current += 1;
    }
  }

  async function loadChanges(environmentId = options.environmentId): Promise<void> {
    if (!environmentId) {
      callbacksRef.current.onError("请先选择环境");
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    callbacksRef.current.onOpen();
    callbacksRef.current.onError(null);
    dispatch({ type: "queryStarted" });

    try {
      const params = new URLSearchParams({
        environmentId,
        since: state.since,
        until: state.until,
      });
      const payload = await requestJson<{ commits: EnvironmentReviewCommit[] }>(
        `/api/review/changes?${params.toString()}`,
      );
      if (requestId !== requestIdRef.current) return;
      dispatch({ type: "querySucceeded", commits: payload.commits });
      selectCommit(payload.commits[0] ?? null, environmentId);
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      if (callbacksRef.current.onAuthRequired(error)) return;
      dispatch({ type: "queryFailed" });
      callbacksRef.current.onError((error as Error).message);
    }
  }

  function clearResults(): void {
    requestIdRef.current += 1;
    diffRequestIdRef.current += 1;
    dispatch({ type: "clearResults" });
  }

  const selectedCommit =
    state.commits.find((commit) => commit.hash === state.selectedHash) ??
    state.commits[0] ??
    null;

  return {
    ...state,
    clearResults,
    loadChanges,
    loadDiff,
    selectCommit,
    selectedCommit,
    setSince: (value: string) => dispatch({ type: "setSince", value }),
    setUntil: (value: string) => dispatch({ type: "setUntil", value }),
  };
}
