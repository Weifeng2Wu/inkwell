/** Shapes returned by the OpenCode session-message endpoint. */

export interface OpenCodeMessagePart {
  type?: string;
  text?: string;
}

export interface OpenCodeMessageInfo {
  id?: string;
  role?: string;
  parentID?: string;
  error?: {
    data?: {
      message?: string;
    };
  };
}

export interface OpenCodeMessageItem {
  info?: OpenCodeMessageInfo;
  parts?: OpenCodeMessagePart[];
}

/** Collects the text of every `text` part, ignoring tool and reasoning parts. */
export function extractTextParts(parts: OpenCodeMessagePart[] | undefined): string[] {
  if (!Array.isArray(parts)) return [];
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string);
}

/**
 * Narrows an untyped JSON response to a message item.
 *
 * The daemon's response shape is not guaranteed, so callers read the result defensively
 * rather than asserting a type onto the raw payload.
 */
export function parseOpenCodeMessageResponse(data: unknown): OpenCodeMessageItem | null {
  if (!data || typeof data !== "object") return null;
  const candidate = data as OpenCodeMessageItem;
  return candidate;
}
