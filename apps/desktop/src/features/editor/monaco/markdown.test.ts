import type { Monaco } from "@monaco-editor/react";
import { describe, expect, it, vi } from "vitest";
import { registerMarkdownLanguage } from "./markdown";

describe("Markdown completion registration", () => {
  it("registers once per Monaco instance without overriding the built-in grammar", () => {
    const registerCompletionItemProvider = vi.fn();
    const monaco = { languages: { registerCompletionItemProvider } } as unknown as Monaco;
    registerMarkdownLanguage(monaco);
    registerMarkdownLanguage(monaco);
    expect(registerCompletionItemProvider).toHaveBeenCalledTimes(1);
    expect(registerCompletionItemProvider).toHaveBeenCalledWith(
      "markdown",
      expect.objectContaining({ provideCompletionItems: expect.any(Function) }),
    );
  });
});
