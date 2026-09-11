import { parse as parseJson, printParseErrorCode, type ParseError } from "jsonc-parser";
import { useEffect, useState } from "react";
import { parseDocument } from "yaml";
import type { ConfigEditorValidationIssue } from "../../components/ConfigEditor";
import type { FileConflictPayload } from "../../types";
import { useEditorSearch } from "./useEditorSearch";

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getPositionText(content: string, offset: number): string {
  const beforeError = content.slice(0, Math.max(0, offset));
  const lines = beforeError.split("\n");
  return `第 ${lines.length} 行第 ${lines[lines.length - 1].length + 1} 列`;
}

function getOffsetFromLineColumn(
  content: string,
  lineNumber: number,
  columnNumber: number,
): number {
  let line = 1;
  let column = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (line === lineNumber && column === columnNumber) return index;
    if (content.charCodeAt(index) === 10) {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return content.length;
}

function createValidationIssue(
  content: string,
  from: number,
  length: number,
  message: string,
): ConfigEditorValidationIssue | null {
  if (!content) return null;

  let safeFrom = clampNumber(from, 0, Math.max(0, content.length - 1));
  while (safeFrom > 0 && /\s/.test(content[safeFrom] ?? "")) safeFrom -= 1;
  const safeTo = clampNumber(safeFrom + Math.max(1, length), safeFrom + 1, content.length);
  return { from: safeFrom, to: safeTo, message };
}

export function validateEditorContent(
  filePath: string,
  content: string,
  forceYaml = false,
): ConfigEditorValidationIssue | null {
  const extension = forceYaml ? "yaml" : filePath.split(".").pop()?.toLocaleLowerCase();
  if (extension === "json") {
    const errors: ParseError[] = [];
    parseJson(content, errors, { allowTrailingComma: false, disallowComments: true });
    const firstError = errors[0];
    return firstError
      ? createValidationIssue(
        content,
        firstError.offset,
        firstError.length,
        `${filePath} JSON 格式错误：${getPositionText(content, firstError.offset)}，${printParseErrorCode(firstError.error)}`,
      )
      : null;
  }

  if (extension !== "yaml" && extension !== "yml") return null;
  const document = parseDocument(content, { prettyErrors: false, strict: true });
  const firstError = document.errors[0];
  if (!firstError) return null;

  const from = firstError.linePos?.[0]
    ? getOffsetFromLineColumn(content, firstError.linePos[0].line, firstError.linePos[0].col)
    : firstError.pos[0];
  return createValidationIssue(
    content,
    from,
    Math.max(1, firstError.pos[1] - firstError.pos[0]),
    `${filePath} YAML 格式错误：${getPositionText(content, from)}，${firstError.message}`,
  );
}

export function useFileEditor(options: { active: boolean; filePath: string }) {
  const [content, setContent] = useState("");
  const [validationIssue, setValidationIssue] =
    useState<ConfigEditorValidationIssue | null>(null);
  const [viewMode, setViewMode] = useState<"diff" | "editor">("editor");
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState<FileConflictPayload | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const search = useEditorSearch(content);

  useEffect(() => {
    if (!options.active || !options.filePath) {
      setValidationIssue(null);
      return;
    }

    const timer = window.setTimeout(() => {
      setValidationIssue(validateEditorContent(options.filePath, content));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [content, options.active, options.filePath]);

  return {
    conflict,
    content,
    dirty,
    search,
    setConflict,
    setContent,
    setDirty,
    setValidationError,
    setViewMode,
    validationError,
    validationIssue,
    viewMode,
  };
}
