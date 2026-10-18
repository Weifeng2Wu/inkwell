import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { digest } from "../src/library.mjs";
import { modelCapabilityScope, resolveModelCapabilities } from "../src/model-capabilities.mjs";
import { JsonlDecoder } from "../src/protocol.mjs";

const source = JSON.parse(
  await readFile(new URL("../runtime-source.json", import.meta.url), "utf8"),
);
const sdk = path.join(
  process.env.INKWELL_AGENT_RUNTIME_ROOT ??
    path.join(
      fileURLToPath(new URL("../../../.cache/agent-runtime/", import.meta.url)),
      `${source.revision}-${process.platform}-${process.arch}`,
    ),
  "packages/coding-agent/dist/index.js",
);

test("real runtime: lazy skills, tool loop, edit approval, isolated resume, cancellation", {
  skip: !existsSync(sdk) && "Run agent:setup to build the pinned runtime first.",
  timeout: 180_000,
}, async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inkwell-integration-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const project = path.join(directory, "project");
  const data = path.join(directory, "data");
  await mkdir(project);
  await mkdir(path.join(data, "credentials"), { recursive: true });
  await mkdir(path.join(data, "skills/fixture"), { recursive: true });
  await writeFile(path.join(project, "paper.tex"), "Original");
  const instruction = "INSTRUCTION_BODY_ONLY_ON_DEMAND";
  const resource = "RESOURCE_BODY_ONLY_ON_DEMAND";
  await writeFile(path.join(data, "skills/fixture/SKILL.md"), instruction);
  await writeFile(path.join(data, "skills/fixture/reference.md"), resource);
  await writeFile(
    path.join(data, "skills/registry.json"),
    JSON.stringify({
      schemaVersion: 1,
      skills: [
        {
          id: "fixture",
          name: "Fixture",
          description: "Metadata visible before loading",
          version: "1",
          source: "Test fixture only",
          entrypoint: { path: "SKILL.md", sha256: digest(instruction) },
          resources: [{ path: "reference.md", sha256: digest(resource) }],
        },
      ],
    }),
  );
  const requests = [];
  const utilityRequests = [];
  let hangNext = false;
  let notifyHangingRequest;
  const scriptedCalls = [
    { name: "load_skill", arguments: { id: "fixture" } },
    { name: "read_skill_resource", arguments: { id: "fixture", path: "reference.md" } },
    { name: "read", arguments: { path: "paper.tex" } },
    {
      name: "edit",
      arguments: { path: "paper.tex", edits: [{ oldText: "Original", newText: "Revised" }] },
    },
    {
      name: "write_poster",
      arguments: {
        path: "posters/result.poster.json",
        content: JSON.stringify({
          version: 1,
          title: "Poster",
          style: "classic",
          width: 841,
          height: 1189,
          background: "#ffffff",
          elements: [],
        }),
      },
    },
  ];
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ data: [{ id: "fixture" }] }));
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    const index = requests.length;
    const systemText = JSON.stringify(
      payload.messages.filter((message) => message.role === "system"),
    );
    const isUtility =
      systemText.includes("You generate Git commit messages") ||
      systemText.includes("Reply only OK.");
    if (isUtility) utilityRequests.push(payload);
    else requests.push(payload);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    if (hangNext) {
      hangNext = false;
      response.flushHeaders();
      notifyHangingRequest();
      return;
    }
    const call = isUtility ? undefined : scriptedCalls[index];
    const delta = call
      ? {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `call_${index}`,
              type: "function",
              function: { name: call.name, arguments: JSON.stringify(call.arguments) },
            },
          ],
        }
      : { role: "assistant", content: isUtility ? "Update manuscript" : "Completed fixture task." };
    const chunk = (dataChunk) =>
      `data: ${JSON.stringify({ id: `mock_${index}`, object: "chat.completion.chunk", created: 1, model: "fixture", ...dataChunk })}\n\n`;
    response.write(chunk({ choices: [{ index: 0, delta, finish_reason: null }] }));
    response.write(
      chunk({
        choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      }),
    );
    response.end("data: [DONE]\n\n");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.equal(typeof address, "object");
  await writeFile(
    path.join(data, "credentials/models.json"),
    JSON.stringify({
      providers: {
        fixture: {
          api: "openai-completions",
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          models: [
            {
              id: "fixture",
              name: "Fixture",
              reasoning: false,
              input: ["text"],
              contextWindow: 100000,
              maxTokens: 4096,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
      },
    }),
  );
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../src/bridge.mjs", import.meta.url)), project, data, sdk],
    {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, INKWELL_AGENT_AUTH_DIR: path.join(data, "credentials") },
    },
  );
  let diagnostics = "";
  child.stderr.on("data", (chunk) => {
    diagnostics += chunk;
  });
  context.after(() => {
    child.stdin.end();
    child.kill();
  });
  const pending = new Map();
  const events = [];
  const write = (command) => child.stdin.write(`${JSON.stringify(command)}\n`);
  const decoder = new JsonlDecoder((event) => {
    events.push(event);
    if (event.type === "response") {
      const waiting = pending.get(event.id);
      if (waiting) {
        clearTimeout(waiting.timer);
        pending.delete(event.id);
        if (event.ok) waiting.resolve(event.result);
        else waiting.reject(new Error(event.error));
      }
    } else if (event.type === "permission_request") {
      if (event.path.endsWith(".poster.json")) {
        assert.equal(event.before, null);
        assert.equal(JSON.parse(event.after).version, 1);
      } else {
        assert.equal(event.before, "Original");
        assert.equal(event.after, "Revised");
      }
      write({ id: "permission-fixture", type: "permission", permissionId: event.id, allow: true });
    } else if (event.type === "fatal") {
      for (const waiting of pending.values()) {
        clearTimeout(waiting.timer);
        waiting.reject(new Error(event.error));
      }
      pending.clear();
    }
  });
  child.stdout.on("data", (chunk) => decoder.push(chunk));
  let counter = 0;
  function command(type, payload = {}) {
    const id = `request-${++counter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out: ${type}. ${diagnostics}`));
      }, 60_000);
      pending.set(id, { resolve, reject, timer });
      write({ ...payload, type, id });
    });
  }
  assert.equal((await command("catalog")).skills.length, 1);
  const configuration = {
    provider: "fixture",
    model: "fixture",
    apiKey: "dummy-in-memory-key",
    allowRead: true,
    allowEdits: true,
    skillIds: ["fixture"],
    personalPrompt: "Prefer concise replies and preserve LaTeX commands.",
    answerLanguage: "ko",
  };
  const sharedConfiguration = {
    ...configuration,
    protocol: "openai",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
  };
  const connection = await command("test_connection", sharedConfiguration);
  const discovery = await command("list_models", { ...sharedConfiguration, model: "" });
  assert.deepEqual(discovery.models, ["fixture"]);
  assert.equal(discovery.capabilities.fixture.vision.supported, false);
  assert.equal(discovery.capabilities.fixture.vision.source, "catalog");
  assert.equal(connection.model, "fixture");
  assert.equal(connection.provider, "inkwell-custom");
  const gitDraft = await command("git_commit", {
    ...sharedConfiguration,
    text: "Generate a commit message from this diff: +example",
  });
  assert.equal(gitDraft.text, "Update manuscript");
  assert.equal(utilityRequests.length, 2);
  assert.ok(JSON.stringify(utilityRequests[1].messages).includes(configuration.personalPrompt));
  assert.match(JSON.stringify(utilityRequests[1].messages), /Respond in Korean\./);
  assert.equal(utilityRequests[1].model, "fixture");
  assert.ok(!utilityRequests[1].tools?.length);
  await assert.rejects(
    command("prompt", { text: "No chat session exists yet." }),
    /Configure an idle session/,
  );
  const imported = await command("skill_import", { sourcePath: path.join(data, "skills/fixture") });
  const uploaded = imported.market.find((skill) => skill.id.startsWith("upload-"));
  assert.ok(uploaded);
  const preview = await command("skill_preview", { skillId: uploaded.id });
  assert.equal(preview.instructions, instruction);
  const removed = await command("market_change", { skillId: uploaded.id, install: false });
  assert.ok(!removed.skills.some((skill) => skill.id === uploaded.id));
  const unlistedModel = { ...sharedConfiguration, model: "unlisted-vision-model" };
  const declaredCapabilities = resolveModelCapabilities(unlistedModel);
  declaredCapabilities.vision = { supported: true, source: "manual" };
  const multimodalSession = await command("configure", {
    ...unlistedModel,
    modelCapabilities: { [modelCapabilityScope(unlistedModel)]: declaredCapabilities },
  });
  assert.equal(multimodalSession.supportsImages, true);
  const searchSession = await command("configure", {
    ...configuration,
    webSearch: { baseUrl: "https://api.tavily.com" },
    webSearchApiKey: "fixture-search-key",
  });
  assert.equal(searchSession.supportsWebSearch, true);
  assert.ok(searchSession.tools.includes("web_search"));
  await assert.rejects(command("test_web_search", {
    webSearch: { baseUrl: "http://invalid.example" },
    webSearchApiKey: "fixture-search-key",
  }), /HTTPS/);
  const session = await command("configure", configuration);
  assert.equal(session.supportsWebSearch, false);
  assert.equal(session.supportsImages, false);
  assert.deepEqual(
    new Set(session.tools),
    new Set(["read", "write_poster", "edit", "load_skill", "read_skill_resource"]),
  );
  const result = await command("prompt", { text: "Run the test workflow." });
  assert.equal(result.text, "Completed fixture task.");
  assert.equal(await readFile(path.join(project, "paper.tex"), "utf8"), "Revised");
  assert.equal(requests.length, 6);
  assert.equal(
    JSON.parse(await readFile(path.join(project, "posters/result.poster.json"), "utf8")).title,
    "Poster",
  );
  const initial = JSON.stringify(requests[0].messages);
  assert.match(initial, /Respond in Korean\./);
  assert.match(initial, /Inkwell has no right-side Artifacts panel/);
  assert.match(initial, /Always tell the user the exact relative path/);
  assert.match(initial, /Metadata visible before loading/);
  assert.ok(
    requests[0].messages.some(
      (message) =>
        message.role === "system" &&
        JSON.stringify(message.content).includes(configuration.personalPrompt),
    ),
  );
  assert.ok(!initial.includes(instruction));
  assert.ok(!initial.includes(resource));
  assert.ok(JSON.stringify(requests[1].messages).includes(instruction));
  assert.ok(!JSON.stringify(requests[1].messages).includes(resource));
  assert.ok(JSON.stringify(requests[2].messages).includes(resource));
  assert.ok(events.some((event) => event.type === "text_delta"));
  assert.ok(events.some((event) => event.type === "permission_request"));
  const historyList = await command("history_list");
  const savedConversation = historyList.sessions.find(
    (item) => item.sessionId === session.sessionId,
  );
  assert.ok(savedConversation);
  const previewedConversation = await command("history_read", {
    sessionKey: savedConversation.key,
  });
  assert.ok(
    previewedConversation.messages.some((message) => message.content.includes("Completed fixture")),
  );
  await command("history_rename", {
    sessionKey: savedConversation.key,
    title: "Manuscript discussion",
  });
  const renamedHistory = await command("history_list");
  assert.equal(
    renamedHistory.sessions.find((item) => item.sessionId === session.sessionId).title,
    "Manuscript discussion",
  );
  const selectedConversation = await command("configure", {
    ...configuration,
    sessionKey: savedConversation.key,
  });
  assert.equal(selectedConversation.sessionId, session.sessionId);
  await assert.rejects(
    command("configure", {
      ...configuration,
      answerLanguage: "en",
      sessionKey: savedConversation.key,
    }),
    /incompatible/,
  );
  await assert.rejects(
    command("configure", { ...configuration, skillIds: [], sessionKey: savedConversation.key }),
    /incompatible/,
  );
  await assert.rejects(
    command("history_read", { sessionKey: "../../outside.jsonl" }),
    /Invalid history key/,
  );
  const resumed = await command("configure", { ...configuration, resume: true });
  assert.equal(resumed.sessionId, session.sessionId);
  assert.ok(resumed.messages.some((message) => message.content.includes("Completed fixture")));
  const afterChatDraft = await command("git_commit", {
    ...sharedConfiguration,
    text: "Generate another commit message.",
  });
  assert.equal(afterChatDraft.text, "Update manuscript");
  const afterGitResume = await command("configure", { ...configuration, resume: true });
  assert.equal(afterGitResume.sessionId, session.sessionId);
  assert.deepEqual(afterGitResume.messages, resumed.messages);
  const isolated = await command("configure", {
    ...configuration,
    skillIds: [],
    allowRead: false,
    allowEdits: false,
    resume: true,
  });
  assert.notEqual(isolated.sessionId, session.sessionId);
  assert.deepEqual(isolated.messages, []);
  assert.deepEqual(isolated.tools, []);
  const blankConfiguration = {
    ...configuration,
    personalPrompt: "",
    skillIds: [],
    allowRead: false,
    allowEdits: false,
  };
  const blankSession = await command("configure", blankConfiguration);
  await command("prompt", { text: "Check default preferences." });
  const blankRequest = requests.at(-1);
  assert.ok(!JSON.stringify(blankRequest.messages).includes("Personal preferences ("));
  const legacyConfiguration = { ...blankConfiguration };
  delete legacyConfiguration.personalPrompt;
  const legacySession = await command("configure", { ...legacyConfiguration, resume: true });
  assert.equal(legacySession.sessionId, blankSession.sessionId);
  const whitespaceSession = await command("configure", {
    ...blankConfiguration,
    personalPrompt: " \n ",
    resume: true,
  });
  assert.equal(whitespaceSession.sessionId, blankSession.sessionId);
  for (const invalidPrompt of [123, null, "x".repeat(16_385)]) {
    await assert.rejects(
      command("configure", { ...blankConfiguration, personalPrompt: invalidPrompt }),
      /Personal preference prompt/,
    );
  }
  await assert.rejects(
    command("configure", { ...configuration, skillIds: ["not-enabled"] }),
    /Unknown skill/,
  );
  const restricted = await command("configure", {
    ...configuration,
    permissionMode: "restricted",
    skillIds: [],
  });
  assert.deepEqual(restricted.tools, ["read"]);
  const automatic = await command("configure", {
    ...configuration,
    permissionMode: "auto",
    skillIds: [],
  });
  assert.deepEqual(new Set(automatic.tools), new Set(["read", "write_poster", "edit"]));
  const asking = await command("configure", {
    ...configuration,
    permissionMode: "ask",
    skillIds: [],
  });
  assert.notEqual(asking.sessionId, automatic.sessionId);
  assert.notEqual(asking.sessionId, restricted.sessionId);
  await assert.rejects(
    command("configure", {
      ...configuration,
      permissionMode: "invalid",
    }),
    /Invalid permission/,
  );
  await assert.rejects(
    command("configure", {
      ...configuration,
      permissionMode: "auto",
      sessionKey: savedConversation.key,
    }),
    /incompatible/,
  );
  const changedPreferences = await command("configure", {
    ...blankConfiguration,
    personalPrompt: "Reply in Chinese.",
    resume: true,
  });
  assert.notEqual(changedPreferences.sessionId, blankSession.sessionId);
  hangNext = true;
  const receivedHangingRequest = new Promise((resolve) => {
    notifyHangingRequest = resolve;
  });
  const interrupted = command("prompt", { text: "This request will be cancelled." }).then(
    () => {
      throw new Error("Expected active generation to be aborted.");
    },
    (error) => error,
  );
  await receivedHangingRequest;
  await command("abort");
  assert.match((await interrupted).message, /abort/i);
  hangNext = true;
  const receivedGitRequest = new Promise((resolve) => {
    notifyHangingRequest = resolve;
  });
  const cancelledGit = command("git_commit", {
    ...sharedConfiguration,
    text: "Draft a commit message.",
  }).then(
    () => {
      throw new Error("Expected Git generation to be cancelled.");
    },
    (error) => error,
  );
  await receivedGitRequest;
  await assert.rejects(command("configure", configuration), /active operation/);
  await command("abort");
  assert.match((await cancelledGit).message, /abort/i);
  const deletedHistory = await command("history_delete", { sessionKey: savedConversation.key });
  assert.equal(deletedHistory.deletedCurrent, false);
  assert.ok(!deletedHistory.sessions.some((item) => item.sessionId === session.sessionId));
  const activeHistory = deletedHistory.sessions.find(
    (item) => item.sessionId === changedPreferences.sessionId,
  );
  assert.ok(activeHistory);
  const deletedActive = await command("history_delete", { sessionKey: activeHistory.key });
  assert.equal(deletedActive.deletedCurrent, true);
  await assert.rejects(
    command("prompt", { text: "Deleted session must not be reused." }),
    /Configure an idle session/,
  );
  assert.ok(!JSON.stringify(requests.at(-1).messages).includes(instruction));
  assert.ok(!diagnostics.includes("dummy-in-memory-key"));
  for (const filename of await readdir(data, { recursive: true })) {
    if (/\.jsonl?$/.test(filename))
      assert.ok(
        !(await readFile(path.join(data, filename), "utf8")).includes("dummy-in-memory-key"),
      );
  }
});
