import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
  type ViewUpdate
} from "@codemirror/view";
import { useEffect, useRef } from "react";

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(value, 0), 1);
}

const configEditorTheme = EditorView.theme(
  {
    "&": {
      background: "transparent",
      color: "#183039",
      height: "100%"
    },
    "&.cm-focused": {
      outline: "none"
    },
    ".cm-scroller": {
      fontFamily:
        '"JetBrains Mono", "Cascadia Code", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: "13px",
      lineHeight: "1.65",
      overflow: "auto"
    },
    ".cm-content": {
      caretColor: "transparent",
      minHeight: "100%",
      padding: "16px 16px 16px 12px"
    },
    ".cm-cursorLayer .cm-cursor": {
      borderLeft: "2px solid #c94a35"
    },
    ".cm-focused .cm-dropCursor": {
      borderLeftColor: "#c94a35"
    },
    ".cm-line": {
      padding: "0"
    },
    ".cm-gutters": {
      backgroundColor: "rgba(238, 244, 243, 0.7)",
      borderRight: "1px solid rgba(24, 48, 57, 0.1)",
      color: "#8b9aa1"
    },
    ".cm-lineNumbers .cm-gutterElement": {
      minWidth: "22px",
      padding: "0 4px 0 2px"
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(29, 140, 104, 0.1)"
    },
    ".cm-activeLineGutter": {
      backgroundColor: "rgba(29, 140, 104, 0.08)",
      color: "#315159"
    },
    ".cm-placeholder": {
      color: "#8b9aa1"
    }
  },
  { dark: false }
);

export function ConfigEditor(props: {
  value: string;
  disabled: boolean;
  placeholderText: string;
  onChange: (view: EditorView) => void;
  onViewReady: (view: EditorView | null) => void;
  onCursorLineChange: (lineNumber: number, viewportTop: number, lineProgress: number) => void;
  onViewportLineChange: (lineNumber: number, viewportTop: number, lineProgress: number) => void;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const valueRef = useRef(props.value);
  const applyingExternalValueRef = useRef(false);
  const disabledCompartmentRef = useRef(new Compartment());
  const onChangeRef = useRef(props.onChange);
  const onCursorLineChangeRef = useRef(props.onCursorLineChange);
  const onViewportLineChangeRef = useRef(props.onViewportLineChange);

  useEffect(() => {
    onChangeRef.current = props.onChange;
    onCursorLineChangeRef.current = props.onCursorLineChange;
    onViewportLineChangeRef.current = props.onViewportLineChange;
  }, [props.onChange, props.onCursorLineChange, props.onViewportLineChange]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    function reportViewportLine(view: EditorView): void {
      const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
      const line = view.state.doc.lineAt(block.from);
      const blockHeight = Math.max(1, block.height);
      const lineProgress = clampRatio((view.scrollDOM.scrollTop - block.top) / blockHeight);
      onViewportLineChangeRef.current(
        line.number,
        Math.max(0, block.top - view.scrollDOM.scrollTop),
        lineProgress
      );
    }

    function reportCursorLine(view: EditorView): void {
      const head = view.state.selection.main.head;
      const block = view.lineBlockAt(head);
      const line = view.state.doc.lineAt(head);
      const lineTop =
        view.coordsAtPos(line.from)?.top ??
        view.scrollDOM.getBoundingClientRect().top + block.top - view.scrollDOM.scrollTop;
      onCursorLineChangeRef.current(
        line.number,
        Math.max(0, lineTop - view.scrollDOM.getBoundingClientRect().top),
        0
      );
    }

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          drawSelection(),
          placeholder(props.placeholderText),
          configEditorTheme,
          disabledCompartmentRef.current.of([
            EditorState.readOnly.of(props.disabled),
            EditorView.editable.of(!props.disabled)
          ]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update: ViewUpdate) => {
            if (update.docChanged) {
              let nextValue = valueRef.current;
              update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
                nextValue = `${nextValue.slice(0, fromA)}${inserted.toString()}${nextValue.slice(toA)}`;
              });
              valueRef.current = nextValue;
              if (!applyingExternalValueRef.current) {
                onChangeRef.current(update.view);
              }
            }
            if (update.docChanged || update.selectionSet) {
              reportCursorLine(update.view);
            }
          })
        ]
      })
    });

    viewRef.current = view;
    valueRef.current = props.value;
    props.onViewReady(view);
    reportCursorLine(view);

    const handleScroll = (): void => {
      reportViewportLine(view);
    };
    view.scrollDOM.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      view.scrollDOM.removeEventListener("scroll", handleScroll);
      props.onViewReady(null);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || props.value === valueRef.current) {
      return;
    }

    valueRef.current = props.value;
    applyingExternalValueRef.current = true;
    try {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: props.value
        }
      });
    } finally {
      applyingExternalValueRef.current = false;
    }
  }, [props.value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    view.dispatch({
      effects: disabledCompartmentRef.current.reconfigure([
        EditorState.readOnly.of(props.disabled),
        EditorView.editable.of(!props.disabled)
      ])
    });
  }, [props.disabled]);

  return <div ref={hostRef} className="h-full min-w-0" />;
}
