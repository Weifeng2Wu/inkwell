import { customHeaderSecrets } from "./custom-headers.mjs";
import { pathToFileURL } from "node:url";
import { createModelRuntime, listModels, resolveModel } from "./model.mjs";
import { createWebSearchTool } from "./web-search.mjs";

console.log = (...values) => console.error(...values);
console.info = (...values) => console.error(...values);

// One process per request keeps connectivity checks independent of chat and
// one another. Credentials arrive on stdin and are never command arguments.
let headerSecrets = [];
async function main() {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    input += chunk.toString("utf8");
    if (Buffer.byteLength(input) > 2 * 1024 * 1024) throw new Error("API check request is too large.");
  }
  const request = JSON.parse(input);
  headerSecrets = customHeaderSecrets(request);
  const signal = AbortSignal.timeout(30_000);
  if (request.type === "test_web_search") {
    const tool = createWebSearchTool(request.webSearch, request.webSearchApiKey);
    if (!tool) throw new Error("A web search API key is required.");
    await tool.execute("test", { query: "Inkwell academic writing", maxResults: 1 }, signal);
    return { ok: true };
  }
  const sdk = await import(pathToFileURL(process.argv[2]).href);
  const directory = process.argv[3];
  if (request.type === "list_models") {
    const runtime = await createModelRuntime(sdk, directory, signal);
    return listModels(request, signal, runtime.getModels());
  }
  if (request.type !== "test_connection") throw new Error("Unsupported API check.");
  const { runtime, model } = await resolveModel(sdk, request, directory, signal);
  const response = await runtime.completeSimple(model, {
    systemPrompt: "Reply only OK.",
    messages: [{ role: "user", content: "Reply OK to confirm connectivity.", timestamp: Date.now() }],
  }, { signal, maxTokens: 32 });
  if (["error", "aborted"].includes(response.stopReason))
    throw new Error(response.errorMessage || "Model connection test failed.");
  if (!response.content.some((part) => part.type === "text" && part.text.trim()))
    throw new Error("The model returned no text.");
  return { ok: true };
}

// The host supplies a separate stderr channel, but errors can contain provider
// responses. Return them through a JSON envelope for host-side redaction.
try {
  const result = await main();
  process.stdout.write(JSON.stringify({ ok: true, result }));
} catch (error) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of headerSecrets) message = message.replaceAll(secret, "[redacted]");
  process.stdout.write(JSON.stringify({ ok: false, error: message }));
  process.exitCode = 1;
}
