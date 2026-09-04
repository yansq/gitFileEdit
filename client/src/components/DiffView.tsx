import { diffLines } from "diff";
import { memo, useMemo, type RefObject } from "react";
import { emptyBlockClass, cn } from "../lib/ui";

interface DiffLine {
  text: string;
  hasNewline: boolean;
}

interface NumberedDiffLine {
  line: DiffLine;
  lineNumber: number;
}

interface DiffRow {
  id: string;
  before: NumberedDiffLine | null;
  after: NumberedDiffLine | null;
  beforeType: "removed" | "same" | "empty";
  afterType: "added" | "same" | "empty";
}

interface UnifiedDiffBlock {
  id: string;
  type: "added" | "removed" | "same";
  marker: "+" | "-" | " ";
  line: DiffLine;
  lineNumber: number;
  afterLineNumber: number | null;
}

function DiffViewContent(props: {
  before: string;
  after: string;
  emptyText: string;
  display?: "split" | "before" | "unified";
  scrollable?: boolean;
  className?: string;
  showContentWhenUnchanged?: boolean;
  scrollRef?: RefObject<HTMLDivElement>;
  highlightAfterLine?: number | null;
  rows?: readonly DiffRow[];
}): JSX.Element {
  const display = props.display ?? "split";
  const scrollable = props.scrollable ?? true;
  const rows = useMemo(
    () => props.rows ?? createDiffRows(props.before, props.after),
    [props.before, props.after, props.rows]
  );
  const unifiedBlocks = useMemo(
    () => display === "unified" ? createUnifiedDiffBlocks(props.before, props.after) : [],
    [display, props.before, props.after]
  );
  const hasChange = display === "unified"
    ? unifiedBlocks.some((block) => block.type !== "same")
    : rows.some((row) => row.beforeType !== "same" || row.afterType !== "same");
  const visibleRows = hasChange || props.showContentWhenUnchanged ? rows : [];
  const visibleUnifiedBlocks = hasChange || props.showContentWhenUnchanged ? unifiedBlocks : [];

  if ((display === "unified" ? visibleUnifiedBlocks : visibleRows).length === 0) {
    return <div ref={props.scrollRef} className={cn(emptyBlockClass, props.className)}>{props.emptyText}</div>;
  }

  if (display === "unified") {
    return (
      <div
        ref={props.scrollRef}
        className={cn(
          scrollable ? "overflow-auto" : "overflow-hidden",
          "rounded-[22px] border border-[#183039]/10 bg-[#fafcfb]/95 p-4",
          props.className
        )}
      >
        {visibleUnifiedBlocks.map((block) => (
          <UnifiedDiffBlockView
            key={block.id}
            block={block}
            highlightAfterLine={props.highlightAfterLine}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      ref={props.scrollRef}
      className={cn(
        scrollable ? "overflow-auto" : "overflow-hidden",
        "rounded-[22px] border border-[#183039]/10 bg-[#fafcfb]/95",
        props.className
      )}
    >
      <div
        className={cn(
          "grid auto-rows-min font-mono text-[13px] leading-[1.65]",
          display === "split"
            ? "min-w-0 grid-cols-2 divide-x divide-[#183039]/10"
            : "min-w-0 grid-cols-1"
        )}
      >
        {visibleRows.map((row) => (
          <DiffRowView
            key={row.id}
            row={row}
            display={display}
            highlightAfterLine={props.highlightAfterLine}
          />
        ))}
      </div>
    </div>
  );
}

export const DiffView = memo(DiffViewContent);

function DiffRowView(props: {
  row: DiffRow;
  display: "split" | "before";
  highlightAfterLine?: number | null;
}): JSX.Element {
  const { row } = props;
  const isHighlighted =
    props.highlightAfterLine !== null &&
    props.highlightAfterLine !== undefined &&
    row.after?.lineNumber === props.highlightAfterLine &&
    row.afterType === "same";

  return (
    <>
      <DiffCell
        line={row.before}
        type={row.beforeType}
        dataAfterLine={props.display === "before" ? row.after?.lineNumber : undefined}
        highlighted={props.display === "before" && isHighlighted}
      />
      {props.display === "split" ? (
        <DiffCell
          line={row.after}
          type={row.afterType}
          dataAfterLine={row.after?.lineNumber}
          highlighted={isHighlighted}
        />
      ) : null}
    </>
  );
}

function DiffCell(props: {
  line: NumberedDiffLine | null;
  type: DiffRow["beforeType"] | DiffRow["afterType"];
  dataAfterLine?: number;
  highlighted?: boolean;
}): JSX.Element {
  return (
    <div
      data-after-line={props.dataAfterLine}
      className={cn(
        "grid min-w-0 grid-cols-[6px_23px_minmax(0,1fr)]",
        props.type === "removed" && "bg-[#c94a35]/10",
        props.type === "added" && "bg-[#1d8c68]/10",
        props.type === "empty" && "bg-[repeating-linear-gradient(-45deg,transparent,transparent_5px,rgba(24,48,57,0.06)_5px,rgba(24,48,57,0.06)_7px)]",
        props.highlighted && "bg-[#d8a21b]/20"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          props.type === "removed" && "bg-[#c94a35]",
          props.type === "added" && "bg-[#1d8c68]"
        )}
      />
      <span className="select-none border-r border-[#183039]/10 pl-0.5 pr-1 text-right text-[12px] text-[#8b9aa1]">
        {props.line?.lineNumber ?? ""}
      </span>
      <span className="min-w-0 break-words pl-3 pr-4 whitespace-pre-wrap text-[#2e444b]">
        {props.line ? <VisibleWhitespace text={props.line.line.text} hasNewline={props.line.line.hasNewline} /> : " "}
      </span>
    </div>
  );
}

function UnifiedDiffBlockView(props: {
  block: UnifiedDiffBlock;
  highlightAfterLine?: number | null;
}): JSX.Element {
  const { block } = props;
  const isHighlighted =
    props.highlightAfterLine !== null &&
    props.highlightAfterLine !== undefined &&
    block.afterLineNumber === props.highlightAfterLine &&
    block.type === "same";

  return (
    <div
      data-after-line={block.afterLineNumber ?? undefined}
      className={cn(
        "grid min-w-0 grid-cols-[18px_8px_minmax(0,1fr)] gap-1 rounded-[10px] px-1 py-0 font-mono text-[13px] leading-[1.65]",
        isHighlighted && "bg-[#d8a21b]/20",
        block.type === "added" && "bg-[#1d8c68]/10",
        block.type === "removed" && "bg-[#c94a35]/10"
      )}
    >
      <span className="select-none text-right text-[12px] text-[#8b9aa1]">{block.lineNumber}</span>
      <span className="select-none text-[#4a5b61]">{block.marker}</span>
      <span className="min-w-0 break-words whitespace-pre-wrap text-[#2e444b]">
        <VisibleWhitespace text={block.line.text} hasNewline={block.line.hasNewline} />
      </span>
    </div>
  );
}

function createDiffRows(before: string, after: string): DiffRow[] {
  if (before === after) {
    return splitDiffLines(after).map((line, index) => ({
      id: `same-${index}`,
      before: { line, lineNumber: index + 1 },
      after: { line, lineNumber: index + 1 },
      beforeType: "same",
      afterType: "same"
    }));
  }

  const rows: DiffRow[] = [];
  let beforeLineNumber = 1;
  let afterLineNumber = 1;
  let removed: NumberedDiffLine[] = [];
  let added: NumberedDiffLine[] = [];

  function flushChanges(): void {
    const rowCount = Math.max(removed.length, added.length);
    for (let index = 0; index < rowCount; index += 1) {
      rows.push({
        id: `change-${rows.length}`,
        before: removed[index] ?? null,
        after: added[index] ?? null,
        beforeType: removed[index] ? "removed" : "empty",
        afterType: added[index] ? "added" : "empty"
      });
    }
    removed = [];
    added = [];
  }

  for (const segment of diffLines(before, after)) {
    const lines = splitDiffLines(segment.value);
    if (segment.removed) {
      removed.push(...lines.map((line) => ({ line, lineNumber: beforeLineNumber++ })));
      continue;
    }
    if (segment.added) {
      added.push(...lines.map((line) => ({ line, lineNumber: afterLineNumber++ })));
      continue;
    }

    flushChanges();
    for (const line of lines) {
      rows.push({
        id: `same-${rows.length}`,
        before: { line, lineNumber: beforeLineNumber++ },
        after: { line, lineNumber: afterLineNumber++ },
        beforeType: "same",
        afterType: "same"
      });
    }
  }
  flushChanges();
  return rows;
}

function createUnifiedDiffBlocks(before: string, after: string): UnifiedDiffBlock[] {
  if (before === after) {
    return splitDiffLines(after).map((line, index) => ({
      id: `same-${index}`,
      type: "same",
      marker: " ",
      line,
      lineNumber: index + 1,
      afterLineNumber: index + 1
    }));
  }

  let beforeLineNumber = 1;
  let afterLineNumber = 1;
  return diffLines(before, after).flatMap((segment, segmentIndex) => {
    const type = segment.added ? "added" : segment.removed ? "removed" : "same";
    const marker = segment.added ? "+" : segment.removed ? "-" : " ";
    return splitDiffLines(segment.value).map((line, lineIndex) => {
      const lineNumber = type === "removed" ? beforeLineNumber : afterLineNumber;
      const nextAfterLineNumber = type === "removed" ? null : afterLineNumber;
      if (type === "added") {
        afterLineNumber += 1;
      } else if (type === "removed") {
        beforeLineNumber += 1;
      } else {
        beforeLineNumber += 1;
        afterLineNumber += 1;
      }
      return {
        id: `${segmentIndex}-${lineIndex}`,
        type,
        marker,
        line,
        lineNumber,
        afterLineNumber: nextAfterLineNumber
      };
    });
  });
}

function splitDiffLines(value: string): DiffLine[] {
  if (!value) {
    return [];
  }

  const lines = value.split("\n").map((text, index, allLines) => ({
    text,
    hasNewline: index < allLines.length - 1
  }));

  if (value.endsWith("\n")) {
    lines.pop();
  }

  return lines;
}

function VisibleWhitespace(props: { text: string; hasNewline: boolean }): JSX.Element {
  const whitespaceClass = "text-[#c2cdd1]";

  return (
    <>
      {props.text
        ? Array.from(props.text).map((char, index) => {
          if (char === " ") {
            return <span key={index} className={whitespaceClass}>·</span>;
          }
          if (char === "\t") {
            return <span key={index} className={whitespaceClass}>⇥</span>;
          }
          return char;
        })
        : !props.hasNewline ? " " : null}
      {props.hasNewline ? <span className="ml-1 text-[#c2cdd1]">↵</span> : null}
    </>
  );
}
