/** Parse one `Header-Name: value` per line. Values may contain colons. */
export function parseCustomHeaders(value) {
  if (value === undefined || value === "") return {};
  if (typeof value !== "string" || value.length > 32768)
    throw new Error("Custom headers must be text of at most 32768 characters.");
  const headers = new Headers();
  for (const line of value.split("\n")) {
    if (!line.trim()) continue;
    const colon = line.indexOf(":");
    const name = line.slice(0, colon).trim();
    const content = line.slice(colon + 1).trim();
    if (
      colon < 1 ||
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
      /[\r\x00-\x1f\x7f]/.test(content)
    )
      throw new Error("Invalid custom header. Use one Header-Name: value per line.");
    try {
      headers.set(name, content);
    } catch {
      throw new Error("Invalid custom header name or value.");
    }
  }
  return Object.fromEntries(headers);
}

export function mergeCustomHeaders(defaults, value) {
  const headers = { ...defaults };
  for (const [name, content] of Object.entries(parseCustomHeaders(value))) {
    for (const existing of Object.keys(headers)) {
      if (existing.toLowerCase() === name) delete headers[existing];
    }
    headers[name] = content;
  }
  return headers;
}

export function customHeaderSecrets(config) {
  return [config, config?.imageGeneration, config?.webSearch, config?.config]
    .flatMap((entry) => {
      try {
        return Object.values(parseCustomHeaders(entry?.customHeaders));
      } catch {
        return [];
      }
    })
    .filter(Boolean);
}
