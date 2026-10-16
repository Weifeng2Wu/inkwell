import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentApiKeyInput } from "./agent-api-key-input";

const state = vi.hoisted(() => ({ draft: null as string | null }));
vi.mock("react", () => ({
  useState: () => [
    state.draft,
    (value: string | null) => {
      state.draft = value;
    },
  ],
}));

type InputHandlers = {
  value: string;
  type: string;
  onFocus: () => void;
  onBlur: () => void;
  onChange: (event: { target: { value: string } }) => void;
  onKeyDown: (event: { key: string; currentTarget: { blur: () => void } }) => void;
};

const onCommit = vi.fn();
function renderInput() {
  return AgentApiKeyInput({
    id: "api-key",
    value: "sk-fixture-private-key-1234",
    loading: false,
    placeholder: "Enter key",
    className: "settings-control",
    onCommit,
  }).props as InputHandlers;
}

beforeEach(() => {
  state.draft = null;
  onCommit.mockReset();
});

describe("API key overwrite field", () => {
  it("shows a mask and starts a blank password entry on focus", () => {
    const input = renderInput();
    expect(input.value).toBe("sk-f***1234");
    expect(input.type).toBe("text");
    input.onFocus();
    expect(renderInput().value).toBe("");
    expect(renderInput().type).toBe("password");
  });

  it("commits only the new key on blur, never the masked display", () => {
    renderInput().onFocus();
    renderInput().onChange({ target: { value: " fixture-replacement-key " } });
    expect(onCommit).not.toHaveBeenCalled();
    renderInput().onBlur();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith("fixture-replacement-key");
    expect(state.draft).toBeNull();
  });

  it("leaves the saved key unchanged when the field is left blank", () => {
    renderInput().onFocus();
    renderInput().onBlur();
    expect(onCommit).not.toHaveBeenCalled();
    expect(renderInput().value).toBe("sk-f***1234");
  });

  it("pressing Enter leaves the field to commit the replacement", () => {
    const blur = vi.fn();
    renderInput().onKeyDown({ key: "Enter", currentTarget: { blur } });
    expect(blur).toHaveBeenCalledOnce();
  });
});
