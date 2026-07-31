import assert from "node:assert/strict";
import { getStore } from "@netlify/blobs";
import test from "node:test";
import { NetlifyBlobStore } from "../netlify/blob-store.js";

function createSdkTransport() {
  const requests = [];
  let body = null;
  let etag = null;
  let version = 0;

  const fetch = async (input, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    const headers = new Headers(init.headers);
    requests.push({ method, headers });

    if (method === "GET") {
      return body === null
        ? new Response(null, { status: 404 })
        : new Response(body, { status: 200, headers: { etag } });
    }
    if (method !== "PUT") {
      throw new Error(`Unexpected SDK transport method: ${method}`);
    }
    if (
      (headers.get("if-none-match") === "*" && body !== null) ||
      (headers.has("if-match") && headers.get("if-match") !== etag)
    ) {
      return new Response(null, { status: 412 });
    }
    body = String(init.body);
    etag = `"sdk-contract-${++version}"`;
    return new Response(null, { status: 200, headers: { etag } });
  };

  return {
    fetch,
    requests,
    readBody: () => JSON.parse(body),
  };
}

test("NetlifyBlobStore emits CAS headers through the installed SDK transport", async () => {
  const transport = createSdkTransport();
  const blobs = getStore({
    name: "baynat-sdk-contract",
    siteID: "site-contract",
    token: "test-token",
    edgeURL: "https://blobs.test",
    uncachedEdgeURL: "https://strong.blobs.test",
    consistency: "strong",
    fetch: transport.fetch,
  });
  const store = new NetlifyBlobStore({
    blobs,
    setupKey: "contract-setup-key",
  });

  await store.init();
  await store.update((data) => {
    data.contractMutation = true;
  });

  const writes = transport.requests.filter(({ method }) => method === "PUT");
  assert.equal(writes.length, 2);
  assert.equal(writes[0].headers.get("if-none-match"), "*");
  assert.equal(writes[1].headers.get("if-match"), '"sdk-contract-1"');
  assert.equal(transport.readBody().contractMutation, true);
});
