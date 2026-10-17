# Poster QA checklist

Run these checks before presenting a poster proposal. Use the actual `.poster.json` and paper sources, not a generated mockup, as the evidence authority.

## Source fidelity

- Title, author names, affiliations, and venue details match the source or user-provided metadata.
- Each claim and numeric value is traceable to a paper passage, figure, or table.
- Baselines, units, conditions, sample sizes, uncertainty, and direction of comparison are preserved.
- Conclusions do not exceed the evidence; important limitations remain visible.
- Figure captions explain the evidence and credit its source. No chart value was estimated by eye.
- Missing content is listed for the user instead of being invented.

## Poster structure

- The title, central claim, and most decisive evidence lead the reading path.
- Sections explain why the problem matters, what the method changes, why it should work, and how strongly results support the claim.
- Sections follow this paper's evidence; no fixed metric strip or section list has been forced when it does not fit.
- A new A0 portrait poster uses three body columns with a wider center (roughly 0.9:1.3:0.9); any deviation names a concrete venue constraint or essential source figure.
- The header, supported metric strip, and one-sentence thesis strip establish the poster's hierarchy before the body.
- Motivation/problem framing is left, the method overview and mechanism evidence use the wider center, and results/robustness/conclusion are right; section numbering follows reading order.
- Four parallel metric cards are used when four distinct comparable results are available; unsupported values are never invented to fill cards.
- Logos and QR links are authentic project/source assets, large enough to inspect or scan, and captioned when useful.
- Any metric strip contains only distinct, comparable, source-verified results with their comparison or conditions.
- There is exactly one concise conclusion/takeaway section and no duplicated result table without a distinct interpretation.
- Essential figures are complete and large enough to inspect; comparable plots have comparable scale where appropriate.
- Explanations sit next to the evidence they interpret.
- There is no duplicated result, generic filler, unexplained icon, decorative metric, or accidental empty region.

## Inkwell document validity

- The file ends in `.poster.json`, parses as JSON, and uses version `1`.
- The page and element colors use valid `#RRGGBB` values; dimensions are within 100–1400 mm.
- The poster has no more than 500 elements; IDs are unique and nonempty.
- Each element uses supported `text`, `rect`, or `image` fields and remains entirely inside the page bounds.
- Colors use `#RRGGBB`; font sizes and all geometry use millimetres; text remains plain text.
- Every image path resolves inside the project, uses PNG/JPEG/WebP, and stays under 8 MiB. No remote or absolute paths are used.
- Keep the complete Agent proposal below 1 MiB by referencing local figures rather than embedding them.

## Readability and preview

- Text boxes have enough height for Inkwell's approximate wrapping and at least 10% vertical slack.
- Contrast, line length, typography hierarchy, margins, spacing, and reading order work at the target page size.
- Body text, captions, and interpretive notes use consistent readable sizes, moderate weight, and zero letter spacing.
- Comparable plots use comparable sizes; method and mechanism figures have enough width for their labels and flow.
- The lowest content edges are intentionally balanced, and blank space has not been filled with generic copy.
- No text, captions, table-like groups, or figure labels are clipped or overlapped.
- If the actual Inkwell canvas is available, inspect it and correct visible problems before delivery. If it is not available, say that canvas inspection was not performed.
- Create and inspect an export only when requested. Do not claim that a PPTX, SVG, PDF, PNG, or JPEG exists unless it was actually generated.

## Visual-reference QA

- A generated reference follows the verified brief, exact section order, and intended reading path.
- Essential source figures are represented as complete placeholders; generated charts, text, numbers, equations, logos, and QR codes are never treated as facts.
- The layout has readable hierarchy, balanced panel sizes, intentional column bottoms, and no generic filler or duplicated result tables.
- Any iteration targets a concrete defect. Stop once the reference gives a usable layout direction.
- A reference is only claimed as generated when an image-generation tool actually produced it. A prompt alone is not an image.
