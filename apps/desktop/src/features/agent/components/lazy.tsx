"use client";

import dynamic from "next/dynamic";
import { OpenCodePanelSkeleton } from "@/features/agent/components/opencode-panel-skeleton";

/**
 * The agent panel and its dialogs pull in markdown rendering and the streaming client, so
 * they load on demand. The skeleton keeps the panel's footprint stable while it arrives.
 */

export const OpenCodePanel = dynamic(
  () => import("@/features/agent/components/opencode-panel").then((mod) => mod.OpenCodePanel),
  {
    ssr: false,
    loading: () => <OpenCodePanelSkeleton />,
  },
);

export const OpenCodeDisconnectedDialog = dynamic(
  () =>
    import("@/features/agent/components/opencode-disconnected-dialog").then(
      (mod) => mod.OpenCodeDisconnectedDialog,
    ),
  { ssr: false },
);

export const OpenCodeErrorBoundary = dynamic(
  () =>
    import("@/features/agent/components/opencode-error-boundary").then(
      (mod) => mod.OpenCodeErrorBoundary,
    ),
  { ssr: false },
);

export const OpenCodeErrorDialog = dynamic(
  () =>
    import("@/features/agent/components/opencode-error-dialog").then(
      (mod) => mod.OpenCodeErrorDialog,
    ),
  { ssr: false },
);
