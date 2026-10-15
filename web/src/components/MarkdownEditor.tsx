import { forwardRef } from "react";
import CodeMirror, { EditorView, type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { search } from "@codemirror/search";
import { EditorState } from "@codemirror/state";

// Editor styled to read like the manuscript page; colors come from CSS vars so it
// adapts to light/dark automatically.
const manuscriptTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--color-ink-text)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-prose)", lineHeight: "1.85", overflow: "visible" },
  ".cm-content": {
    fontFamily: "var(--font-prose)",
    fontSize: "var(--editor-size, 1.075rem)",
    padding: "0",
    caretColor: "var(--color-ink)",
  },
  ".cm-line": { padding: "0 2px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-ink)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in srgb, var(--color-ink) 12%, transparent)",
  },
  ".cm-placeholder": { color: "var(--color-paper-muted)" },
});

const MarkdownEditor = forwardRef<ReactCodeMirrorRef, {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}>(({ value, onChange, placeholder }, ref) => {
  return (
    <CodeMirror
      ref={ref}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      theme="none"
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        drawSelection: true,
        bracketMatching: false,
        indentOnInput: false,
      }}
      extensions={[
        markdown({ base: markdownLanguage }),
        EditorView.lineWrapping,
        search({ top: true }),
        EditorState.phrases.of({
          Find: "Найти",
          Replace: "Заменить",
          next: "далее",
          previous: "назад",
          all: "все",
          "match case": "учитывать регистр",
          regexp: "регулярное выражение",
          "by word": "слово целиком",
          replace: "заменить",
          "replace all": "заменить всё",
          close: "закрыть",
          "current match": "текущее совпадение",
          "on line": "в строке",
          "replaced match on line $": "совпадение заменено в строке $",
          "replaced $ matches": "заменено совпадений: $",
          "Go to line": "Перейти к строке",
          go: "перейти",
        }),
        manuscriptTheme,
      ]}
    />
  );
});

MarkdownEditor.displayName = "MarkdownEditor";
export default MarkdownEditor;
