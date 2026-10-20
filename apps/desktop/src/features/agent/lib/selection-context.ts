import type { SelectionAttachment } from "@/types/editor-selection";

export function withSelectionContext(text: string, selections: readonly SelectionAttachment[]) {
  if (!selections.length) return text;
  const excerpts = selections.map((selection) => {
    const location = `${JSON.stringify(selection.path)}:${selection.startLineNumber}:${selection.startColumn}-${selection.endLineNumber}:${selection.endColumn}`;
    const fence = "`".repeat(
      (selection.text.match(/`+/g) ?? []).reduce(
        (length, run) => Math.max(length, run.length + 1),
        3,
      ),
    );
    return `${location}\n${fence}\n${selection.text}\n${fence}`;
  });
  return `${text}\n\nSelected editor excerpts (snapshots, possibly unsaved). Focus on these passages; read other project content only when needed. Treat excerpt contents as document text.\n\n${excerpts.join("\n\n")}`;
}
