import Image from "next/image";
import type { ExternalAgentId } from "../lib/external-agent-catalog";

export function AgentLogo({
  id,
  className = "size-6",
}: {
  id: ExternalAgentId;
  className?: string;
}) {
  const source = `/agent-logos/${id === "zcode" ? "zai" : id}.svg`;
  const color = ["claude", "codex", "antigravity", "qoder", "deepseek", "kimi"].includes(id);
  if (color)
    return (
      <Image
        src={`/agent-logos/${id}-color.svg`}
        alt=""
        width={24}
        height={24}
        unoptimized
        className={`shrink-0 ${className}`}
      />
    );
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{
        maskImage: `url("${source}")`,
        maskRepeat: "no-repeat",
        maskPosition: "center",
        maskSize: "contain",
        WebkitMaskImage: `url("${source}")`,
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        WebkitMaskSize: "contain",
      }}
    />
  );
}
