import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { NetlifyBlobStore } from "../netlify/blob-store.js";
import { createNetlifyApiHandler } from "../netlify/functions/api.mjs";

class MemoryBlobs {
  constructor() {
    this.entries = new Map();
    this.version = 0;
    this.readOptions = [];
    this.conditionalConflicts = 0;
    this.beforeSet = null;
  }

  async getWithMetadata(key, options) {
    this.readOptions.push(options);
    const entry = this.entries.get(key);
    return entry
      ? {
          data: structuredClone(entry.data),
          etag: entry.etag,
          metadata: {},
        }
      : null;
  }

  async set(key, value, options = {}) {
    const data = JSON.parse(value);
    await this.beforeSet?.({ key, data: structuredClone(data), options });
    const current = this.entries.get(key);
    if (
      (options.onlyIfNew && current) ||
      (options.onlyIfMatch && current?.etag !== options.onlyIfMatch)
    ) {
      this.conditionalConflicts += 1;
      return { modified: false };
    }
    const etag = `"memory-${++this.version}"`;
    this.entries.set(key, { data: structuredClone(data), etag });
    return { modified: true, etag };
  }
}

function hasLeadingZeroBits(bytes, difficultyBits) {
  let remaining = difficultyBits;
  for (const byte of bytes) {
    if (remaining >= 8) {
      if (byte !== 0) return false;
      remaining -= 8;
      continue;
    }
    if (remaining === 0) return true;
    return (byte >>> (8 - remaining)) === 0;
  }
  return remaining === 0;
}

function solveChallenge(token, difficultyBits) {
  for (let counter = 0; counter < Number.MAX_SAFE_INTEGER; counter += 1) {
    const digest = createHash("sha256").update(`${token}.${counter}`).digest();
    if (hasLeadingZeroBits(digest, difficultyBits)) return counter;
  }
  throw new Error("Challenge could not be solved.");
}

async function api(
  handler,
  pathname,
  {
    method = "GET",
    token,
    bearer,
    body,
    runtimeContext = {
      deploy: { context: "production", id: "507f1f77bcf86cd799439010" },
    },
  } = {}
) {
  const headers = new Headers();
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (token) headers.set("X-Supervisor-Token", token);
  if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
  const response = await handler(
    new Request(`https://baynat.example${pathname}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    { ip: "203.0.113.10", ...runtimeContext }
  );
  return { response, payload: await response.json() };
}

function createHandler(blobs) {
  return createNetlifyApiHandler({
    environment: {
      BAYNAT_SETUP_KEY: "netlify-setup-key-123",
      BAYNAT_BLOB_STORE: "baynat-tests",
    },
    getBlobStore: () => blobs,
    logger: { error() {} },
    serverOptions: {
      accessDifficultyBits: 8,
      supervisorDifficultyBits: 8,
      nodeEnvironment: "test",
    },
  });
}

test("Netlify Blobs store uses strong reads and CAS retries without lost updates", async () => {
  const blobs = new MemoryBlobs();
  await Promise.all(
    Array.from({ length: 80 }, async () => {
      const store = new NetlifyBlobStore({
        blobs,
        setupKey: "netlify-setup-key-123",
      });
      await store.init();
      await store.update((data) => {
        data.testMutationCount = (data.testMutationCount || 0) + 1;
      });
    })
  );

  const restarted = new NetlifyBlobStore({
    blobs,
    setupKey: "netlify-setup-key-123",
  });
  await restarted.init();
  assert.equal(restarted.data.testMutationCount, 80);
  assert.ok(blobs.conditionalConflicts > 0);
  assert.ok(
    blobs.readOptions.every(
      (options) => options.consistency === "strong" && options.type === "json"
    )
  );
});

test("Netlify Blobs CAS retries use bounded backoff and a deadline", async () => {
  let writes = 0;
  let now = 0;
  const waits = [];
  const blobs = {
    async getWithMetadata() {
      return null;
    },
    async set() {
      writes += 1;
      return { modified: false };
    },
  };
  const store = new NetlifyBlobStore({
    blobs,
    setupKey: "netlify-setup-key-123",
    maxAttempts: 100,
    retryDeadlineMs: 25,
    baseRetryDelayMs: 10,
    maxRetryDelayMs: 20,
    now: () => now,
    random: () => 0,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      now += milliseconds;
    },
  });

  await assert.rejects(store.init(), /طلبات متزامنة كثيرة/);
  assert.ok(writes < 100);
  assert.deepEqual(waits, [5, 10, 10]);
  assert.equal(now, 25);
});

test("student PATCH retry preserves a concurrently changed PIN", async () => {
  const blobs = new MemoryBlobs();
  const handler = createHandler(blobs);
  const setup = await api(handler, "/api/admin/setup", {
    method: "POST",
    body: {
      displayName: "مشرف السباق",
      password: "concurrency-password",
      setupKey: "netlify-setup-key-123",
    },
  });
  assert.equal(setup.response.status, 201);
  const token = setup.payload.token;
  const created = await api(handler, "/api/students", {
    method: "POST",
    token,
    body: {
      id: "student-pin-race",
      name: "نورة علي",
      className: "أولى ثانوي",
      halaqa: "زكاء",
      pin: "1122",
    },
  });
  assert.equal(created.response.status, 201);
  const initialPinHash = blobs.entries.get("state").data.students[0].pinHash;

  let releaseStaleWrite;
  const staleWriteReleased = new Promise((resolve) => {
    releaseStaleWrite = resolve;
  });
  let reportStaleWrite;
  const staleWriteReached = new Promise((resolve) => {
    reportStaleWrite = resolve;
  });
  let blocked = false;
  blobs.beforeSet = async ({ data, options }) => {
    const student = data.students.find((item) => item.id === "student-pin-race");
    if (
      !blocked &&
      options.onlyIfMatch &&
      student?.className === "ثالث ثانوي" &&
      student.pinHash === initialPinHash
    ) {
      blocked = true;
      reportStaleWrite();
      await staleWriteReleased;
    }
  };

  const pinlessEditPromise = api(handler, "/api/students/student-pin-race", {
    method: "PATCH",
    token,
    body: {
      name: "نورة علي",
      className: "ثالث ثانوي",
      halaqa: "سواعد",
    },
  });
  await staleWriteReached;

  const pinEdit = await api(handler, "/api/students/student-pin-race", {
    method: "PATCH",
    token,
    body: {
      name: "نورة علي",
      className: "أولى ثانوي",
      halaqa: "زكاء",
      pin: "9988",
    },
  });
  assert.equal(pinEdit.response.status, 200);
  const pinAfterPinEdit = structuredClone(
    blobs.entries.get("state").data.students[0]
  );

  releaseStaleWrite();
  const pinlessEdit = await pinlessEditPromise;
  assert.equal(pinlessEdit.response.status, 200);

  const committed = blobs.entries.get("state").data.students[0];
  assert.equal(committed.className, "ثالث ثانوي");
  assert.equal(committed.halaqa, "سواعد");
  assert.equal(committed.revision, 3);
  assert.equal(committed.pinLookup, pinAfterPinEdit.pinLookup);
  assert.equal(committed.pinSalt, pinAfterPinEdit.pinSalt);
  assert.equal(committed.pinHash, pinAfterPinEdit.pinHash);
  assert.ok(blobs.conditionalConflicts > 0);
});

test("Netlify Function shares supervisors, roster, quizzes, proofs, and sessions", async () => {
  const blobs = new MemoryBlobs();
  const firstInstance = createHandler(blobs);
  const secondInstance = createHandler(blobs);

  const initialStatus = await api(firstInstance, "/api/admin/status");
  assert.equal(initialStatus.response.status, 200);
  assert.equal(initialStatus.payload.configured, false);

  const setup = await api(firstInstance, "/api/admin/setup", {
    method: "POST",
    body: {
      displayName: "مشرف Netlify",
      password: "secure-test-password",
      setupKey: "netlify-setup-key-123",
    },
  });
  assert.equal(setup.response.status, 201);
  const supervisorToken = setup.payload.token;

  const studentBodies = [
    {
      id: "student-netlify-a",
      name: "سارة القحطاني",
      className: "أولى ثانوي",
      halaqa: "زكاء",
      pin: "1234",
    },
    {
      id: "student-netlify-b",
      name: "عمر الحربي",
      className: "ثاني ثانوي",
      halaqa: "سواعد",
      pin: "5678",
    },
  ];
  const additions = await Promise.all([
    api(firstInstance, "/api/students", {
      method: "POST",
      token: supervisorToken,
      body: studentBodies[0],
    }),
    api(secondInstance, "/api/students", {
      method: "POST",
      token: supervisorToken,
      body: studentBodies[1],
    }),
  ]);
  assert.deepEqual(
    additions.map(({ response }) => response.status),
    [201, 201]
  );

  const roster = await api(secondInstance, "/api/students", {
    token: supervisorToken,
  });
  assert.equal(roster.payload.students.length, 2);

  const created = await api(firstInstance, "/api/quizzes", {
    method: "POST",
    token: supervisorToken,
    body: {
      question: {
        type: "boolean",
        prompt: "الأرض تدور حول الشمس.",
        options: ["صح", "خطأ"],
        correctAnswer: "صح",
      },
      students: [],
    },
  });
  assert.equal(created.response.status, 201);
  assert.match(created.payload.studentPath, /^\/student\.html\?q=/);
  const quizId = created.payload.quizId;

  const sharedQuiz = await api(secondInstance, `/api/quizzes/${quizId}`);
  assert.equal(sharedQuiz.response.status, 200);
  assert.equal(sharedQuiz.payload.quiz.id, quizId);

  const credentials = {
    name: "سارة القحطاني",
    className: "أولى ثانوي",
    halaqa: "زكاء",
    pin: "1234",
  };
  const challenge = await api(
    firstInstance,
    `/api/quizzes/${quizId}/access/challenge`,
    { method: "POST", body: credentials }
  );
  const proofBody = {
    ...credentials,
    challengeToken: challenge.payload.token,
    challengeCounter: solveChallenge(
      challenge.payload.token,
      challenge.payload.difficultyBits
    ),
  };
  const proofRace = await Promise.all([
    api(firstInstance, `/api/quizzes/${quizId}/access`, {
      method: "POST",
      body: proofBody,
    }),
    api(secondInstance, `/api/quizzes/${quizId}/access`, {
      method: "POST",
      body: proofBody,
    }),
  ]);
  assert.deepEqual(
    proofRace.map(({ response }) => response.status).sort(),
    [200, 409]
  );
  const studentSession = proofRace.find(({ response }) => response.status === 200)
    .payload.token;

  const submission = await api(
    secondInstance,
    `/api/quizzes/${quizId}/submissions`,
    {
      method: "POST",
      bearer: studentSession,
      body: { answer: "صح" },
    }
  );
  assert.equal(submission.response.status, 200);
  assert.equal(submission.payload.result.entry.isCorrect, true);

  const deletion = await api(
    secondInstance,
    "/api/students/student-netlify-b",
    {
      method: "DELETE",
      token: supervisorToken,
    }
  );
  assert.equal(deletion.response.status, 200);

  const restartedInstance = createHandler(blobs);
  const persistedRoster = await api(restartedInstance, "/api/students", {
    token: supervisorToken,
  });
  assert.deepEqual(
    persistedRoster.payload.students.map((student) => student.id),
    ["student-netlify-a"]
  );
  const dashboard = await api(restartedInstance, "/api/admin/dashboard", {
    token: supervisorToken,
  });
  assert.equal(dashboard.payload.quiz.id, quizId);
  assert.equal(dashboard.payload.quiz.submissions.length, 1);
});

test("Netlify Function keeps supervisor throttling across cold instances", async () => {
  const blobs = new MemoryBlobs();
  const setup = await api(createHandler(blobs), "/api/admin/setup", {
    method: "POST",
    body: {
      displayName: "مشرف الحماية",
      password: "correct-password",
      setupKey: "netlify-setup-key-123",
    },
  });
  assert.equal(setup.response.status, 201);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const rejected = await api(createHandler(blobs), "/api/admin/login", {
      method: "POST",
      body: {
        displayName: "مشرف الحماية",
        password: `wrong-password-${attempt}`,
      },
    });
    assert.equal(rejected.response.status, 401);
  }
  const limited = await api(createHandler(blobs), "/api/admin/login", {
    method: "POST",
    body: {
      displayName: "مشرف الحماية",
      password: "correct-password",
    },
  });
  assert.equal(limited.response.status, 429);
  assert.equal(limited.payload.error.code, "SUPERVISOR_PROOF_REQUIRED");

  const details = limited.payload.error.details;
  const recovered = await api(createHandler(blobs), "/api/admin/login", {
    method: "POST",
    body: {
      displayName: "مشرف الحماية",
      password: "correct-password",
      challengeToken: details.challengeToken,
      challengeCounter: solveChallenge(
        details.challengeToken,
        details.difficultyBits
      ),
    },
  });
  assert.equal(recovered.response.status, 200);
  assert.ok(recovered.payload.token);
});

test("Netlify Function requires a setup key for a fresh site", async () => {
  const handler = createNetlifyApiHandler({
    environment: {},
    getBlobStore: () => new MemoryBlobs(),
    logger: { error() {} },
  });
  const result = await api(handler, "/api/health");
  assert.equal(result.response.status, 500);
  assert.equal(result.payload.error.code, "SETUP_KEY_CONFIGURATION_ERROR");
});

test("Netlify Function allows an absent setup key after the blob is configured", async () => {
  const blobs = new MemoryBlobs();
  const configuredHandler = createHandler(blobs);
  const setup = await api(configuredHandler, "/api/admin/setup", {
    method: "POST",
    body: {
      displayName: "مشرف الإعداد",
      password: "configured-password",
      setupKey: "netlify-setup-key-123",
    },
  });
  assert.equal(setup.response.status, 201);

  const restartedWithoutKey = createNetlifyApiHandler({
    environment: {},
    getBlobStore: () => blobs,
    logger: { error() {} },
    serverOptions: {
      accessDifficultyBits: 8,
      supervisorDifficultyBits: 8,
      nodeEnvironment: "test",
    },
  });
  const result = await api(restartedWithoutKey, "/api/health");
  assert.equal(result.response.status, 200);
  assert.equal(result.payload.ok, true);
});

test("Netlify Function requires an environment setup key while a blob is unconfigured", async () => {
  const blobs = new MemoryBlobs();
  const initialized = await api(createHandler(blobs), "/api/health");
  assert.equal(initialized.response.status, 200);

  const restartedWithoutKey = createNetlifyApiHandler({
    environment: {},
    getBlobStore: () => blobs,
    logger: { error() {} },
  });
  const result = await api(restartedWithoutKey, "/api/health");
  assert.equal(result.response.status, 500);
  assert.equal(result.payload.error.code, "SETUP_KEY_CONFIGURATION_ERROR");
});

test("Netlify Function makes a provided setup key authoritative while unconfigured", async () => {
  const blobs = new MemoryBlobs();
  const initialized = await api(createHandler(blobs), "/api/health");
  assert.equal(initialized.response.status, 200);

  const rotatedHandler = createNetlifyApiHandler({
    environment: { BAYNAT_SETUP_KEY: "rotated-setup-key-456" },
    getBlobStore: () => blobs,
    logger: { error() {} },
    serverOptions: {
      accessDifficultyBits: 8,
      supervisorDifficultyBits: 8,
      nodeEnvironment: "test",
    },
  });
  const rejectedOldKey = await api(rotatedHandler, "/api/admin/setup", {
    method: "POST",
    body: {
      displayName: "مشرف التدوير",
      password: "configured-password",
      setupKey: "netlify-setup-key-123",
    },
  });
  assert.equal(rejectedOldKey.response.status, 401);
  assert.equal(rejectedOldKey.payload.error.code, "SETUP_KEY_REJECTED");
  assert.doesNotMatch(rejectedOldKey.payload.error.message, /سجل تشغيل/);

  const acceptedNewKey = await api(rotatedHandler, "/api/admin/setup", {
    method: "POST",
    body: {
      displayName: "مشرف التدوير",
      password: "configured-password",
      setupKey: "rotated-setup-key-456",
    },
  });
  assert.equal(acceptedNewKey.response.status, 201);
});

test("Netlify Function isolates previews by runtime deploy metadata", async () => {
  const blobs = new MemoryBlobs();
  let selectedSiteStore = null;
  let selectedDeployStore = null;
  const handler = createNetlifyApiHandler({
    environment: {
      BAYNAT_SETUP_KEY: "netlify-setup-key-123",
      CONTEXT: "production",
    },
    getBlobStore: (storeName) => {
      selectedSiteStore = storeName;
      return blobs;
    },
    getDeployBlobStore: (options) => {
      selectedDeployStore = options;
      return blobs;
    },
    logger: { error() {} },
    serverOptions: {
      accessDifficultyBits: 8,
      supervisorDifficultyBits: 8,
      nodeEnvironment: "test",
    },
  });
  const result = await api(handler, "/api/health", {
    runtimeContext: {
      deploy: {
        context: "deploy-preview",
        id: "507f1f77bcf86cd799439011",
      },
    },
  });
  assert.equal(result.response.status, 200);
  assert.equal(selectedSiteStore, null);
  assert.deepEqual(selectedDeployStore, {
    name: "baynat-data",
    deployID: "507f1f77bcf86cd799439011",
    consistency: "strong",
  });
});

test("Netlify Function fails closed when deploy metadata is absent", async () => {
  const handler = createNetlifyApiHandler({
    environment: { BAYNAT_SETUP_KEY: "netlify-setup-key-123" },
    getBlobStore: () => new MemoryBlobs(),
    logger: { error() {} },
  });
  const result = await api(handler, "/api/health", { runtimeContext: {} });
  assert.equal(result.response.status, 500);
  assert.equal(result.payload.error.code, "DEPLOYMENT_CONTEXT_ERROR");
});

test("Netlify Function fails closed when a preview deploy ID is absent", async () => {
  const handler = createNetlifyApiHandler({
    environment: { BAYNAT_SETUP_KEY: "netlify-setup-key-123" },
    getDeployBlobStore: () => new MemoryBlobs(),
    logger: { error() {} },
  });
  const result = await api(handler, "/api/health", {
    runtimeContext: { deploy: { context: "deploy-preview" } },
  });
  assert.equal(result.response.status, 500);
  assert.equal(result.payload.error.code, "DEPLOYMENT_CONTEXT_ERROR");
});
