const WORDMARK_FONT =
  "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

type LogoProps = {
  /** `small` is the header lockup; `large` is the empty-state lockup. */
  size?: "small" | "large";
  className?: string;
};

export function Logo({ size = "small", className }: LogoProps) {
  const isLarge = size === "large";

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={isLarge ? "0 0 200 48" : "0 0 96 28"}
      width={isLarge ? 200 : 96}
      height={isLarge ? 48 : 28}
      role="img"
      aria-label="Glossa"
      className={className}
    >
      <g
        transform={isLarge ? "translate(0 5.5) scale(1.55)" : "translate(0.5 2)"}
        fill="none"
        strokeLinecap="round"
        strokeWidth="2.25"
        className="stroke-brand dark:stroke-brand-dark"
      >
        <path d="M4 6.5h9M4 12h6.5M4 17.5h8" />
        <path d="M18.5 5.5v13" />
      </g>
      <text
        x={isLarge ? 48 : 27}
        y={isLarge ? 33 : 19.5}
        fontFamily={WORDMARK_FONT}
        fontSize={isLarge ? 30 : 16}
        fontWeight={600}
        letterSpacing={isLarge ? -0.6 : -0.2}
        className="fill-foreground"
      >
        Glossa
      </text>
    </svg>
  );
}
