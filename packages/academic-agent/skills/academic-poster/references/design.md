# Poster composition

## Build the argument before the layout

Treat the poster as a compressed argument, not a decorated abstract. Establish this logic before arranging elements:

1. Why the problem matters and what is unknown.
2. What the method changes and why it should work.
3. What the strongest results show, including comparisons and conditions.
4. How far the evidence supports the conclusion and what remains limited.

Put the verified title, authors, a one-sentence central claim, and the most decisive evidence near the top of the reading path. A compact metric strip can work when the paper has at least three distinct and directly comparable quantitative findings. Every item must state what was measured and its comparison or condition; omit the strip when the evidence does not support it. Do not invent icons, metrics, or comparisons to fill slots.

Build sections around the paper's actual evidence. Use a header for the conference/venue mark, title, subtitle, authors, affiliations, logos, and QR links when supplied; place the metric strip and one-sentence thesis below it. Motivation/question, method/mechanism, key results, generalization/robustness, and one concise takeaway are useful options, not mandatory headings. Merge, rename, reorder, or omit sections that do not advance the argument. Use exactly one summary section (`Conclusion`, `Takeaways`, or equivalent). Do not repeat the same result in multiple sections unless the second appearance adds a distinct interpretation.

## Establish hierarchy and reading order

- Make the title, central claim, and strongest paper figure visible before detailed prose.
- For a new portrait poster, use three body columns with a wider center, roughly 0.9:1.3:0.9. Treat this as the required default. Change the count or proportions only for a concrete venue constraint or essential source figure that makes it unworkable; record that reason in the brief. Avoid two-column and equal-width layouts by default.
- Use four metric cards with parallel title/value/comparison structure and a relevant icon when the paper supplies four distinct, comparable, verified results. When it does not, use only the supported cards or omit the strip; never invent a value or comparison to fill a slot.
- Place motivation, problem mismatch, and design constraints on the left; overview/method and mechanism evidence in the wider center; main results, generalization, robustness, and the single conclusion on the right. Keep section numbers consistent with the reading order.
- Use a clear top-to-bottom and left-to-right path.
- Align repeated sections and keep spacing consistent. Use section bands or restrained panels to group related information; avoid nested decorative cards and unrelated content islands.
- Make comparable plots similar in size, and align the lowest content edges intentionally so no column looks accidentally unfinished.
- Keep coherent figures intact. If one figure leaves surrounding whitespace, rebalance adjacent text or panels before cropping or splitting it.
- Include an explanation beside each important chart or table: what is measured, the comparison, units, sample size, uncertainty, and the conclusion it supports when these are reported. Put a method or overview figure in the widest available region when its labels or flow require it.
- Use labels as well as color to distinguish conditions. Do not add decorative charts, icons, logos, QR codes, or filler copy without a source or purpose.
- If blank space remains, check for a missing result, mechanism, or limitation; enlarge an unreadable authentic figure; rebalance adjacent content; or remove redundancy. Only add a concise paper-backed explanation when it strengthens the argument. Never add generic prose just to occupy space.

## Set readable type and density

For A0, start with 20–28 mm page margins, 15–20 mm column gaps, an 18–24 mm title, 10–13 mm section headings, and 7–9 mm body text. Scale up for smaller sheets where needed. In Inkwell, these lengths and `fontSize` values are millimetres. Leave at least 10% extra height in text boxes after estimating line wraps. Keep captions and short interpretive notes close to body size; do not quietly demote robustness, sensitivity, or mechanism explanations to tiny footnotes. Use stable fixed sizes, moderate font weight, and zero letter spacing.

An A0 poster often works with roughly 350–650 words, but evidence and venue needs decide the final count. Prefer removing repetition over shrinking type. Keep body text and captions consistent; explanatory notes for key results should not become footnotes. Use moderate weight and stable sizes. Balance title, subtitle, and author sizes rather than letting one overpower the others. When no visual direction is given, use a white background with navy text, blue accents, and pale blue panels; preserve existing colors when revising unless the user requests a redesign.

## Use authentic visual material

- Prefer figures, tables, equations, logos, and QR assets supplied with the paper or project. Preserve complete visual context, labels, and attribution. Keep coherent figures whole unless a requested crop preserves their scientific meaning. Use official logos when available; do not hand-draw them. Make QR codes large enough to scan and add a short caption when helpful.
- Recreate a simple diagram or data graphic only when its relationships and values are explicit in the paper. Cite the source in a nearby caption or note.
- Never estimate numeric chart data from pixels. Do not invent comparisons, uncertainty, significance, or baselines. Simplify tables only when every reported comparison and result remains faithful; avoid duplicating a full result table elsewhere.
- Generated mockups may guide overall hierarchy, density, spacing, and palette. Replace every generated word, number, chart, equation, QR code, and logo with verified content or an explicit placeholder before the final poster.
- Inkwell text is plain text: Markdown and LaTeX are not rendered as formulas. Use Unicode for simple symbols. For complex equations, use an attributed project-local image and explain that it is not editable text.

## Account for Inkwell's element model

Inkwell posters contain `text`, `rect`, and `image` elements. Objects are separate and editable, but there is no native table, arbitrary vector path, HTML, or script element. Use text and rectangles for simple metric strips, section bands, or small diagrams. Keep complex plots and diagrams as original project-local image assets. Build a layout that fits this model instead of targeting CSS features the editor cannot represent.

Use local relative paths for images. For `posters/result.poster.json`, a file at `figures/result.png` is referenced as `../figures/result.png`. Keep every image below 8 MiB, respect the review proposal limit, and verify the file exists. Avoid base64 images for Agent-generated posters.

## Generate a visual reference first

For every new poster or substantial redesign, generating and reviewing one visual reference from the verified brief before implementation is required, even when the user did not separately request a concept image. Use the Agent's available image-generation tool with `purpose: "poster_reference"` and this skill's reference prompt. In Inkwell, this keeps the bitmap in memory for the current generation instead of saving it as a project deliverable. The default reference direction is an A0 portrait, three columns in roughly 0.9:1.3:0.9 proportions, white or light-blue panels, and navy headers. Use another grid only for a concrete venue constraint or an essential source figure that cannot fit; record the reason. Use the result to set hierarchy, reading path, panel proportions, and spacing, then rebuild it as editable `.poster.json` elements. Never use the full-page reference image as the poster or treat its generated text, data, charts, logos, or marks as facts. Do not tell the user the internal reference was saved or delivered. If no image-generation tool is available, report that this required step is blocked and ask the user to switch to an image-capable Agent or explicitly waive it before continuing. The paper and its local assets remain the only sources of facts.

## Check section content

- A problem section may add a paper-backed constraint, assumption, or failure mode that explains why the research question matters.
- A method section should explain the design principle or mechanism, not just list steps.
- A result panel should pair evidence with a concise interpretation of what the figure establishes.
- Robustness or sensitivity plots need readable explanatory text at body size.
- Keep one main conclusion and avoid duplicate summary sections.
