import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
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
      overflow: "auto",
      overscrollBehavior: "none",
      scrollPaddingBottom: "64px"
    },
    ".cm-content": {
      caretColor: "transparent",
      minHeight: "100%",
      padding: "0 16px 64px 12px"
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
    ".cm-placeholder": {
      color: "#8b9aa1"
    },
    ".cm-validationIssue": {
      backgroundColor: "rgba(201, 74, 53, 0.12)",
      textDecoration: "underline wavy #c94a35",
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
      effects: validationCompartmentRef.current.reconfigure(
        EditorView.decorations.of(validationDecorations(props.validationIssue))
      )
    });
  }, [props.validationIssue]);

  return <div ref={hostRef} className="h-full min-w-0" />;
}
