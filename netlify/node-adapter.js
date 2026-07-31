import { Readable } from "node:stream";

class CapturedResponse {
  constructor() {
    this.body = [];
    this.headers = new Headers();
    this.headersSent = false;
    this.statusCode = 200;
  }

  writeHead(statusCode, headers = {}) {
    this.statusCode = statusCode;
    for (const [name, value] of Object.entries(headers)) {
      if (Array.isArray(value)) {
        for (const item of value) this.headers.append(name, String(item));
      } else if (value !== undefined) {
        this.headers.set(name, String(value));
      }
    }
    this.headersSent = true;
    return this;
  }

  end(chunk) {
    if (chunk !== undefined && chunk !== null) {
      this.body.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    this.headersSent = true;
    return this;
  }

  toWebResponse({ suppressBody = false } = {}) {
    const bodyForbidden =
      suppressBody || [204, 205, 304].includes(this.statusCode);
    return new Response(bodyForbidden ? null : Buffer.concat(this.body), {
      status: this.statusCode,
      headers: this.headers,
    });
  }
}

export async function invokeNodeHandler(handler, request, clientIp = "unknown") {
  const url = new URL(request.url);
  const nodeRequest = request.body
    ? Readable.fromWeb(request.body)
    : Readable.from([]);
  nodeRequest.method = request.method;
  nodeRequest.url = `${url.pathname}${url.search}`;
  nodeRequest.headers = Object.fromEntries(request.headers.entries());
  nodeRequest.headers.host ||= url.host;
  nodeRequest.socket = { remoteAddress: clientIp || "unknown" };

  const nodeResponse = new CapturedResponse();
  try {
    await handler(nodeRequest, nodeResponse);
  } finally {
    if (!nodeRequest.destroyed) nodeRequest.destroy();
  }
  return nodeResponse.toWebResponse({ suppressBody: request.method === "HEAD" });
}
