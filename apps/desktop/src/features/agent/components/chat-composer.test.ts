import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/features/i18n";
import type { SelectionAttachment } from "@/types/editor-selection";
import type { FileNode } from "@/types/files";
import type { Paper } from "@/types/papers";
import { ChatComposer } from "./chat-composer";

function render(
  working: boolean,
  value = "Hello",
  files: FileNode[] = [],
  selections: SelectionAttachment[] = [],
  papers?: readonly Paper[],
) {
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
        files,
        papers,
        selections,
        onRemoveSelection: vi.fn(),
        onRevealSelection: vi.fn(),
      }),
    ),
  );
}
describe("chat composer", () => {
  it("shows compact source links without exposing the excerpt and allows sending without a typed message", () => {
    const markup = render(
      false,
      "",
      [],
      [
        {
          id: "selection-1",
          path: "intro.tex",
          text: "<script>unsaved</script>",
          startLineNumber: 2,
          startColumn: 3,
          endLineNumber: 4,
          endColumn: 5,
        },
      ],
    );
    expect(markup).toContain("intro.tex");
    expect(markup).toContain("lines 2–4");
    expect(markup).toContain('aria-label="Show intro.tex, lines 2–4 in the editor"');
    expect(markup).not.toContain("intro.tex:2:3");
    expect(markup).not.toContain("unsaved");
    expect(markup).not.toContain("<details");
    expect(markup).toContain('aria-label="Remove the excerpt from intro.tex"');
    expect(markup).not.toMatch(/<button[^>]*aria-label="Send"[^>]*\sdisabled="/);
    expect(render(false, "")).toMatch(/<button[^>]*aria-label="Send"[^>]*\sdisabled="/);
  });
  it("shows the basename with a single inclusive line while keeping the full path in the tooltip", () => {
    const markup = render(
      false,
      "",
      [],
      [
        {
          id: "selection-2",
          path: "chapters/intro.tex",
          text: "A sentence.\n",
          startLineNumber: 12,
          startColumn: 1,
          endLineNumber: 13,
          endColumn: 1,
        },
      ],
    );
    expect(markup).toContain('title="chapters/intro.tex"');
    expect(markup).toContain('aria-label="Show intro.tex, line 12 in the editor"');
    expect(markup).not.toContain("lines 12–13");
    expect(markup).not.toContain("A sentence.");
  });
  it("shows a PDF excerpt as file name and page, without the quoted text", () => {
    const markup = render(
      false,
      "",
      [],
      [{ id: "excerpt-1", path: "papers/smith.pdf", text: "<b>quoted</b> finding", page: 12 }],
    );
    expect(markup).toContain('title="papers/smith.pdf"');
    expect(markup).toContain('aria-label="Show smith.pdf, p. 12 in the editor"');
    expect(markup).toContain("· p. 12");
    expect(markup).not.toContain("quoted");
    expect(markup).not.toMatch(/\blines? \d/);
    expect(markup).toContain('aria-label="Remove the excerpt from papers/smith.pdf"');
    expect(markup).not.toMatch(/<button[^>]*aria-label="Send"[^>]*\sdisabled="/);
  });
  it("offers library papers after files in the @ picker, labelled and capped", () => {
    const papers: Paper[] = [
      {
        key: "muller2020",
        title: "Attention <i>Is</i> All You Need",
        authors: ["Jörg Müller", "Ada Lovelace"],
        year: "2020",
        venue: "NeurIPS",
      },
      { key: "solo1999", title: "", authors: ["Solo Author"], year: "", venue: "" },
      ...Array.from({ length: 12 }, (_, index) => ({
        key: `extra${index}`,
        title: `Extra ${index}`,
        authors: [],
        year: "2001",
        venue: "",
      })),
    ];
    const files = [{ name: "main.tex", path: "main.tex", type: "file" as const }];
    const all = render(false, "@", files, [], papers);
    expect((all.match(/role="option"/g) ?? []).length).toBe(1 + 8);
    expect(all.indexOf("main.tex")).toBeLessThan(all.indexOf("muller2020"));
    expect(all).toContain(">Paper</span>");
    expect(all).toContain("Attention &lt;i&gt;Is&lt;/i&gt; All You Need");
    expect(all).toContain("Jörg Müller et al. · 2020");
    expect(all).toContain(">muller2020</span>");
    expect(all).toContain("Solo Author</span>");
    const byAuthor = render(false, "see @MULLER", files, [], papers);
    expect((byAuthor.match(/role="option"/g) ?? []).length).toBe(1);
    expect(byAuthor).toContain("muller2020");
    const scoped = render(false, "@paper:", files, [], papers);
    expect(scoped).not.toContain(">File</span>");
    expect((scoped.match(/role="option"/g) ?? []).length).toBe(8);
    expect(render(false, "/", files, [], papers)).not.toContain("muller2020");
    expect(render(false, "@", files)).not.toContain(">Paper</span>");
  });
  it("uses an upload plus and one icon action, rather than text Send/Stop buttons", () => {
    const markup = render(false);
    expect(markup).toContain('aria-label="Add images"');
    expect(markup).toContain('aria-label="Send"');
    expect(markup).not.toContain('aria-label="Stop"');
    expect(markup).not.toContain(">Send</button>");
    expect(markup).toContain("@ files and papers · / Skills");
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
    expect(markup).toMatch(/<button[^>]*class="toolbar-icon-button[^>]*aria-label="Add images"/);
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
