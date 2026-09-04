import { useState } from "react";
import type { FileTreeNode } from "../lib/filePaths";
import { nodeContainsPath } from "../lib/filePaths";
import { formatSize } from "../lib/format";
import { cn } from "../lib/ui";

export function FileTree(props: {
  nodes: FileTreeNode[];
  selectedPath: string;
  onSelect: (path: string) => void;
  onRename?: (path: string) => void;
  onDelete?: (path: string) => void;
  level?: number;
}): JSX.Element {
  const level = props.level ?? 0;

  return (
    <div className="grid gap-0.5">
      {props.nodes.map((node) => (
        <FileTreeRow
          key={node.id}
          node={node}
          selectedPath={props.selectedPath}
          onSelect={props.onSelect}
          onRename={props.onRename}
          onDelete={props.onDelete}
          level={level}
        />
      ))}
    </div>
  );
}

function FileTreeRow(props: {
  node: FileTreeNode;
  selectedPath: string;
  onSelect: (path: string) => void;
  onRename?: (path: string) => void;
  onDelete?: (path: string) => void;
  level: number;
}): JSX.Element {
  const containsSelected = nodeContainsPath(props.node, props.selectedPath);
  const [open, setOpen] = useState(true);
  const isOpen = open;
  const indent = 6 + props.level * 10;

  if (props.node.kind === "directory") {
    return (
      <div>
        <button
          type="button"
          className={cn(
            "flex min-h-[34px] w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[15px] font-semibold text-[#24292f] transition hover:text-[#0f5e58]",
            containsSelected && "text-[#111827]"
          )}
          onClick={() => setOpen((current) => !current)}
          style={{ paddingLeft: `${indent}px` }}
        >
          <span
            className={cn(
              "w-6 shrink-0 text-center text-3xl font-light leading-none text-[#8a8f94] transition-transform",
              isOpen && "rotate-90 text-[#24292f]"
            )}
          >
            ›
          </span>
          <span className="min-w-0 flex-1 truncate">{props.node.name}</span>
        </button>
        {isOpen ? (
          <FileTree
            nodes={props.node.children}
            selectedPath={props.selectedPath}
            onSelect={props.onSelect}
            onRename={props.onRename}
            onDelete={props.onDelete}
            level={props.level + 1}
          />
        ) : null}
      </div>
    );
  }

  const hasActions = Boolean(props.onRename || props.onDelete);
  return (
    <div
      className={cn(
        "group grid min-h-[34px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 rounded-md px-1.5 text-[15px] text-[#24292f] transition hover:text-[#0f5e58]",
        props.selectedPath === props.node.path && "font-semibold text-[#111827]"
      )}
      style={{ paddingLeft: `${indent + 18}px` }}
      title={props.node.path}
    >
      <button
        className="min-w-0 truncate text-left"
        onClick={() => props.onSelect(props.node.path)}
        type="button"
      >
        {props.node.name}
      </button>
      <div className="hidden items-center gap-1 group-hover:flex">
        <span className="text-xs font-normal text-[#7a8b91]">
          {props.node.file ? formatSize(props.node.file.size) : ""}
        </span>
        {hasActions ? (
          <>
            {props.onRename ? (
              <button
                aria-label={`重命名 ${props.node.name}`}
                className="rounded p-1 text-[#60767c] hover:bg-[#0e6b72]/10 hover:text-[#0e6b72]"
                onClick={() => props.onRename?.(props.node.path)}
                title="重命名"
                type="button"
              >
                <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
            ) : null}
            {props.onDelete ? (
              <button
                aria-label={`删除 ${props.node.name}`}
                className="rounded p-1 text-[#9f2f20] hover:bg-[#c94a35]/10"
                onClick={() => props.onDelete?.(props.node.path)}
                title="删除"
                type="button"
              >
                <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v5M14 11v5" />
                </svg>
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
