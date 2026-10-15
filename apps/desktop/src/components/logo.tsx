/**
 * Inkwell wordmark.
 *
 * Inline rather than a `next/image` asset so the droplet and the wordmark can read the
 * active theme's tokens: `fill-accent` follows `--accent`, which differs per theme. Two
 * hardcoded light/dark SVG files cannot express the six themes that ship.
 */

const DROPLET_PATH = "M11 2C11 2 5 9.6 5 13.4a6 6 0 0 0 12 0C17 9.6 11 2 11 2Z";

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
      aria-label="Inkwell"
      className={className}
    >
      <g transform={isLarge ? "translate(0 4) scale(1.8182)" : "translate(1 3)"}>
        <path d={DROPLET_PATH} className="fill-accent" />
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
        Inkwell
      </text>
    </svg>
  );
}
