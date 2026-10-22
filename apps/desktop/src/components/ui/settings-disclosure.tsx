"use client";

import { CaretRightIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

export function SettingsDisclosure({
  title,
  children,
  open,
  className = "",
}: {
  title: ReactNode;
  children: ReactNode;
  open?: boolean;
  className?: string;
}) {
  return (
    <details
      open={open}
      className={`rounded-md border border-border p-3 [&[open]>summary>svg]:rotate-90 ${className}`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-foreground-secondary focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <CaretRightIcon
          className="size-3.5 shrink-0 transition-transform motion-reduce:transition-none"
          aria-hidden="true"
        />
        <span>{title}</span>
      </summary>
      <div className="space-y-3 pt-3">{children}</div>
    </details>
  );
}
