import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { Compartment, EditorState } from "@codemirror/state";
import { MergeView } from "@codemirror/merge";
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
  type ViewUpdate
} from "@codemirror/view";
import { useEffect, useRef } from "react";
import type { ConfigEditorValidationIssue } from "./ConfigEditor";

const mergeEditorTheme = EditorView.theme({
  "&": { background: "transparent", color: "#183039", height: "100%" },
  ".cm-scroller": {
    fontFamily: '"JetBrains Mono", "Cascadia Code", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: "13px",
    lineHeight: "1.65",
    overflow: "visible",
    overscrollBehavior: "none",
    scrollPaddingBottom: "64px"
  },
  ".cm-content": { minHeight: "100%", padding: "0 16px 64px 12px", caretColor: "transparent" },
  ".cm-cursorLayer .cm-cursor": { borderLeft: "2px solid #c94a35" },
  ".cm-line": { padding: "0" },
  ".cm-gutters": {
    backgroundColor: "rgba(238, 244, 243, 0.7)",
    borderRight: "1px solid rgba(24, 48, 57, 0.1)",
    color: "#8b9aa1"
  },
  ".cm-lineNumbers .cm-gutterElement": { minWidth: "22px", padding: "0 4px 0 2px" },
  ".cm-placeholder": { color: "#8b9aa1" },
  ".cm-validationIssue": {
    backgroundColor: "rgba(201, 74, 53, 0.12)",
    textDecoration: "underline wavy #c94a35",
    textDecorationThickness: "1.5px",
    textUnderlineOffset: "3px"
  }
});

function validationDecorations(issue: ConfigEditorValidationIssue | null) {
  if (!issue || issue.to <= issue.from) return Decoration.none;
  return Decoration.set([
    Decoration.mark({ class: "cm-validationIssue", attributes: { title: issue.message } }).range(issue.from, issue.to)
  ]);
}

export function MergeConfigEditor(props: {
  original: string;
  value: string;
  disabled: boolean;
  placeholderText: string;
  validationIssue: ConfigEditorValidationIssue | null;
  onChange: (view: EditorView) => void;
  onViewReady: (view: EditorView | null) => void;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const mergeRef = useRef<MergeView | null>(null);
  const valueRef = useRef(props.value);
  const originalRef = useRef(props.original);
  const applyingExternalValueRef = useRef(false);
  const internalValuesRef = useRef(new Set<string>());
  const onChangeRef = useRef(props.onChange);
  const disabledCompartmentRef = useRef(new Compartment());
  const validationCompartmentRef = useRef(new Compartment());

  useEffect(() => {
    onChangeRef.current = props.onChange;
  }, [props.onChange]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const merge = new MergeView({
      a: {
        doc: props.original,
        extensions: [
          lineNumbers(),
          mergeEditorTheme,
          validationCompartmentRef.current.of(
            EditorView.decorations.of(validationDecorations(props.validationIssue))
          ),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false)
        ]
      },
      b: {
        doc: props.value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          drawSelection(),
          placeholder(props.placeholderText),
          mergeEditorTheme,
          disabledCompartmentRef.current.of([
            EditorState.readOnly.of(props.disabled),
            EditorView.editable.of(!props.disabled)
          ]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update: ViewUpdate) => {
            if (!update.docChanged || applyingExternalValueRef.current) return;
            valueRef.current = update.state.doc.toString();
            internalValuesRef.current.add(valueRef.current);
            onChangeRef.current(update.view);
          })
        ]
      },
      parent: host,
      highlightChanges: true,
      gutter: true
    });
    mergeRef.current = merge;
    valueRef.current = props.value;
    originalRef.current = props.original;
    props.onViewReady(merge.b);
    return () => {
      props.onViewReady(null);
      merge.destroy();
      mergeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const merge = mergeRef.current;
    if (!merge || props.value === valueRef.current) return;
    if (internalValuesRef.current.delete(props.value)) return;
    internalValuesRef.current.clear();
    applyingExternalValueRef.current = true;
    try {
      merge.b.dispatch({ changes: { from: 0, to: merge.b.state.doc.length, insert: props.value } });
      valueRef.current = props.value;
    } finally {
      applyingExternalValueRef.current = false;
    }
  }, [props.value]);

  useEffect(() => {
    const merge = mergeRef.current;
    if (!merge || props.original === originalRef.current) return;
    merge.a.dispatch({ changes: { from: 0, to: merge.a.state.doc.length, insert: props.original } });
    originalRef.current = props.original;
  }, [props.original]);

  useEffect(() => {
    const merge = mergeRef.current;
    if (!merge) return;
    merge.b.dispatch({
      effects: disabledCompartmentRef.current.reconfigure([
        EditorState.readOnly.of(props.disabled),
        EditorView.editable.of(!props.disabled)
      ])
    });
  }, [props.disabled]);

  useEffect(() => {
    const merge = mergeRef.current;
    if (!merge) return;
    merge.b.dispatch({
      effects: validationCompartmentRef.current.reconfigure(
        EditorView.decorations.of(validationDecorations(props.validationIssue))
      )
    });
  }, [props.validationIssue]);

  return <div ref={hostRef} className="cm-merge-host h-full min-h-0" />;
}
