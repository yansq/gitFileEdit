import { useState } from "react";
import type { FileTreeNode } from "../lib/filePaths";
import { nodeContainsPath } from "../lib/filePaths";
import { formatSize } from "../lib/format";
import { cn } from "../lib/ui";

export function FileTree(props: {
  nodes: FileTreeNode[];
  selectedPath: string;
  onSelect: (path: string) => void;
  forceOpen?: boolean;
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
          forceOpen={props.forceOpen ?? false}
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
  forceOpen: boolean;
}): JSX.Element {
  const containsSelected = nodeContainsPath(props.node, props.selectedPath);
  const [open, setOpen] = useState(true);
  const isOpen = props.forceOpen || open;
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
            forceOpen={props.forceOpen}
          />
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={cn(
        "group grid min-h-[34px] w-full grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-1.5 rounded-md px-1.5 text-left text-[15px] text-[#24292f] transition hover:text-[#0f5e58]",
        props.selectedPath === props.node.path &&
        "font-semibold text-[#111827]"
      )}
      onClick={() => props.onSelect(props.node.path)}
      style={{ paddingLeft: `${indent + 18}px` }}
      title={props.node.path}
    >
      <FileTypeIcon fileName={props.node.name} />
      <span className="min-w-0 truncate">{props.node.name}</span>
      <span className="hidden text-xs font-normal text-[#7a8b91] group-hover:inline">
        {props.node.file ? formatSize(props.node.file.size) : ""}
      </span>
    </button>
  );
}

function FileTypeIcon(props: { fileName: string }): JSX.Element {
  const name = props.fileName.toLocaleLowerCase();

  if (name.endsWith(".md")) {
    return <span className="text-center text-sm font-black text-[#20a455]">M↓</span>;
  }
  if (name === "dockerfile" || name.includes("compose") || name.endsWith(".yml") || name.endsWith(".yaml")) {
    return <span className="text-center text-lg leading-none text-[#238bd7]">◆</span>;
  }
  if (name.endsWith(".html")) {
    return <span className="rounded-md bg-[#f4dfcb] text-center text-sm font-bold text-[#d9792b]">#</span>;
  }
  if (name.endsWith(".json")) {
    return <span className="text-center text-lg leading-none text-[#e47a22]">{"{}"}</span>;
  }
  if (name.endsWith(".cjs") || name.endsWith(".js")) {
    return <span className="text-center text-lg leading-none text-[#df3b4a]">◎</span>;
  }
  if (name.endsWith(".ts") || name.endsWith(".tsx")) {
    return <span className="text-center text-lg leading-none text-[#a83ac6]">ϟ</span>;
  }
  if (name.endsWith(".css") || name.endsWith(".scss")) {
    return <span className="text-center text-lg leading-none text-[#20a9c8]">~</span>;
  }
  if (name.endsWith(".properties") || name.endsWith(".conf") || name.endsWith(".ini") || name.endsWith(".env")) {
    return <span className="rounded-md bg-[#edf1f3] text-center text-sm font-bold text-[#65727a]">.</span>;
  }

  return <span className="text-center text-lg leading-none text-[#9aa3aa]">•</span>;
}
