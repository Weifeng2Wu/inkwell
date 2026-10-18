import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/features/i18n";
import { ChatComposer } from "./chat-composer";
import type { FileNode } from "@/types/files";

function render(working: boolean, value = "Hello", files: FileNode[] = []) {
  return renderToStaticMarkup(
    createElement(
      I18nProvider,
      null,
      createElement(ChatComposer, {
        value,
        onChange: vi.fn(),
        onSend: vi.fn(async () => true),
        onStop: vi.fn(async () => {}),
        working,
        disabled: false,
        placeholder: "Message",
        sendLabel: "Send",
        stopLabel: "Stop",
        files,
      }),
    ),
  );
}
describe("chat composer", () => {
  it("uses an upload plus and one icon action, rather than text Send/Stop buttons", () => {
    const markup = render(false);
    expect(markup).toContain('aria-label="Add images"');
    expect(markup).toContain('aria-label="Send"');
    expect(markup).not.toContain('aria-label="Stop"');
    expect(markup).not.toContain(">Send</button>");
    expect(markup).toContain("@ files / enabled skills");
    expect(markup).toContain('type="file"');
  });
  it("switches the same action to Stop while generating", () => {
    expect(render(true)).toContain('aria-label="Stop"');
    expect(render(true)).not.toContain('aria-label="Send"');
  });
  it("keeps the textarea editable while the Agent is generating", () => {
    const markup = render(true);
    expect(markup).toMatch(/<textarea\b/);
    expect(markup).not.toMatch(/<textarea[^>]*disabled/);
  });
  it("reserves space below the fixed-height textarea for the toolbar", () => {
    const markup = render(false);
    expect(markup).toMatch(/<textarea[^>]*class="block h-24 w-full resize-none overflow-y-auto/);
    expect(markup).not.toContain("resize-y");
    expect(markup).not.toContain("pb-14");
  });
  it("keeps the toolbar in normal flow below long, scrollable text", () => {
    const markup = render(false, "Long message\n".repeat(100));
    expect(markup).toContain(
      '</textarea><div class="relative mx-2 my-2 flex items-center justify-between">',
    );
    expect(markup).toMatch(
      /<button[^>]*class="toolbar-icon-button[^>]*aria-label="Add images"/,
    );
    expect(markup).toMatch(/<button[^>]*aria-label="Send"[^>]*class="flex size-8/);
  });
  it("shows all matching file choices instead of truncating the list", () => {
    const files = Array.from({ length: 15 }, (_, index) => ({
      name: `paper-${index}.tex`,
      path: `paper-${index}.tex`,
      type: "file" as const,
    }));
    const markup = render(false, "@", files);
    expect(markup).toContain("paper-14.tex");
    expect((markup.match(/role="option"/g) ?? []).length).toBe(15);
  });
});
