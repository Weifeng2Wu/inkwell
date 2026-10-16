"use client";

import { useRouter } from "next/navigation";
import { SettingsPage } from "@/features/settings";

export default function StandaloneSettingsPage() {
  const router = useRouter();

  return <SettingsPage onClose={() => router.push("/")} />;
}
