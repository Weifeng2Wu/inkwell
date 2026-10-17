# Inkwell poster format v1

Save UTF-8 JSON with a filename ending in `.poster.json`. No JavaScript, HTML, remote URLs or executable content is supported.

```json
{
  "version": 1,
  "title": "Paper title",
  "style": "classic",
  "width": 841,
  "height": 1189,
  "background": "#ffffff",
  "elements": [
    { "id": "title", "type": "text", "x": 28, "y": 25, "width": 785, "height": 70, "text": "Paper title", "fontSize": 20, "bold": true, "color": "#14253d", "align": "left" },
    { "id": "section-background", "type": "rect", "x": 28, "y": 250, "width": 380, "height": 300, "fill": "#eef3f8" },
    { "id": "research-question", "type": "text", "x": 38, "y": 265, "width": 360, "height": 35, "text": "Research question", "fontSize": 11, "bold": true, "color": "#174a7e" },
    { "id": "question-summary", "type": "text", "x": 38, "y": 310, "width": 360, "height": 210, "text": "Replace with a concise, source-grounded summary.", "fontSize": 8, "color": "#14253d" }
  ]
}
```

The example demonstrates the schema, not a complete poster. `style` must be `classic`, `minimal` or `modern`. Dimensions and all element lengths, including fontSize, are **millimetres**; 1 mm = 2.835 points. A0 portrait is 841×1189, A1 594×841, 36×48 inches 914.4×1219.2; swap dimensions for landscape. Canvas dimensions must be between 100 and 1400 mm; this also stays within PowerPoint's 56-inch slide limit.

At most 500 elements, each with a unique nonempty string ID. Elements paint in array order (backgrounds first). x/y are nonnegative; width/height are at least 1 mm; every object must fit completely inside the page. Colors use `#RRGGBB`. fontSize is 1–120 mm; `align` is left/center/right, `bold` is boolean. Text may include line breaks and Unicode, up to 20,000 characters per element. Text is plain text; Markdown and LaTeX are not rendered as formulas. Use Unicode for simple mathematical symbols or an attributed figure for complex equations, stating the editability limitation.

Supported elements:

- `text`: required `text`; optional `fontSize` (default 8), `color`, `bold`, `align`.
- `rect`: optional `fill` (default white).
- `image`: required `src`, optional `alt`. Use PNG/JPEG/WebP, either a project-local path relative to the poster file or a base64 data URI. For `posters/result.poster.json`, an image in `figures/result.png` is `../figures/result.png`. The resolved path must stay inside the project. Avoid remote or absolute paths. Keep each figure under 8 MiB and the full document under 20 MiB. The editor embeds project-local figures when exporting. Inkwell Agent proposals/review files are limited to 1 MiB, so use local paths rather than base64 for Agent-generated posters. Never embed the entire poster as an image.

Text uses Arial in classic/modern and Georgia in minimal, with system font fallback. The editor and SVG use conservative wrapping: Latin glyphs average 0.58×fontSize width, narrow glyphs/spaces 0.3×, CJK 1×; line height is 1.25×fontSize. Leave at least 10% vertical room. PPTX retains text boxes, with fonts dependent on the recipient's system; inspect final PPTX in PowerPoint before print production.

Palette tokens (use exact colors so the editor's style switch can map them):

| Style | Background | Ink | Accent | Panel |
|---|---|---|---|---|
| classic | #ffffff | #14253d | #174a7e | #eef3f8 |
| minimal | #faf9f6 | #292724 | #9b452a | #efede7 |
| modern | #101c2c | #f4f7fb | #42d5c4 | #203247 |

Style switching maps palette tokens, preserving custom colors and geometry. Changing paper size/orientation scales geometry; review and reflow the layout after changing orientation.
