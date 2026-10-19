import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const configuration = JSON.parse(
  await readFile(new URL("../../apps/desktop/src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);
const directives = new Map(
  configuration.app.security.csp.split(";").map((directive) => {
    const [name, ...sources] = directive.trim().split(/\s+/);
    return [name, sources];
  }),
);

test("allows PDF.js to fetch local documents using Tauri asset URLs", () => {
  assert.equal(configuration.app.security.assetProtocol.enable, true);
  const connections = directives.get("connect-src");
  for (const source of ["'self'", "asset:", "http://asset.localhost", "https://asset.localhost"])
    assert.ok(connections.includes(source), `PDF fetches require connect-src ${source}`);
  for (const source of ["*", "http:", "https:"])
    assert.ok(!connections.includes(source), `Do not broadly allow ${source}`);
});

test("allows bundled PDF.js workers and their blob URL fallback", () => {
  assert.deepEqual(directives.get("worker-src"), ["'self'", "blob:"]);
});
