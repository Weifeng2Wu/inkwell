import assert from "node:assert/strict";
import { link, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { ProjectPolicy } from "../src/policy.mjs";

const directories = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(approve = async () => {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inkwell-policy-"));
  directories.push(directory);
  await writeFile(path.join(directory, "paper.tex"), "Original");
  return { directory, policy: new ProjectPolicy(directory, approve) };
}

test("reads manuscript files but rejects hidden, executable and outside files", async () => {
  const { directory, policy } = await fixture();
  assert.equal((await policy.read("paper.tex")).toString(), "Original");
  for (const filename of [
    ".env",
    ".private.tex",
    "script.sh",
    "../outside.tex",
    `${directory}-other/paper.tex`,
  ]) {
    await assert.rejects(policy.read(filename));
  }
});

test("denying an edit never writes it", async () => {
  const { directory, policy } = await fixture(async () => {
    throw new Error("denied");
  });
  await assert.rejects(policy.edit("paper.tex", "Replacement"), /denied/);
  assert.equal(await readFile(path.join(directory, "paper.tex"), "utf8"), "Original");
});

test("restricted mode allows reads but rejects edits before approval", async () => {
  const { directory } = await fixture();
  const policy = new ProjectPolicy(
    directory,
    async () => assert.fail("Must not ask"),
    "restricted",
  );
  assert.equal((await policy.read("paper.tex")).toString(), "Original");
  await assert.rejects(policy.edit("paper.tex", "Replacement"), /disabled/);
  assert.equal(await readFile(path.join(directory, "paper.tex"), "utf8"), "Original");
});

test("auto mode applies edits without asking and retains path and cancellation checks", async () => {
  const { directory } = await fixture();
  const policy = new ProjectPolicy(directory, async () => assert.fail("Must not ask"), "auto");
  await policy.edit("paper.tex", "Automatic");
  assert.equal(await readFile(path.join(directory, "paper.tex"), "utf8"), "Automatic");
  await assert.rejects(policy.edit("../outside.tex", "Unsafe"));
  await assert.rejects(policy.edit("paper.tex", "Cancelled", AbortSignal.abort()));
  assert.equal(await readFile(path.join(directory, "paper.tex"), "utf8"), "Automatic");
});

test("invalid permission modes fail closed", () => {
  assert.throws(
    () => new ProjectPolicy("/project", async () => {}, "invalid"),
    /Invalid permission/,
  );
});

test("approval sees the exact before/after, and approved edits apply", async () => {
  let proposal;
  const { directory, policy } = await fixture(async (change) => {
    proposal = change;
  });
  await policy.edit("paper.tex", "Replacement");
  assert.deepEqual(proposal, { path: "paper.tex", before: "Original", after: "Replacement" });
  assert.equal(await readFile(path.join(directory, "paper.tex"), "utf8"), "Replacement");
});

test("concurrent human edits are not overwritten", async () => {
  const { directory } = await fixture();
  const policy = new ProjectPolicy(directory, async () => {
    await writeFile(path.join(directory, "paper.tex"), "Human edit");
  });
  await assert.rejects(policy.edit("paper.tex", "Agent edit"), /changed/);
  assert.equal(await readFile(path.join(directory, "paper.tex"), "utf8"), "Human edit");
});

test("symlinks and hard links are rejected", async () => {
  const { directory, policy } = await fixture();
  await symlink(path.join(directory, "paper.tex"), path.join(directory, "symlink.tex"));
  await assert.rejects(policy.read("symlink.tex"), /Symlinks/);
  await link(path.join(directory, "paper.tex"), path.join(directory, "hardlink.tex"));
  await assert.rejects(policy.read("hardlink.tex"), /hard-linked/);
});

test("an aborted approval does not write", async () => {
  const controller = new AbortController();
  const { directory, policy } = await fixture(async () => controller.abort());
  await assert.rejects(policy.edit("paper.tex", "Replacement", controller.signal));
  assert.equal(await readFile(path.join(directory, "paper.tex"), "utf8"), "Original");
});
