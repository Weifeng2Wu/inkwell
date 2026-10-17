# Design-reference prompt workflow

Use this workflow before implementing every new poster or substantial redesign. A text-only model may prepare and refine the prompt, but an image-generation capability is required to produce the bitmap reference. In Inkwell, call the image tool with `purpose: "poster_reference"` so the reference is kept only in memory for the current generation and is not saved as a project image. Fill every bracketed field from the verified brief and project assets. The reference guides hierarchy, reading path, panel proportions, and spacing. It is never the factual poster or a replacement for the editable `.poster.json`.

Before prompting, collect:

1. Title, optional subtitle, authors, affiliations, conference/venue marks, and any confirmed institution logos.
2. The central thesis in one sentence and up to four genuinely distinct, source-verified metrics. Each metric needs its label, exact value, comparison or condition, and an icon concept only if the image tool can render a placeholder reliably. Omit the strip when the paper does not support four metrics; never invent values to fill slots.
3. The exact section order with a one-line purpose per section.
4. Original paper figures/tables that must appear, their filenames, and preferred roles or placement.
5. Confirmed URLs/QR destinations and captions, if supplied.
6. User direction, venue constraints, and specific problems to avoid from earlier drafts.

Do not make up missing content. Use clearly labeled neutral placeholders. For a new portrait poster, use three body columns with a wider center, roughly 0.9:1.3:0.9. Change this grid only for a concrete venue constraint or an essential source figure that cannot fit; record the reason. Section architecture, palette, and header arrangement should fit the actual paper and user direction.

```text
Create a high-fidelity academic conference poster visual reference for an Inkwell poster. This image will be reviewed for layout, then rebuilt as an editable `.poster.json` from verified paper text and original project assets. Default to A0 portrait only when no venue or user size is given. Target readable conference-poster density, balanced sections, a clear reading order, and a restrained professional style. Treat all generated text, data, charts, logos, and marks as placeholders, never as source content.

Visual direction: [user direction or the default: white/light-blue panels, deep navy headers, restrained green/red result accents]. Use moderate-weight sans-serif typography, consistent gutters, strong contrast, zero letter spacing, and a clear top-to-bottom, left-to-right path. Use three columns with a wider center in roughly 0.9:1.3:0.9 proportions. Do not use two columns or three equal columns unless a concrete venue constraint or essential source figure requires it; state that reason and the alternate proportions.

Header and argument:
- Title: [verified title]
- Subtitle: [verified subtitle or omit]
- Authors and affiliations: [verified list]
- Venue and official marks: [verified conference mark, logos, QR links, or omit]
- Central claim: [verified one-sentence claim]
- Research question: [verified question]
- Method: [short verified method summary]
- Metric strip: [four parallel verified label/value/comparison/icon-concept items when four are supported; otherwise list only supported items or omit]
- Thesis strip: [one verified central-claim sentence]
- Limitations: [short verified limitation]
- Thesis strip: [central claim, if it improves hierarchy]

Plan exactly these sections in this order and explain each panel's relative size: [section names, one-line purpose, and placement]. Use the left column for motivation/problem/design constraints, the wider center for the method overview and mechanism evidence, and the right column for main results, robustness/generalization, and the single conclusion. Preserve logical section numbering and align all three column bottoms. Reserve the largest uninterrupted areas for these authentic paper assets: [figure/table filenames and intended roles]. Show them as labeled image placeholders if the source images are not attached. Keep related plots at comparable sizes. Place each figure near its explanatory caption. Keep text, simple shapes, and figures in separate aligned regions so the layout can be rebuilt with editable text, rectangles, and images.

Use no invented numbers, baselines, author names, citations, affiliations, logos, QR destinations, or chart labels. Use neutral placeholders wherever details are missing. Do not reproduce long readable prose; text rendering is not the purpose of the reference. Keep one takeaway section, preserve coherent figures, avoid duplicate result tables, unindexed panels, decorative footers, random icons, and filler content. Do not fill whitespace with generic prose; rebalance panels or enlarge important evidence instead.

Avoid tiny unreadable paragraphs, heavy display typography, nonzero letter spacing, fake equations, invented charts, split/cropped figures, huge accidental blank areas, duplicate tables, miniature QR codes, stock-photo hero layouts, marketing-page composition, two-column layouts, and equal-width columns when a method figure needs more room.

Return a visual layout reference only. All final wording, numbers, figures, equations, logos, and QR codes will be replaced with verified paper content and local assets.
```

## Review and iterate

After generating a reference, compare it with the brief and inspect for:

- Missing or reordered sections, missing essential source figures, or invented panels.
- Title/author hierarchy that overwhelms or hides the central claim.
- Metric cards with missing labels, comparisons, or unsupported values.
- Coherent source figures cropped, split, or redrawn as invented charts.
- Text that is too small, too dense, too heavy, or too inconsistent.
- Unbalanced column bottoms, excessive blank areas, or filler panels.
- QR codes and logos that are too small, decorative, or fabricated.

If a problem materially affects the implementation, revise the prompt with a specific correction and generate a revised reference. Stop when the layout is implementable; do not iterate for minor aesthetic variation. If no image tool is available, state that no reference image was generated and continue from the verified brief. Never say a reference image was generated unless it was. In all cases, implement the deliverable as editable elements in `.poster.json`, using the reference only as a visual layout target and the paper and local assets as the authority for content.
