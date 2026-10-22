import { mergeCustomHeaders, parseCustomHeaders } from "./custom-headers.mjs";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const IMAGE_EXTENSIONS = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

async function saveGeneratedImage(projectDirectory, image) {
  const root = await realpath(projectDirectory);
  const relativeDirectory = "generated-images";
  const directory = path.join(root, relativeDirectory);
  let current = root;
  for (const segment of relativeDirectory.split(path.sep)) {
    current = path.join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new Error("Generated image directory contains an unsafe path.");
      const canonical = await realpath(current);
      if (path.relative(root, canonical).startsWith(".."))
        throw new Error("Generated image directory escapes the project.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await mkdir(current);
    }
  }
  const extension = IMAGE_EXTENSIONS.get(image.mimeType);
  for (let index = 1; index <= 999; index += 1) {
    const filename = `image-${String(index).padStart(2, "0")}.${extension}`;
    const target = path.join(directory, filename);
    try {
      const handle = await open(
        target,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
        0o644,
      );
      try {
        await handle.writeFile(Buffer.from(image.data, "base64"));
        await handle.sync();
      } catch (error) {
        await handle.close();
        await unlink(target).catch(() => {});
        throw error;
      }
      await handle.close();
      return {
        path: target,
        relativePath: path.join(relativeDirectory, filename).split(path.sep).join("/"),
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  throw new Error("Could not choose a unique generated image filename.");
}

function endpoint(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 2048)
    throw new Error("Enter an image-generation Base URL in Agent settings.");
  const url = new URL(value.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Image-generation Base URL must be an HTTP(S) endpoint without credentials, query, or fragment.");
  if (
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error("Use HTTPS for remote image-generation endpoints. HTTP is allowed only for localhost.");
  return `${url.toString().replace(/\/+$/, "")}/images/generations`;
}

async function readBody(response, limit) {
  if (!response.body) throw new Error("Image-generation API returned an empty response.");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error("Image-generation response exceeds the size limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function responseImage(response, signal, apiUrl, customHeaders) {
  const body = await readBody(response, MAX_RESPONSE_BYTES);
  if (!response.ok) {
    const detail = body.toString("utf8").slice(0, 500);
    throw new Error(`Image generation failed (${response.status})${detail ? `: ${detail}` : "."}`);
  }
  let result;
  try {
    result = JSON.parse(body.toString("utf8"));
  } catch {
    throw new Error("Image-generation API returned invalid JSON.");
  }
  const item = Array.isArray(result?.data) ? result.data[0] : null;
  if (typeof item?.b64_json === "string") {
    if (
      item.b64_json.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(item.b64_json)
    )
      throw new Error("Image-generation API returned invalid or oversized image data.");
    const bytes = Buffer.from(item.b64_json, "base64");
    const mimeType = item.mime_type ?? item.mimeType ?? "image/png";
    if (bytes.length > MAX_IMAGE_BYTES || !IMAGE_TYPES.has(mimeType))
      throw new Error("Image-generation API returned an unsupported or oversized image.");
    return { type: "image", data: bytes.toString("base64"), mimeType };
  }
  if (typeof item?.url !== "string")
    throw new Error("Image-generation API returned no image.");
  let imageUrl;
  try {
    imageUrl = new URL(item.url);
  } catch {
    throw new Error("Image-generation API returned an invalid image URL.");
  }
  if (imageUrl.protocol !== "https:" || imageUrl.username || imageUrl.password)
    throw new Error("Image-generation API returned an unsafe image URL.");
  const imageResponse = await fetch(imageUrl, {
    signal,
    redirect: "error",
    headers: mergeCustomHeaders({ Accept: "image/png, image/jpeg, image/webp" },
      imageUrl.origin === new URL(apiUrl).origin ? customHeaders : undefined),
  });
  if (!imageResponse.ok) throw new Error(`Could not download generated image (${imageResponse.status}).`);
  const mimeType = imageResponse.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (!IMAGE_TYPES.has(mimeType)) throw new Error("Generated image has an unsupported format.");
  const bytes = await readBody(imageResponse, MAX_IMAGE_BYTES);
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("Generated image exceeds the size limit.");
  return { type: "image", data: bytes.toString("base64"), mimeType };
}

export function createImageGenerationTool(config, apiKey, projectDirectory, onGenerated) {
  if (!config || typeof config.model !== "string" || !config.model.trim() || !apiKey?.trim())
    return null;
  if (typeof config.model !== "string" || config.model.length > 200)
    throw new Error("Invalid image-generation model.");
  parseCustomHeaders(config.customHeaders);
  const url = endpoint(config.baseUrl);
  return {
    name: "generate_image",
    label: "Generate image",
    description:
      "Generate an image for a direct user request or an image-dependent skill. For direct user requests, omit purpose or set it to user: the image is saved in the project under generated-images/image-NN, displayed inline in chat, and its path should be reported. For an Academic Poster visual reference, set purpose to poster_reference: the image is returned to the model for review but is not saved as a project image or shown as a deliverable. Rebuild the reference as editable .poster.json content. Never treat generated text, figures, numbers, logos, or QR codes as factual.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "A detailed visual prompt based on verified source material and the poster brief.",
          minLength: 1,
          maxLength: 16_000,
        },
        purpose: {
          type: "string",
          enum: ["user", "poster_reference"],
          description:
            "Use poster_reference only for the temporary Academic Poster layout reference. Omit this field for images the user asked to create and keep.",
        },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    executionMode: "sequential",
    async execute(_callId, args, signal) {
      if (typeof args.prompt !== "string" || !args.prompt.trim() || args.prompt.length > 16_000)
        throw new Error("Enter an image-generation prompt of at most 16000 characters.");
      const purpose = args.purpose ?? "user";
      if (!["user", "poster_reference"].includes(purpose))
        throw new Error("Choose a valid image-generation purpose.");
      const timeout = AbortSignal.timeout(120_000);
      const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const response = await fetch(url, {
        method: "POST",
        signal: requestSignal,
        redirect: "error",
        headers: mergeCustomHeaders({
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        }, config.customHeaders),
        body: JSON.stringify({ model: config.model.trim(), prompt: args.prompt, n: 1, size: "1024x1536" }),
      });
      const image = await responseImage(response, requestSignal, url, config.customHeaders);
      if (purpose === "poster_reference") {
        return {
          content: [
            { type: "text", text: "Temporary visual reference generated for layout review; it was not saved as a project file." },
            image,
          ],
          details: {},
        };
      }
      const saved = await saveGeneratedImage(projectDirectory, image);
      onGenerated?.({ ...saved, mimeType: image.mimeType });
      return {
        content: [
          {
            type: "text",
            text: `Generated image saved to ${saved.relativePath}. Report this path to the user so they can find the image in the project.`,
          },
          image,
        ],
        details: {},
      };
    },
  };
}
