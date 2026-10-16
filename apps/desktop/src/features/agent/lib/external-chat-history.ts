export type ExternalChatMessage = { id: string; role: "user" | "assistant"; content: string };
export type ExternalChatRecord = {
  id: string;
  title: string;
  modified: string;
  renamed?: boolean;
  messages: ExternalChatMessage[];
};
export function chatHistoryKey(directory: string, agent: string) {
  return `inkwell-external-chat-v1:${JSON.stringify([directory, agent])}`;
}
export function readChatHistory(key: string): ExternalChatRecord[] {
  const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
  if (!Array.isArray(parsed)) throw new Error("Invalid conversation history");
  return parsed.filter(
    (record): record is ExternalChatRecord =>
      record &&
      typeof record.id === "string" &&
      typeof record.title === "string" &&
      typeof record.modified === "string" &&
      Array.isArray(record.messages) &&
      record.messages.every(
        (message: ExternalChatMessage) =>
          message &&
          typeof message.id === "string" &&
          ["user", "assistant"].includes(message.role) &&
          typeof message.content === "string",
      ),
  );
}
