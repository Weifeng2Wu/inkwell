import { desktopStorage, storageRequest } from "@/lib/storage/app-storage";

export type ExternalChatMessage = { id: string; role: "user" | "assistant"; content: string };
export type ExternalChatRecord = {
  id: string;
  title: string;
  modified: string;
  renamed?: boolean;
  messageCount?: number;
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

function scope(key: string) {
  return key.slice("inkwell-external-chat-v1:".length);
}

export async function listChatHistory(key: string): Promise<ExternalChatRecord[]> {
  if (!desktopStorage()) return readChatHistory(key);
  const records: ExternalChatRecord[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await storageRequest<ExternalChatRecord[]>({
      type: "conversation_list",
      scope: scope(key),
      offset,
      limit: 200,
    });
    records.push(...page);
    if (page.length < 200) return records;
  }
}

export async function loadChatRecord(key: string, id: string) {
  if (desktopStorage())
    return storageRequest<ExternalChatRecord>({ type: "conversation_read", scope: scope(key), id });
  const record = readChatHistory(key).find((item) => item.id === id);
  if (!record) throw new Error("Conversation not found.");
  return record;
}

export async function saveChatRecord(key: string, record: ExternalChatRecord) {
  if (desktopStorage()) {
    await storageRequest({ type: "conversation_save", scope: scope(key), record });
    return;
  }
  const records = readChatHistory(key);
  localStorage.setItem(
    key,
    JSON.stringify([record, ...records.filter((item) => item.id !== record.id)]),
  );
}

export async function renameChatRecord(key: string, id: string, title: string) {
  if (desktopStorage()) {
    return (
      await storageRequest<{ changed: boolean }>({
        type: "conversation_rename",
        scope: scope(key),
        id,
        title,
      })
    ).changed;
  }
  const records = readChatHistory(key);
  if (!records.some((item) => item.id === id)) return false;
  localStorage.setItem(
    key,
    JSON.stringify(
      records.map((item) => (item.id === id ? { ...item, title, renamed: true } : item)),
    ),
  );
  return true;
}

export async function deleteChatRecord(key: string, id: string) {
  if (desktopStorage())
    return (
      await storageRequest<{ changed: boolean }>({
        type: "conversation_delete",
        scope: scope(key),
        id,
      })
    ).changed;
  const records = readChatHistory(key);
  if (!records.some((item) => item.id === id)) return false;
  localStorage.setItem(key, JSON.stringify(records.filter((item) => item.id !== id)));
  return true;
}
