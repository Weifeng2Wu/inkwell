import assert from "node:assert/strict";
import { test } from "node:test";
import {
  layoutStructuredPoster,
  parsePosterCanvas,
  parsePosterDocument,
  wrapPosterText,
} from "../src/poster-document.mjs";

const document = () => ({
  version: 2,
  title: "A verified research result",
  authors: "Author · Institution",
  subtitle: "The source-backed conclusion",
  width: 841,
  height: 1189,
  background: "#ffffff",
  columns: 3,
  sections: Array.from({ length: 6 }, (_, index) => ({
    id: `section-${index}`,
    title: `Section ${index + 1}`,
    blocks: [
      {
        id: `text-${index}`,
        type: "text",
        text: "Evidence, conditions and limitations. ".repeat(8),
      },
    ],
  })),
});

test("both input versions resolve to the same editable freeform canvas", () => {
  const structured = JSON.stringify(document());
  const canvas = parsePosterCanvas(structured);
  assert.equal(canvas.version, 1);
  assert.deepEqual(canvas, layoutStructuredPoster(JSON.parse(structured)).poster);
  canvas.elements[0].x += 5;
  assert.deepEqual(parsePosterCanvas(JSON.stringify(canvas)), canvas);
  assert.equal(JSON.parse(structured).version, 2);
});

test("structured layout is deterministic, bounded, non-overlapping and preserves reading order", () => {
  const input = parsePosterDocument(JSON.stringify(document()));
  const result = layoutStructuredPoster(input);
  assert.deepEqual(layoutStructuredPoster(input), result);
  assert.equal(result.poster.elements.filter((element) => element.id.endsWith("-panel")).length, 6);
  let previousColumn = -1;
  let previousBottom = -1;
  for (const element of result.poster.elements) {
    assert.ok(element.x >= 0 && element.y >= 0);
    assert.ok(element.x + element.width <= input.width + 0.01);
    assert.ok(element.y + element.height <= input.height + 0.01);
    if (element.type === "text")
      assert.ok(
        wrapPosterText(element.text, element.width, element.fontSize).length *
          element.fontSize *
          1.25 <=
          element.height,
      );
    if (!element.id.endsWith("-panel")) continue;
    assert.ok(element.x >= previousColumn);
    if (element.x === previousColumn) assert.ok(element.y >= previousBottom);
    previousColumn = element.x;
    previousBottom = element.y + element.height;
  }
});

test("edits reflow sections and authentic images retain their requested aspect ratio", () => {
  const input = document();
  input.sections[0].blocks.push({
    id: "figure",
    type: "image",
    src: "../figures/result.png",
    aspectRatio: 2,
    caption: "Verified caption",
  });
  const before = layoutStructuredPoster(input).poster;
  input.sections[0].blocks[0].text += "Additional verified evidence. ".repeat(30);
  const after = layoutStructuredPoster(input).poster;
  assert.notDeepEqual(before, after);
  const image = after.elements.find((element) => element.type === "image");
  assert.equal(image.width / image.height, 2);
  assert.equal(image.src, "../figures/result.png");
});

test("unfittable content fails explicitly, and malformed v1 and v2 documents share validation", () => {
  const input = document();
  input.sections[0].blocks[0].text = "Long evidence. ".repeat(1200);
  assert.throws(() => layoutStructuredPoster(input), /does not fit/);
  for (const invalid of [
    { ...document(), columns: 4 },
    { ...document(), width: 0 },
    {
      ...document(),
      sections: [
        {
          id: "one",
          title: "One",
          blocks: [{ type: "image", src: "https://example.com/image.png" }],
        },
      ],
    },
    {
      version: 1,
      title: "Invalid",
      width: 841,
      height: 1189,
      background: "#ffffff",
      elements: [
        { id: "bad", type: "text", x: 800, y: 0, width: 100, height: 100, text: "Off-page" },
      ],
    },
  ])
    assert.throws(() => parsePosterDocument(JSON.stringify(invalid)));
});

test("missing block ids normalize consistently while duplicate ids are rejected", () => {
  const input = document();
  delete input.sections[0].blocks[0].id;
  const parsed = parsePosterDocument(JSON.stringify(input));
  assert.equal(parsed.sections[0].blocks[0].id, "section-0-block-0");
  input.sections[0].blocks.push({ id: "text-1", type: "text", text: "Duplicate" });
  assert.throws(() => parsePosterDocument(JSON.stringify(input)), /id/);
});
