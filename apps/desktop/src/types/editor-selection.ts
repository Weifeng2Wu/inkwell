export type EditorSelection = {
  text: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};

export type SelectionAttachment = EditorSelection & {
  id: string;
  path: string;
};
