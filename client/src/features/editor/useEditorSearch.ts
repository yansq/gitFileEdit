import { useMemo, useReducer, useRef } from "react";

interface EditorSearchState {
  open: boolean;
  input: string;
  query: string;
  index: number;
}

type EditorSearchAction =
  | { type: "close" }
  | { type: "inputChanged"; value: string }
  | { type: "open" }
  | { type: "searched"; query: string; index: number };

const initialState: EditorSearchState = {
  open: false,
  input: "",
  query: "",
  index: -1,
};

function reducer(state: EditorSearchState, action: EditorSearchAction): EditorSearchState {
  switch (action.type) {
    case "open":
      return state.open ? state : { ...state, open: true };
    case "close":
      return state.open ? { ...state, open: false } : state;
    case "inputChanged":
      return { ...state, input: action.value };
    case "searched":
      return { ...state, query: action.query, index: action.index };
  }
}

function findTextMatches(content: string, query: string): Array<{ from: number; to: number }> {
  if (!query) return [];

  const matches: Array<{ from: number; to: number }> = [];
  const normalizedContent = content.toLocaleLowerCase();
  const normalizedQuery = query.toLocaleLowerCase();
  let offset = 0;

  while (offset <= normalizedContent.length - normalizedQuery.length) {
    const found = normalizedContent.indexOf(normalizedQuery, offset);
    if (found < 0) break;
    matches.push({ from: found, to: found + query.length });
    offset = found + Math.max(1, query.length);
  }

  return matches;
}

function clampIndex(value: number, length: number): number {
  return length ? Math.min(Math.max(value, 0), length - 1) : -1;
}

export function useEditorSearch(content: string) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => findTextMatches(content, state.query), [content, state.query]);
  const displayedIndex = clampIndex(state.index, matches.length);

  function focusInput(): void {
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }

  function open(): void {
    dispatch({ type: "open" });
    focusInput();
  }

  function close(): void {
    dispatch({ type: "close" });
  }

  function setInput(value: string): void {
    dispatch({ type: "inputChanged", value });
  }

  function findAdjacent(
    currentContent: string,
    direction: -1 | 1,
  ): { from: number; to: number } | null {
    if (!state.input) return null;

    const isNewSearch = state.input !== state.query;
    const nextMatches = findTextMatches(currentContent, isNewSearch ? state.input : state.query);
    if (!nextMatches.length) {
      dispatch({ type: "searched", query: state.input, index: -1 });
      return null;
    }

    const currentIndex = clampIndex(state.index, nextMatches.length);
    const nextIndex =
      isNewSearch || state.index < 0
        ? direction < 0
          ? nextMatches.length - 1
          : 0
        : (currentIndex + direction + nextMatches.length) % nextMatches.length;
    dispatch({ type: "searched", query: state.input, index: nextIndex });
    return nextMatches[nextIndex];
  }

  return {
    close,
    displayedIndex,
    findAdjacent,
    focusInput,
    index: state.index,
    input: state.input,
    inputRef,
    matches,
    open,
    query: state.query,
    setInput,
    isOpen: state.open,
  };
}
