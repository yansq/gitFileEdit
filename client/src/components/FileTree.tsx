import { useState } from "react";
import type { FileTreeNode } from "../lib/filePaths";
import { nodeContainsPath } from "../lib/filePaths";
import { formatSize } from "../lib/format";
import { cn } from "../lib/ui";

export function FileTree(props: {
  nodes: FileTreeNode[];
  selectedPath: string;
  onSelect: (path: string) => void;
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
            level={props.level + 1}
          />
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={cn(
        "group grid min-h-[34px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 rounded-md px-1.5 text-left text-[15px] text-[#24292f] transition hover:text-[#0f5e58]",
        props.selectedPath === props.node.path &&
        "font-semibold text-[#111827]"
      )}
      onClick={() => props.onSelect(props.node.path)}
      style={{ paddingLeft: `${indent + 18}px` }}
      title={props.node.path}
    >
      <span className="min-w-0 truncate">{props.node.name}</span>
      <span className="hidden text-xs font-normal text-[#7a8b91] group-hover:inline">
        {props.node.file ? formatSize(props.node.file.size) : ""}
      </span>
    </button>
  );
}
