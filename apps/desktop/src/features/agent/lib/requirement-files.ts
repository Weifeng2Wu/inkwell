import { invoke } from "@tauri-apps/api/core";
import { parseLayoutPdf, requireLayoutConfig } from "@/features/settings";
import { MAX_REQUIREMENT_BYTES, type RequirementSource } from "./format-review";

const TEXT_EXTENSIONS =
  /\.(txt|md|markdown|tex|latex|cls|sty|bst|bbx|cbx|def|cfg|dtx|ins|ltx|bib|csv|json|yaml|yml|html|htm|rst)$/i;
export const REQUIREMENT_ACCEPT =
  ".zip,.pdf,.txt,.md,.markdown,.tex,.latex,.cls,.sty,.bst,.bbx,.cbx,.def,.cfg,.dtx,.ins,.ltx,.bib,.csv,.json,.yaml,.yml,.html,.htm,.rst";

export async function readRequirementFiles(
  files: File[],
  errors: {
    limit: string;
    unsupported: string;
    unreadable: string;
    emptyPdf: string;
    tooLong: string;
    layoutMissing?: string;
  },
  reportSkipped?: (names: string[]) => void,
): Promise<RequirementSource[]> {
  if (!files.length || files.length > 8) throw new Error(errors.limit);
  const expanded: { file: File; archived: boolean }[] = [];
  const skipped: string[] = [];
  let expandedBytes = 0;
  for (const file of files) {
    if (file.size > 12 * 1024 * 1024) throw new Error(`${file.name}: ${errors.limit}`);
    if (!/\.zip$/i.test(file.name)) {
      expanded.push({ file, archived: false });
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32768)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    const result = await invoke<{ files: { name: string; data: string }[]; skipped: string[] }>(
      "agent_shared_skills",
      { request: { type: "format_requirements_zip", data: btoa(binary) } },
    );
    skipped.push(...result.skipped.map((name) => `${file.name}/${name}`));
    if (expanded.length + result.files.length > 80) throw new Error(errors.tooLong);
    for (const entry of result.files) {
      expandedBytes += Math.floor((entry.data.length * 3) / 4);
      if (expandedBytes > 48 * 1024 * 1024) throw new Error(errors.tooLong);
      const content = Uint8Array.from(atob(entry.data), (character) => character.charCodeAt(0));
      expanded.push({ file: new File([content], `${file.name}/${entry.name}`), archived: true });
    }
  }
  if (expanded.length > 80) throw new Error(errors.tooLong);
  if (expanded.some(({ file }) => /\.pdf$/i.test(file.name)))
    await requireLayoutConfig(errors.layoutMissing ?? errors.unreadable);
  let totalBytes = 0;
  const sources: RequirementSource[] = [];
  for (const { file, archived } of expanded) {
    if (file.size > 12 * 1024 * 1024) throw new Error(`${file.name}: ${errors.limit}`);
    try {
      let text: string;
      if (/\.pdf$/i.test(file.name)) {
        text = await parseLayoutPdf(file, errors.layoutMissing ?? errors.unreadable);
        totalBytes += new TextEncoder().encode(text).length;
      } else if (TEXT_EXTENSIONS.test(file.name)) {
        const bytes = await file.arrayBuffer();
        try {
          // Preserve a style file's BOM for official-file integrity comparisons.
          text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        } catch {
          throw new Error(`${file.name}: ${errors.unreadable}`);
        }
        if (/\.html?$/i.test(file.name)) {
          const document = new DOMParser().parseFromString(text, "text/html");
          for (const node of document.querySelectorAll("script,style,iframe,object,embed"))
            node.remove();
          text = document.body.textContent ?? "";
        }
        totalBytes += new TextEncoder().encode(text).length;
      } else throw new Error(`${file.name}: ${errors.unsupported}`);
      if (!text.trim() || text.includes("\0"))
        throw new Error(`${file.name}: ${errors.unreadable}`);
      if (totalBytes > MAX_REQUIREMENT_BYTES) throw new Error(errors.tooLong);
      sources.push({ id: `S${sources.length + 1}`, name: file.name, text });
    } catch (caught) {
      if (
        !archived ||
        /\.pdf$/i.test(file.name) ||
        (caught instanceof Error && caught.message.includes(errors.tooLong))
      )
        throw caught;
      skipped.push(`${file.name}: ${String(caught)}`);
    }
  }
  reportSkipped?.(skipped);
  if (!sources.length) throw new Error(errors.unreadable);
  return sources;
}
