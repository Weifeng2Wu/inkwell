import { describe, expect, it } from "vitest";
import { fileMentions, mentionQuery, readChatImage, workspaceMentions } from "./chat-input";

describe("chat references and attachments", () => {
  it("uses translated attachment validation messages", async () => {
    const errors = { type: "不支持的图片格式", size: "图片过大", read: "无法读取图片" };
    await expect(
      readChatImage(new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }), errors),
    ).rejects.toThrow(errors.type);
    await expect(
      readChatImage(new File([new Uint8Array(250000)], "x.png", { type: "image/png" }), errors),
    ).rejects.toThrow(errors.size);
  });
  it("matches at the caret without treating emails as mentions", () => {
    expect(mentionQuery("read @pap", 9)).toEqual({ query: "pap", start: 5, end: 9 });
    expect(mentionQuery("a@b.com", 7)).toBeNull();
    expect(mentionQuery("@", 1)).toEqual({ query: "", start: 0, end: 1 });
  });
  it("collects nested project-relative files", () => {
    expect(
      fileMentions(
        [
          {
            name: "src",
            path: "/project/src",
            type: "directory",
            children: [{ name: "paper.tex", path: "/project/src/paper.tex", type: "file" }],
          },
        ],
        "/project",
      ),
    ).toEqual(["src/paper.tex"]);
  });
  it("lists folders one level at a time for the @ picker", () => {
    const files = [
      {
        name: "src",
        path: "/project/src",
        type: "directory" as const,
        children: [
          { name: "paper.tex", path: "/project/src/paper.tex", type: "file" as const },
          { name: "figures", path: "/project/src/figures", type: "directory" as const, children: [
            { name: "plot.png", path: "/project/src/figures/plot.png", type: "file" as const },
          ] },
        ],
      },
    ];
    expect(workspaceMentions(files, "/project", "")).toEqual([
      { path: "src", name: "src", folder: true },
    ]);
    expect(workspaceMentions(files, "/project", "src/")).toEqual([
      { path: "src/paper.tex", name: "paper.tex", folder: false },
      { path: "src/figures", name: "figures", folder: true },
    ]);
    expect(workspaceMentions(files, "/project", "src/figures/")).toEqual([
      { path: "src/figures/plot.png", name: "plot.png", folder: false },
    ]);
  });
  it("rejects oversized or active image formats before reading them", async () => {
    await expect(
      readChatImage(new File(["<svg/>"], "x.svg", { type: "image/svg+xml" })),
    ).rejects.toThrow("PNG");
    await expect(
      readChatImage(new File([new Uint8Array(250000)], "x.png", { type: "image/png" })),
    ).rejects.toThrow("240 KB");
  });
});
