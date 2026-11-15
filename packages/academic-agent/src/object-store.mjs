import { createHash, createHmac } from "node:crypto";

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const hmac = (key, value) => createHmac("sha256", key).update(value).digest();
const encode = (value) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

async function readBounded(response, maximum) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maximum) throw new Error("CLOUD_SIZE_LIMIT");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function validateCloudConfig(value) {
  if (!value || !["s3", "r2"].includes(value.provider)) throw new Error("CLOUD_CONFIG");
  let endpoint;
  try {
    endpoint = new URL(value.endpoint);
  } catch {
    throw new Error("CLOUD_CONFIG");
  }
  if (
    (endpoint.protocol !== "https:" &&
      !(
        endpoint.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)
      )) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/" ||
    typeof value.bucket !== "string" ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value.bucket) ||
    value.bucket.includes("..") ||
    typeof value.prefix !== "string" ||
    value.prefix.length > 200 ||
    !/^[a-zA-Z0-9/_-]+$/.test(value.prefix) ||
    ![5, 15, 30, 60, 120].includes(value.intervalMinutes) ||
    typeof value.enabled !== "boolean"
  )
    throw new Error("CLOUD_CONFIG");
  const region = value.provider === "r2" ? "auto" : value.region;
  if (typeof region !== "string" || !/^[a-z0-9-]{1,64}$/.test(region))
    throw new Error("CLOUD_CONFIG");
  const prefix = value.prefix.replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
  if (!prefix) throw new Error("CLOUD_CONFIG");
  return {
    provider: value.provider,
    endpoint: endpoint.origin,
    bucket: value.bucket,
    prefix,
    region,
    enabled: value.enabled,
    intervalMinutes: value.intervalMinutes,
  };
}

export function signedHeaders({
  url,
  method,
  payloadHash,
  credentials,
  region,
  now = new Date(),
  headers = {},
}) {
  const timestamp = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = timestamp.slice(0, 8);
  const signed = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": timestamp,
    ...headers,
    ...(credentials.sessionToken ? { "x-amz-security-token": credentials.sessionToken } : {}),
  };
  const names = Object.keys(signed).sort();
  const query = [...url.searchParams]
    .map(([key, value]) => [encode(key), encode(value)])
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey < rightKey
        ? -1
        : leftKey > rightKey
          ? 1
          : leftValue < rightValue
            ? -1
            : leftValue > rightValue
              ? 1
              : 0,
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const canonical = [
    method,
    url.pathname,
    query,
    names.map((name) => `${name}:${String(signed[name]).trim().replace(/\s+/g, " ")}\n`).join(""),
    names.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${date}/${region}/s3/aws4_request`;
  const key = hmac(
    hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, date), region), "s3"),
    "aws4_request",
  );
  const signature = hmac(
    key,
    `AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${sha256(canonical)}`,
  ).toString("hex");
  return {
    ...signed,
    authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
  };
}

export class ObjectStore {
  constructor(config, credentials) {
    this.config = validateCloudConfig(config);
    this.credentials = credentials;
  }
  async request(
    method,
    key = "",
    { body, payloadHash = sha256(body ?? ""), size, query = {}, allowMissing = false } = {},
  ) {
    const url = new URL(this.config.endpoint);
    url.pathname = `/${encode(this.config.bucket)}/${key.split("/").map(encode).join("/")}`;
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    let response;
    try {
      response = await fetch(url, {
        method,
        body,
        ...(body && typeof body !== "string" && !Buffer.isBuffer(body) ? { duplex: "half" } : {}),
        headers: signedHeaders({
          url,
          method,
          payloadHash,
          credentials: this.credentials,
          region: this.config.region,
          headers: size === undefined ? {} : { "content-length": String(size) },
        }),
        redirect: "manual",
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new Error("CLOUD_NETWORK");
    }
    if (allowMissing && response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`CLOUD_HTTP:${response.status}`);
    }
    return response;
  }
  async put(key, body, payloadHash, size) {
    const response = await this.request("PUT", key, { body, payloadHash, size });
    await response.body?.cancel();
  }
  async has(key) {
    return Boolean(await this.request("HEAD", key, { allowMissing: true }));
  }
  async get(key, maximum = 16 * 1024 * 1024) {
    const response = await this.request("GET", key);
    return readBounded(response, maximum);
  }
  async list(prefix) {
    const keys = [];
    const tokens = new Set();
    let token;
    const decode = (value) =>
      value.replace(
        /&(?:amp|lt|gt|quot|apos);/g,
        (entity) =>
          ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" })[entity],
      );
    do {
      const response = await this.request("GET", "", {
        query: {
          "list-type": "2",
          prefix,
          "max-keys": "1000",
          ...(token ? { "continuation-token": token } : {}),
        },
      });
      const text = (await readBounded(response, 4 * 1024 * 1024)).toString("utf8");
      if (!/<ListBucketResult(?:\s[^>]*)?>/.test(text) || /<!DOCTYPE|<!ENTITY/i.test(text))
        throw new Error("CLOUD_RESPONSE");
      for (const match of text.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(decode(match[1]));
      const next = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(text)?.[1];
      if (/<IsTruncated>true<\/IsTruncated>/.test(text) && (!next || next === token))
        throw new Error("CLOUD_RESPONSE");
      token = /<IsTruncated>true<\/IsTruncated>/.test(text) ? decode(next) : undefined;
      if (token && tokens.has(token)) throw new Error("CLOUD_RESPONSE");
      if (token) tokens.add(token);
      if (tokens.size > 100) throw new Error("CLOUD_SIZE_LIMIT");
      if (keys.length > 20_000) throw new Error("CLOUD_SIZE_LIMIT");
    } while (token);
    return keys;
  }
}
