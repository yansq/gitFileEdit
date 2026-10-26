import { MergeView } from "@codemirror/merge";
import { standardKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap, lineNumbers } from "@codemirror/view";
import { memo, useEffect, useRef } from "react";

const previewTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "rgb(var(--color-foreground))" },
  ".cm-scroller": { overflow: "visible", fontFamily: "inherit", fontSize: "13px", lineHeight: "1.65" },
  ".cm-content": { padding: "4px 0 16px", caretColor: "transparent" },
  ".cm-line": { padding: "0 12px" },
  ".cm-gutters": { backgroundColor: "rgb(var(--color-surface-muted) / 0.6)", color: "rgb(var(--color-subtle-foreground))", borderRight: "1px solid rgb(var(--color-border))" },
  ".cm-lineNumbers .cm-gutterElement": { minWidth: "28px", padding: "0 4px" },
  "&.cm-merge-a .cm-changedLine": { backgroundColor: "rgb(var(--color-danger) / 0.1)" },
  "&.cm-merge-b .cm-changedLine": { backgroundColor: "rgb(var(--color-success) / 0.1)" },
  "&.cm-merge-a .cm-changedText": { background: "rgb(var(--color-danger) / 0.12)", textDecoration: "none" },
  "&.cm-merge-b .cm-changedText": { background: "rgb(var(--color-success) / 0.12)", textDecoration: "none" },
  "&.cm-merge-a .cm-changedLineGutter": { backgroundColor: "rgb(var(--color-danger))" },
  "&.cm-merge-b .cm-changedLineGutter": { backgroundColor: "rgb(var(--color-success))" },
});

export const ReadOnlyDiff = memo(function ReadOnlyDiff(props: { before: string; after: string }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current || props.before === props.after) return;
    const extensions = [lineNumbers(), drawSelection(), keymap.of(standardKeymap), previewTheme, EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.lineWrapping];
    const merge = new MergeView({
      parent: hostRef.current,
      a: { doc: props.before, extensions: [...extensions, EditorView.contentAttributes.of({ "aria-label": "覆盖前的目标文件", tabindex: "0" })] },
      b: { doc: props.after, extensions: [...extensions, EditorView.contentAttributes.of({ "aria-label": "覆盖后的目标文件", tabindex: "0" })] },
      gutter: true,
      diffConfig: { scanLimit: 500, timeout: 100 },
    });
    return () => merge.destroy();
  }, [props.before, props.after]);

  if (props.before === props.after) {
    return <div className="rounded-ui-md border border-dashed border-ui-border p-ui-4 text-center text-sm text-muted-foreground">两个环境的文件内容相同，无需晋级</div>;
  }
  return <div className="cm-promotion-diff h-[min(48vh,420px)] min-h-24 shrink-0 overflow-hidden rounded-ui-md border border-ui-border bg-surface-subtle font-mono" ref={hostRef} />;
});
