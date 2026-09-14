import { HighlightStyle } from "@codemirror/language";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import type { Extension } from "@codemirror/state";
import { tags } from "@lezer/highlight";

export type EditorLanguageMode = "auto" | "xml";

export const editorHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: "#8a94a3", fontStyle: "italic" },
  { tag: [tags.keyword, tags.typeName, tags.className], color: "#50677c", fontWeight: "600" },
  { tag: [tags.propertyName, tags.attributeName], color: "#3f6477" },
  { tag: [tags.tagName, tags.string, tags.regexp], color: "#287f7b" },
  { tag: [tags.number, tags.bool, tags.null], color: "#8b663f" },
  { tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket], color: "#6b7280" },
  { tag: tags.invalid, color: "#9f2f20", textDecoration: "underline wavy" },
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
