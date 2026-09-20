import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting } from "@codemirror/language";
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
import {
  editorFontFamily,
  editorHighlightStyle,
  editorLanguageForPath,
  editorSearchDecorations,
  type EditorLanguageMode,
  type EditorSearchMatch,
} from "./editorPresentation";

const mergeEditorTheme = EditorView.theme({
  "&": { background: "transparent", color: "rgb(var(--color-foreground))", height: "100%" },
  ".cm-scroller": {
    fontFamily: editorFontFamily,
    fontSize: "13px",
    fontVariantLigatures: "none",
    lineHeight: "1.65",
    overflow: "visible",
    scrollPaddingBottom: "64px"
  },
  ".cm-content": { minHeight: "100%", padding: "0 16px 64px 12px", caretColor: "transparent" },
  ".cm-cursorLayer .cm-cursor": { borderLeft: "2px solid rgb(var(--color-primary))" },
  ".cm-line": { padding: "0" },
  ".cm-gutters": {
    backgroundColor: "rgb(var(--color-surface-muted) / 0.82)",
    borderRight: "1px solid rgb(var(--color-foreground) / 0.1)",
    color: "rgb(var(--color-subtle-foreground))"
  },
  ".cm-lineNumbers .cm-gutterElement": { minWidth: "22px", padding: "0 4px 0 2px" },
  ".cm-placeholder": { color: "rgb(var(--color-subtle-foreground))" },
  ".cm-validationIssue": {
    backgroundColor: "rgb(var(--color-danger) / 0.1)",
    textDecoration: "underline wavy rgb(var(--color-danger))",
    textDecorationThickness: "1.5px",
    textUnderlineOffset: "3px"
  },
  ".cm-searchMatch": {
    backgroundColor: "rgb(var(--color-warning-soft))",
    borderRadius: "3px",
    boxShadow: "inset 0 0 0 1px rgb(var(--color-warning) / 0.5)"
  },
  ".cm-searchMatch.cm-searchMatch-active": {
    backgroundColor: "rgb(var(--color-warning) / 0.42)",
    boxShadow: "inset 0 0 0 2px rgb(var(--color-warning) / 0.9)"
  }
});

function validationDecorations(issue: ConfigEditorValidationIssue | null) {
  if (!issue || issue.to <= issue.from) return Decoration.none;
  return Decoration.set([
    Decoration.mark({ class: "cm-validationIssue", attributes: { title: issue.message } }).range(issue.from, issue.to)
  ]);
}

export function MergeConfigEditor(props: {
  filePath: string;
  languageMode?: EditorLanguageMode;
  original: string;
  value: string;
  disabled: boolean;
  placeholderText: string;
  validationIssue: ConfigEditorValidationIssue | null;
  searchMatches?: EditorSearchMatch[];
  activeSearchMatchIndex?: number;
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
  const searchCompartmentRef = useRef(new Compartment());
  const originalLanguageCompartmentRef = useRef(new Compartment());
  const editableLanguageCompartmentRef = useRef(new Compartment());

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
          syntaxHighlighting(editorHighlightStyle, { fallback: true }),
          originalLanguageCompartmentRef.current.of(
            editorLanguageForPath(props.filePath, props.languageMode),
          ),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.lineWrapping
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
          syntaxHighlighting(editorHighlightStyle, { fallback: true }),
          editableLanguageCompartmentRef.current.of(
            editorLanguageForPath(props.filePath, props.languageMode),
          ),
          disabledCompartmentRef.current.of([
            EditorState.readOnly.of(props.disabled),
            EditorView.editable.of(!props.disabled)
          ]),
          validationCompartmentRef.current.of(
            EditorView.decorations.of(validationDecorations(props.validationIssue))
          ),
          searchCompartmentRef.current.of(
            EditorView.decorations.of(
              editorSearchDecorations(
                props.searchMatches ?? [],
                props.activeSearchMatchIndex ?? -1,
                props.value.length,
              ),
            ),
          ),
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
      effects: searchCompartmentRef.current.reconfigure(
        EditorView.decorations.of(
          editorSearchDecorations(
            props.searchMatches ?? [],
            props.activeSearchMatchIndex ?? -1,
            merge.b.state.doc.length,
          ),
        ),
      ),
    });
  }, [props.activeSearchMatchIndex, props.searchMatches]);

  useEffect(() => {
    const merge = mergeRef.current;
    if (!merge) return;
    const language = editorLanguageForPath(props.filePath, props.languageMode);
    merge.a.dispatch({
      effects: originalLanguageCompartmentRef.current.reconfigure(language)
    });
    merge.b.dispatch({
      effects: editableLanguageCompartmentRef.current.reconfigure(language)
    });
  }, [props.filePath, props.languageMode]);

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
