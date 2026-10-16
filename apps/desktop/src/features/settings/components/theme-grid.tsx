"use client";

import { CheckIcon } from "@phosphor-icons/react";
import { THEMES } from "../lib/theme";

export function ThemeGrid({
  theme,
  onSelect,
  label,
}: {
  theme: string | undefined;
  onSelect: (identifier: string) => void;
  label: string;
}) {
  return (
    <fieldset
      aria-label={label}
      className="grid max-h-[21.5rem] min-w-0 auto-rows-[6.5rem] grid-cols-2 gap-3 overflow-y-auto overscroll-contain p-1 sm:grid-cols-3"
    >
      {THEMES.map((option) => {
        const selected = theme === option.id;
        return (
          <button
            type="button"
            key={option.id}
            aria-label={option.label}
            aria-pressed={selected}
            title={option.label}
            onClick={() => onSelect(option.id)}
            className={`relative flex min-w-0 flex-col gap-2.5 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              selected
                ? "border-accent bg-accent/10 shadow-sm ring-1 ring-accent"
                : "border-border hover:border-border-dark hover:bg-accent-hover"
            }`}
          >
            {selected && (
              <span className="absolute right-2.5 top-2.5 flex size-4 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <CheckIcon aria-hidden="true" className="size-2.5" />
              </span>
            )}
            <span
              aria-hidden="true"
              className="flex h-8 w-full shrink-0 items-center gap-1.5 rounded border border-border px-2"
              style={{ backgroundColor: option.swatch[0] }}
            >
              <span
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: option.swatch[2] }}
              />
              <span
                className="h-4 flex-1 rounded-sm"
                style={{ backgroundColor: option.swatch[1] }}
              />
            </span>
            <span className="block w-full truncate text-xs font-semibold text-foreground">
              {option.label}
            </span>
          </button>
        );
      })}
    </fieldset>
  );
}
