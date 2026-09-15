import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import {
  Decoration,
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
import {
  editorFontFamily,
  editorHighlightStyle,
  editorLanguageForPath,
  type EditorLanguageMode,
} from "./editorPresentation";

const configEditorTheme = EditorView.theme(
  {
    "&": {
      background: "transparent",
      color: "rgb(var(--color-foreground))",
      height: "100%"
    },
    "&.cm-focused": {
      outline: "none"
    },
    ".cm-scroller": {
      fontFamily: editorFontFamily,
      fontSize: "13px",
      fontVariantLigatures: "none",
      lineHeight: "1.65",
      overflow: "auto",
      scrollPaddingBottom: "64px"
    },
    ".cm-content": {
      caretColor: "transparent",
      minHeight: "100%",
      padding: "0 16px 64px 12px"
    },
    ".cm-cursorLayer .cm-cursor": {
      borderLeft: "2px solid rgb(var(--color-primary))"
    },
    ".cm-focused .cm-dropCursor": {
      borderLeftColor: "rgb(var(--color-primary))"
    },
    ".cm-line": {
      padding: "0"
    },
    ".cm-gutters": {
      backgroundColor: "rgb(var(--color-surface-muted) / 0.82)",
      borderRight: "1px solid rgb(var(--color-foreground) / 0.1)",
      color: "rgb(var(--color-subtle-foreground))"
    },
    ".cm-lineNumbers .cm-gutterElement": {
      minWidth: "22px",
      padding: "0 4px 0 2px"
    },
    ".cm-placeholder": {
      color: "rgb(var(--color-subtle-foreground))"
    },
    ".cm-validationIssue": {
      backgroundColor: "rgb(var(--color-danger) / 0.1)",
      textDecoration: "underline wavy rgb(var(--color-danger))",
      textDecorationThickness: "1.5px",
      textUnderlineOffset: "3px"
    }
  },
  { dark: false }
);

export interface ConfigEditorValidationIssue {
  from: number;
  to: number;
  message: string;
}

function validationDecorations(issue: ConfigEditorValidationIssue | null) {
  if (!issue || issue.to <= issue.from) {
    return Decoration.none;
  }

  return Decoration.set([
    Decoration.mark({
      class: "cm-validationIssue",
      attributes: {
        title: issue.message
      }
    }).range(issue.from, issue.to)
  ]);
}

export function ConfigEditor(props: {
  filePath: string;
  languageMode?: EditorLanguageMode;
  value: string;
  disabled: boolean;
  placeholderText: string;
  validationIssue: ConfigEditorValidationIssue | null;
  onChange: (view: EditorView) => void;
  onViewReady: (view: EditorView | null) => void;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const valueRef = useRef(props.value);
  const internalValueSnapshotsRef = useRef(new Set<string>());
  const applyingExternalValueRef = useRef(false);
  const disabledCompartmentRef = useRef(new Compartment());
  const languageCompartmentRef = useRef(new Compartment());
  const validationCompartmentRef = useRef(new Compartment());
  const onChangeRef = useRef(props.onChange);

  useEffect(() => {
    onChangeRef.current = props.onChange;
  }, [props.onChange]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
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
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          drawSelection(),
          placeholder(props.placeholderText),
          configEditorTheme,
          syntaxHighlighting(editorHighlightStyle, { fallback: true }),
          languageCompartmentRef.current.of(
            editorLanguageForPath(props.filePath, props.languageMode),
          ),
          validationCompartmentRef.current.of(
            EditorView.decorations.of(validationDecorations(props.validationIssue))
          ),
          disabledCompartmentRef.current.of([
            EditorState.readOnly.of(props.disabled),
            EditorView.editable.of(!props.disabled)
          ]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update: ViewUpdate) => {
            if (update.docChanged) {
              valueRef.current = update.state.doc.toString();
              if (!applyingExternalValueRef.current) {
                internalValueSnapshotsRef.current.add(valueRef.current);
                onChangeRef.current(update.view);
              }
            }
          })
        ]
      })
    });

    viewRef.current = view;
    valueRef.current = props.value;
    props.onViewReady(view);
    return () => {
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

    if (internalValueSnapshotsRef.current.delete(props.value)) {
      return;
    }

    internalValueSnapshotsRef.current.clear();
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

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    view.dispatch({
      effects: languageCompartmentRef.current.reconfigure(
        editorLanguageForPath(props.filePath, props.languageMode),
      )
    });
  }, [props.filePath, props.languageMode]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    view.dispatch({
      effects: validationCompartmentRef.current.reconfigure(
        EditorView.decorations.of(validationDecorations(props.validationIssue))
      )
    });
  }, [props.validationIssue]);

  return <div ref={hostRef} className="h-full min-w-0" />;
}
