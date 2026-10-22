import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function generateUpdateManifest({
  directory,
  version,
  repository,
  tag = `v${version}`,
  notes = "",
  pubDate = new Date().toISOString(),
}) {
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error("Invalid update version");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Invalid release repository");
  const platforms = {};
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const filename = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        await visit(filename);
        continue;
      }
      if (!entry.name.endsWith(".sig")) continue;
      const asset = filename.slice(0, -4);
      const name = path.basename(asset);
      let platform;
      if (name.endsWith(".app.tar.gz")) {
        if (name.includes("aarch64")) platform = "darwin-aarch64";
        else if (name.includes("x64") || name.includes("x86_64")) platform = "darwin-x86_64";
      } else if (name.endsWith(".exe") && name.includes("x64")) platform = "windows-x86_64";
      else if (name.endsWith(".AppImage") && (name.includes("amd64") || name.includes("x86_64")))
        platform = "linux-x86_64";
      if (!platform) throw new Error(`Unsupported signed update artifact: ${name}`);
      await readFile(asset); // A signature must have a corresponding package.
      const signature = (await readFile(filename, "utf8")).trim();
      if (!signature) throw new Error(`Empty signature: ${name}`);
      if (platforms[platform]) throw new Error(`Duplicate update platform: ${platform}`);
      platforms[platform] = {
        signature,
        url: `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`,
      };
    }
  }
  await visit(directory);
  for (const platform of ["darwin-aarch64", "windows-x86_64", "linux-x86_64"]) {
    if (!platforms[platform]) throw new Error(`Missing signed update: ${platform}`);
  }
  return { version, notes, pub_date: pubDate, platforms };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory, output] = process.argv.slice(2);
  const manifest = await generateUpdateManifest({
    directory,
    version: process.env.RELEASE_TAG?.replace(/^v/, ""),
    repository: process.env.GH_REPO,
    tag: process.env.RELEASE_TAG,
    notes: process.env.RELEASE_NOTES ?? "",
  });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
}
