import { useState } from "react";
import { maskApiKey } from "../lib/agent-api-key-store";

export function AgentApiKeyInput({
  id,
  value,
  loading,
  placeholder,
  className,
  onCommit,
}: {
  id: string;
  value: string;
  loading: boolean;
  placeholder: string;
  className: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      id={id}
      type={draft === null ? "text" : "password"}
      autoComplete="off"
      autoCapitalize="none"
      spellCheck={false}
      className={className}
      value={draft ?? maskApiKey(value)}
      aria-busy={loading}
      maxLength={16_384}
      placeholder={placeholder}
      onFocus={() => setDraft("")}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft?.trim()) onCommit(draft.trim());
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}
