import { describe, expect, it } from "vitest";
import { isMissingSynctexData } from "./synctex-error";

describe("missing SyncTeX data", () => {
  it("recognizes the Windows CLI error without treating it as an accept failure", () => {
    expect(
      isMissingSynctexData(
        "synctex edit failed: SyncTeX ERROR: No SyncTeX available for C:\\paper.pdf\r\nusage: synctex <subcommand>",
      ),
    ).toBe(true);
    expect(isMissingSynctexData("SYNCTEX_DATA_MISSING")).toBe(true);
  });
  it("keeps unrelated failures visible", () => {
    expect(isMissingSynctexData("SYNCTEX_NOT_INSTALLED")).toBe(false);
    expect(isMissingSynctexData(new Error("Permission denied"))).toBe(false);
  });
});
