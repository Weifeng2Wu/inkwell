export function archiveKey(directory: string, agent: string) {
  return `inkwell-conversation-archive-v1:${JSON.stringify([directory, agent])}`;
}

export function readArchive(key: string): string[] {
  const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
  if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === "string"))
    throw new Error("Invalid conversation archive");
  return parsed;
}

export function setArchived(key: string, id: string, archived: boolean) {
  const ids = new Set(readArchive(key));
  if (archived) ids.add(id);
  else ids.delete(id);
  const next = [...ids];
  localStorage.setItem(key, JSON.stringify(next));
  return next;
}
