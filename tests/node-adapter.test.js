import assert from "node:assert/strict";
import test from "node:test";
import { createNetlifyApiHandler } from "../netlify/functions/api.mjs";
import { invokeNodeHandler } from "../netlify/node-adapter.js";
import { TransactionalFakePool } from "./transactional-fake-pool.js";

test("node adapter streams request chunks into the Node handler", async () => {
  const expected = ["first", "second", "third"];
  let index = 0;
  let handlerStarted = false;
  let chunksProducedBeforeHandler = 0;
  const request = new Request("https://baynat.example/api/chunks", {
    method: "POST",
    duplex: "half",
    body: new ReadableStream({
      pull(controller) {
        if (index === expected.length) {
          controller.close();
          return;
        }
        if (!handlerStarted) chunksProducedBeforeHandler += 1;
        controller.enqueue(new TextEncoder().encode(expected[index++]));
      },
    }),
  });
  const observed = [];
  const response = await invokeNodeHandler(async (nodeRequest, nodeResponse) => {
    handlerStarted = true;
    for await (const chunk of nodeRequest) observed.push(chunk.toString());
    nodeResponse.writeHead(200);
    nodeResponse.end();
  }, request);

  assert.equal(response.status, 200);
  assert.equal(observed.join(""), expected.join(""));
  assert.ok(chunksProducedBeforeHandler < expected.length);
});

test("node adapter lets Baynat reject an oversized body before consuming it all", async () => {
  const pool = new TransactionalFakePool();
  const handler = createNetlifyApiHandler({
    environment: { BAYNAT_SETUP_KEY: "adapter-setup-key-123" },
    getDatabaseClient: () => ({ driver: "fake", pool }),
    logger: { error() {} },
    serverOptions: {
      accessDifficultyBits: 8,
      supervisorDifficultyBits: 8,
      nodeEnvironment: "test",
    },
  });
  const totalChunks = 512;
  let producedChunks = 0;
  const request = new Request("https://baynat.example/api/admin/setup", {
    method: "POST",
    duplex: "half",
    headers: { "Content-Type": "application/json" },
    body: new ReadableStream({
      pull(controller) {
        if (producedChunks === totalChunks) {
          controller.close();
          return;
        }
        producedChunks += 1;
        controller.enqueue(new Uint8Array(1024));
      },
    }),
  });

  const response = await handler(request, {
    ip: "203.0.113.10",
  });
  const payload = await response.json();
  assert.equal(response.status, 413);
  assert.equal(payload.error.code, "PAYLOAD_TOO_LARGE");
  assert.ok(producedChunks < totalChunks);
});

test("node adapter omits response bodies for HEAD requests", async () => {
  const response = await invokeNodeHandler(
    async (_request, nodeResponse) => {
      nodeResponse.writeHead(200, {
        "Content-Length": "5",
        "Content-Type": "text/plain",
      });
      nodeResponse.end("hello");
    },
    new Request("https://baynat.example/", { method: "HEAD" })
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), "5");
  assert.equal(await response.text(), "");
});
