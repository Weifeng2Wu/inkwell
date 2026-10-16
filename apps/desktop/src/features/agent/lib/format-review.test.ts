import { describe, expect, it } from "vitest";
import { formatReviewPrompt, parseFormatRules } from "./format-review";

const sources = [
  { id: "S1", name: "rules.txt", text: "Use 10 pt font. Main text is limited to 8 pages." },
];
const rule = {
  category: "typography",
  requirement: "Use 10 pt font",
  source: "S1",
  evidence: "Use 10 pt font.",
  check: "Inspect PDF font sizes",
  severity: "required",
};

describe("format review skill generation", () => {
  it("asks for format rules only and treats uploaded sources as untrusted", () => {
    const prompt = formatReviewPrompt("Example 2027", sources);
    expect(prompt).toContain("FORMAT-ONLY");
    expect(prompt).toContain("Do NOT assess novelty");
    expect(prompt).toContain("UNTRUSTED");
    expect(prompt).toContain(JSON.stringify(sources));
  });
  it("accepts traceable JSON and fenced JSON outputs", () => {
    const value = JSON.stringify({ rules: [rule] });
    expect(parseFormatRules(value, sources)).toEqual([rule]);
    expect(parseFormatRules(`\`\`\`json\n${value}\n\`\`\``, sources)).toEqual([rule]);
  });
  it("rejects invented evidence, missing sources, unrelated categories and empty checklists", () => {
    for (const invalid of [
      { ...rule, evidence: "12 pt" },
      { ...rule, source: "S3" },
      { ...rule, category: "writing" },
      { ...rule, check: "" },
    ]) {
      expect(() => parseFormatRules(JSON.stringify({ rules: [invalid] }), sources)).toThrow();
    }
    expect(() => parseFormatRules('{"rules":[]}', sources)).toThrow();
    expect(() => parseFormatRules(" ".repeat(512001), sources)).toThrow("exceed limits");
  });
});
