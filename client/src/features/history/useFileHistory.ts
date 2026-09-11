import { useEffect, useReducer, useRef } from "react";
import { requestJson } from "../../lib/api";
import type { CommitSnapshot, CommitSummary } from "../../types";

interface HistoryState {
  selectedHash: string;
  detail: CommitSnapshot | null;
  status: "idle" | "loading" | "ready";
}

type HistoryAction =
  | { type: "clearDetail" }
  | { type: "loadFailed" }
  | { type: "loadStarted" }
  | { type: "loadSucceeded"; detail: CommitSnapshot }
  | { type: "reset" }
  | { type: "select"; hash: string };

const initialState: HistoryState = {
  selectedHash: "",
  detail: null,
  status: "idle",
};

function reducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "reset":
      return initialState;
    case "select":
      return action.hash === state.selectedHash
        ? state
        : { selectedHash: action.hash, detail: null, status: "idle" };
    case "clearDetail":
      return state.detail || state.status !== "idle"
        ? { ...state, detail: null, status: "idle" }
        : state;
    case "loadStarted":
      return { ...state, detail: null, status: "loading" };
    case "loadSucceeded":
      return { ...state, detail: action.detail, status: "ready" };
    case "loadFailed":
      return { ...state, detail: null, status: "idle" };
  }
}

export function useFileHistory(options: {
  active: boolean;
  commits: CommitSummary[];
  onAuthRequired: (error: unknown) => boolean;
  onError: (message: string) => void;
  selectedPath: string;
}) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const cacheRef = useRef(new Map<string, CommitSnapshot>());
  const onAuthRequiredRef = useRef(options.onAuthRequired);
  const onErrorRef = useRef(options.onError);
  onAuthRequiredRef.current = options.onAuthRequired;
  onErrorRef.current = options.onError;

  const selectedCommit =
    options.commits.find((commit) => commit.hash === state.selectedHash) ??
    options.commits[0] ??
    null;

  useEffect(() => {
    const effectiveHash = selectedCommit?.hash ?? "";
    if (!options.active || !options.selectedPath || !effectiveHash) {
      dispatch({ type: "clearDetail" });
      return;
    }

    const cacheKey = `${options.selectedPath}\u0000${effectiveHash}`;
    const cachedDetail = cacheRef.current.get(cacheKey);
    if (cachedDetail) {
      dispatch({ type: "loadSucceeded", detail: cachedDetail });
      return;
    }

    let cancelled = false;
    dispatch({ type: "loadStarted" });
    void requestJson<CommitSnapshot>(
      `/api/file/history?path=${encodeURIComponent(options.selectedPath)}&hash=${encodeURIComponent(effectiveHash)}`,
    )
      .then((detail) => {
        if (cancelled) return;
        cacheRef.current.set(cacheKey, detail);
        if (cacheRef.current.size > 50) {
          const oldestKey = cacheRef.current.keys().next().value;
          if (oldestKey) cacheRef.current.delete(oldestKey);
        }
        dispatch({ type: "loadSucceeded", detail });
      })
      .catch((error) => {
        if (cancelled || onAuthRequiredRef.current(error)) return;
        dispatch({ type: "loadFailed" });
        onErrorRef.current((error as Error).message);
      });

    return () => {
      cancelled = true;
    };
  }, [options.active, options.selectedPath, selectedCommit?.hash]);

  function reset(clearCache = false): void {
    dispatch({ type: "reset" });
    if (clearCache) cacheRef.current.clear();
  }

  function selectHash(hash: string): void {
    if (hash !== state.selectedHash) dispatch({ type: "select", hash });
  }

  return {
    detail: state.detail,
    isLoading: state.status === "loading",
    reset,
    selectHash,
    selectedCommit,
    selectedHash: state.selectedHash,
  };
}
