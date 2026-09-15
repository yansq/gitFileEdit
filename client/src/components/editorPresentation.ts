import { HighlightStyle } from "@codemirror/language";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import type { Extension } from "@codemirror/state";
import { tags } from "@lezer/highlight";

export type EditorLanguageMode = "auto" | "xml";

export const editorFontFamily =
  '"Cascadia Mono", "Cascadia Code", "JetBrains Mono", "SFMono-Regular", Consolas, "Microsoft YaHei UI", "Microsoft YaHei", "Liberation Mono", monospace';

export const editorHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: "rgb(var(--color-syntax-comment))" },
  { tag: [tags.keyword, tags.typeName, tags.className], color: "rgb(var(--color-syntax-keyword))", fontWeight: "600" },
  { tag: [tags.propertyName, tags.attributeName], color: "rgb(var(--color-syntax-property))" },
  { tag: [tags.tagName, tags.string, tags.regexp], color: "rgb(var(--color-syntax-string))" },
  { tag: [tags.number, tags.bool, tags.null], color: "rgb(var(--color-syntax-number))" },
  { tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket], color: "rgb(var(--color-syntax-punctuation))" },
  { tag: tags.invalid, color: "rgb(var(--color-danger))", textDecoration: "underline wavy" },
]);

export function editorLanguageForPath(
  filePath: string,
  languageMode: EditorLanguageMode = "auto",
): Extension {
  if (languageMode === "xml") return xml();

  const fileName = filePath.split("/").pop() ?? "";
  if (!fileName) return [];

  const extensionIndex = fileName.lastIndexOf(".");
  if (extensionIndex <= 0 || extensionIndex === fileName.length - 1) return yaml();

  const extension = fileName.slice(extensionIndex + 1).toLowerCase();
  if (extension === "xml") return xml();
  if (extension === "yaml" || extension === "yml") return yaml();
  return [];
}
