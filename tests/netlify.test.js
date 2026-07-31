import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MissingDatabaseConnectionError } from "@netlify/database";
import {
  DatabaseUnavailableError,
  NetlifyDatabaseStore,
  SetupKeyConfigurationError,
} from "../netlify/database-store.js";
import { createNetlifyApiHandler } from "../netlify/functions/api.mjs";
import {
  TransactionalFakePool,
  sqlEvents,
} from "./transactional-fake-pool.js";

const SETUP_KEY = "netlify-setup-key-123";

function database(pool) {
  return { driver: "fake", pool };
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
    idempotencyKey,
    body,
    runtimeContext = {},
  } = {}
) {
  const headers = new Headers();
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (token) headers.set("X-Supervisor-Token", token);
  if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
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

function createHandler(pool, { setupKey = SETUP_KEY } = {}) {
  return createNetlifyApiHandler({
    environment: setupKey ? { BAYNAT_SETUP_KEY: setupKey } : {},
    getDatabaseClient: () => database(pool),
    logger: { error() {} },
    serverOptions: {
      accessDifficultyBits: 8,
      supervisorDifficultyBits: 8,
      nodeEnvironment: "test",
    },
  });
}

async function setupHandler(pool, displayName = "مشرف الاختبار") {
  const handler = createHandler(pool);
  const setup = await api(handler, "/api/admin/setup", {
    method: "POST",
    body: {
      displayName,
      password: "concurrency-password",
      setupKey: SETUP_KEY,
    },
  });
  assert.equal(setup.response.status, 201);
  return { handler, token: setup.payload.token };
}

function studentBody({
  id,
  name = "سارة القحطاني",
  className = "أولى ثانوي",
  halaqa = "زكاء",
  pin = "1234",
} = {}) {
  return { ...(id ? { id } : {}), name, className, halaqa, pin };
}

test("uses the current Netlify migration layout for state and proof tables", async () => {
  const migrationUrl = new URL(
    "../netlify/database/migrations/20260731213000_create-baynat-state/migration.sql",
    import.meta.url
  );
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(migrationUrl.pathname, /\/\d{14}_[a-z0-9-]+\/migration\.sql$/);
  assert.match(sql, /CREATE TABLE baynat_state/);
  assert.match(sql, /state JSON NOT NULL/);
  assert.doesNotMatch(sql, /state JSONB NOT NULL/);
  assert.match(sql, /CHECK \(singleton_id = 1\)/);
  assert.match(sql, /CREATE TABLE baynat_consumed_proofs/);
  assert.match(sql, /proof_hash VARCHAR\(64\) PRIMARY KEY/);
  assert.match(sql, /expires_at TIMESTAMPTZ NOT NULL/);
});

test("documents the no-Git existing-site preview and production flow", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

  assert.match(readme, /netlify-cli@latest login/);
  assert.match(
    readme,
    /netlify-cli@latest link --name YOUR_EXISTING_SITE_NAME/
  );
  assert.match(
    readme,
    /env:set BAYNAT_SETUP_KEY[\s\S]+--context production deploy-preview[\s\S]+--scope functions --secret/
  );
  assert.match(readme, /deploy --context deploy-preview/);
  assert.match(readme, /deploy --prod --context production/);
  assert.match(readme, /logs --source deploy --url "\$PREVIEW_URL"/);
  assert.match(readme, /curl -fsS "\$PREVIEW_URL\/api\/health"/);
  assert.match(readme, /صف `JSON` دائم واحد/);
  assert.match(readme, /لا يتضمن هذا الإصدار مستورد Blobs/);
});

test("concurrent cold starts atomically create and validate one state row", async () => {
  const pool = new TransactionalFakePool();
  const stores = Array.from(
    { length: 24 },
    () => new NetlifyDatabaseStore({ database: database(pool), setupKey: SETUP_KEY })
  );

  await Promise.all(stores.map((store) => store.init()));

  assert.equal(pool.state.setupKey, SETUP_KEY);
  assert.equal(new Set(stores.map((store) => store.data.secret)).size, 1);
  const queryEvents = pool.events.filter((event) => event.type === "query");
  assert.equal(
    queryEvents.filter((event) =>
      event.sql.startsWith("INSERT INTO baynat_state")
    ).length,
    stores.length
  );
  assert.equal(
    queryEvents.filter((event) => event.sql.endsWith("FOR UPDATE")).length,
    stores.length
  );
  assert.equal(
    queryEvents.filter((event) => event.sql === "COMMIT").length,
    stores.length
  );
  assert.equal(
    pool.events.filter((event) => event.type === "release").length,
    stores.length
  );
});

test("initialization validates and transactionally migrates legacy state", async () => {
  const pool = new TransactionalFakePool({
    state: {
      version: 1,
      secret: "legacy-secret-that-is-long-enough",
      adminCredential: null,
      setupKey: SETUP_KEY,
      consumedProofs: {},
      quizzes: {},
    },
  });
  const store = new NetlifyDatabaseStore({
    database: database(pool),
    setupKey: SETUP_KEY,
  });

  await store.init();

  assert.equal(store.data.version, 2);
  assert.deepEqual(store.data.supervisors, []);
  assert.deepEqual(store.data.students, []);
  assert.equal(Object.hasOwn(store.data, "adminCredential"), false);
  const update = pool.events.find(
    (event) =>
      event.type === "query" && event.sql.startsWith("UPDATE baynat_state")
  );
  assert.ok(update);
  assert.deepEqual(sqlEvents(pool, update.clientId), [
    "BEGIN",
    "SET LOCAL lock_timeout = '3000ms'",
    "SET LOCAL statement_timeout = '8000ms'",
    "INSERT INTO baynat_state (singleton_id, state) VALUES ($1, $2::json) ON CONFLICT (singleton_id) DO NOTHING",
    "SELECT state FROM baynat_state WHERE singleton_id = $1 FOR UPDATE",
    "UPDATE baynat_state SET state = $2::json, updated_at = NOW() WHERE singleton_id = $1",
    "COMMIT",
  ]);
});

test("setup key remains authoritative only until the first supervisor", async () => {
  const freshPool = new TransactionalFakePool();
  const missing = new NetlifyDatabaseStore({
    database: database(freshPool),
  });
  await assert.rejects(missing.init(), SetupKeyConfigurationError);
  assert.equal(freshPool.state, null);
  assert.equal(
    freshPool.events.filter((event) => event.type === "connect").length,
    0
  );
  assert.equal(
    freshPool.events[0].sql,
    "SELECT state FROM baynat_state WHERE singleton_id = $1"
  );

  const first = new NetlifyDatabaseStore({
    database: database(freshPool),
    setupKey: SETUP_KEY,
  });
  await first.init();
  const rotatedKey = "rotated-setup-key-456";
  const rotated = new NetlifyDatabaseStore({
    database: database(freshPool),
    setupKey: rotatedKey,
  });
  await rotated.init();
  assert.equal(freshPool.state.setupKey, rotatedKey);

  const unconfiguredWithoutKey = new NetlifyDatabaseStore({
    database: database(freshPool),
  });
  await assert.rejects(
    unconfiguredWithoutKey.init(),
    SetupKeyConfigurationError
  );

  await rotated.update((state) => {
    state.supervisors.push({
      id: "supervisor-lifecycle",
      displayName: "مشرف دورة الإعداد",
      credential: {
        salt: "test-salt",
        hash: "test-hash",
        createdAt: "2026-07-31T20:00:00.000Z",
      },
    });
    state.setupKey = null;
  });
  const configuredWithoutKey = new NetlifyDatabaseStore({
    database: database(freshPool),
  });
  await configuredWithoutKey.init();
  assert.equal(configuredWithoutKey.data.setupKey, null);

  const ignoredAfterSetup = new NetlifyDatabaseStore({
    database: database(freshPool),
    setupKey: "another-setup-key-789",
  });
  await ignoredAfterSetup.init();
  assert.equal(ignoredAfterSetup.data.setupKey, null);
});

test("80 concurrent updates lock the latest row without losing state", async () => {
  const pool = new TransactionalFakePool();
  await new NetlifyDatabaseStore({
    database: database(pool),
    setupKey: SETUP_KEY,
  }).init();
  const concurrentEventStart = pool.events.length;
  const valuesSeenByCallbacks = [];

  await Promise.all(
    Array.from({ length: 80 }, async () => {
      const store = new NetlifyDatabaseStore({
        database: database(pool),
        setupKey: SETUP_KEY,
      });
      await store.init();
      await store.update((state) => {
        valuesSeenByCallbacks.push(state.testMutationCount || 0);
        state.testMutationCount = (state.testMutationCount || 0) + 1;
      });
    })
  );

  const restarted = new NetlifyDatabaseStore({
    database: database(pool),
    setupKey: SETUP_KEY,
  });
  await restarted.init();
  assert.equal(restarted.data.testMutationCount, 80);
  const concurrentEvents = pool.events.slice(concurrentEventStart);
  assert.equal(
    concurrentEvents.filter((event) => event.type === "connect").length,
    80
  );
  assert.equal(
    concurrentEvents.filter(
      (event) =>
        event.type === "pool-query" &&
        event.sql ===
          "SELECT state FROM baynat_state WHERE singleton_id = $1"
    ).length,
    81
  );
  assert.deepEqual(
    valuesSeenByCallbacks.slice().sort((a, b) => a - b),
    Array.from({ length: 80 }, (_, index) => index)
  );

  const updateEvents = pool.events.filter(
    (event) =>
      event.type === "query" &&
      event.sql.startsWith("UPDATE baynat_state") &&
      event.params[1]?.includes?.('"testMutationCount"')
  );
  assert.equal(updateEvents.length, 80);
  for (const event of updateEvents) {
    const sequence = sqlEvents(pool, event.clientId);
    assert.equal(sequence[0], "BEGIN");
    assert.equal(sequence[1], "SET LOCAL lock_timeout = '3000ms'");
    assert.equal(sequence[2], "SET LOCAL statement_timeout = '8000ms'");
    assert.ok(sequence[3].endsWith("FOR UPDATE"));
    assert.ok(sequence[4].startsWith("UPDATE baynat_state"));
    assert.equal(sequence[5], "COMMIT");
  }
});

test("update rolls back callback and database failures and always releases", async () => {
  const pool = new TransactionalFakePool();
  const store = new NetlifyDatabaseStore({
    database: database(pool),
    setupKey: SETUP_KEY,
  });
  await store.init();
  const before = structuredClone(pool.state);
  pool.events.length = 0;

  const callbackFailure = new Error("callback failed");
  await assert.rejects(
    store.update((state) => {
      state.shouldNotPersist = true;
      throw callbackFailure;
    }),
    (error) => error === callbackFailure
  );
  assert.deepEqual(pool.state, before);
  const callbackClientId = pool.events.find(
    (event) => event.type === "connect"
  ).clientId;
  assert.deepEqual(sqlEvents(pool, callbackClientId), [
    "BEGIN",
    "SET LOCAL lock_timeout = '3000ms'",
    "SET LOCAL statement_timeout = '8000ms'",
    "SELECT state FROM baynat_state WHERE singleton_id = $1 FOR UPDATE",
    "ROLLBACK",
  ]);
  assert.equal(
    pool.events.filter((event) => event.type === "release").length,
    1
  );

  pool.events.length = 0;
  pool.failNext("UPDATE baynat_state", new Error("database write failed"));
  await assert.rejects(
    store.update((state) => {
      state.shouldAlsoNotPersist = true;
    }),
    (error) =>
      error instanceof DatabaseUnavailableError &&
      error.code === "DATABASE_UNAVAILABLE"
  );
  assert.deepEqual(pool.state, before);
  const databaseClientId = pool.events.find(
    (event) => event.type === "connect"
  ).clientId;
  assert.deepEqual(sqlEvents(pool, databaseClientId), [
    "BEGIN",
    "SET LOCAL lock_timeout = '3000ms'",
    "SET LOCAL statement_timeout = '8000ms'",
    "SELECT state FROM baynat_state WHERE singleton_id = $1 FOR UPDATE",
    "UPDATE baynat_state SET state = $2::json, updated_at = NOW() WHERE singleton_id = $1",
    "ROLLBACK",
  ]);
  assert.equal(
    pool.events.filter((event) => event.type === "release").length,
    1
  );
});

test("stores opaque state through JSON casts without rejecting edge-case strings", async () => {
  const pool = new TransactionalFakePool();
  const store = new NetlifyDatabaseStore({
    database: database(pool),
    setupKey: SETUP_KEY,
  });
  await store.init();
  pool.events.length = 0;
  const edgeCase = `nul:\u0000 surrogate:\ud800`;

  await store.update((state) => {
    state.opaqueJsonText = edgeCase;
  });

  assert.equal(pool.state.opaqueJsonText, edgeCase);
  const update = pool.events.find(
    (event) =>
      event.type === "query" && event.sql.startsWith("UPDATE baynat_state")
  );
  assert.ok(update);
  assert.match(update.sql, /\$2::json,/);
  assert.doesNotMatch(update.sql, /::jsonb/);
  assert.match(update.params[1], /\\u0000/);
  assert.match(update.params[1], /\\ud800/i);
});

test("classifies transaction timeouts as retryable database busy errors", async () => {
  const pool = new TransactionalFakePool();
  const store = new NetlifyDatabaseStore({
    database: database(pool),
    setupKey: SETUP_KEY,
  });
  await store.init();
  for (const code of ["55P03", "57014"]) {
    const timeout = Object.assign(
      new Error("canceling statement due to transaction timeout"),
      { code }
    );
    pool.failNext("SELECT state FROM baynat_state", timeout);

    await assert.rejects(
      store.update(() => {}),
      (error) =>
        error.status === 503 &&
        error.code === "DATABASE_BUSY" &&
        error.cause === timeout
    );
  }
});

test("proof consumption is an atomic insert outside the shared state row", async () => {
  let now = Date.parse("2026-07-31T20:00:00.000Z");
  const pool = new TransactionalFakePool({ now: () => now });
  const store = new NetlifyDatabaseStore({
    database: database(pool),
    setupKey: SETUP_KEY,
  });
  await store.init();
  const stateBefore = structuredClone(pool.state);
  pool.events.length = 0;
  const proof = {
    tokenHash: "a".repeat(64),
    expiresAt: now + 120_000,
  };

  const consumed = await Promise.all(
    Array.from({ length: 20 }, () => store.consumeProof(proof))
  );
  assert.equal(consumed.filter(Boolean).length, 1);
  assert.equal(consumed.filter((value) => !value).length, 19);
  assert.deepEqual(pool.state, stateBefore);
  assert.equal(pool.events.length, 20);
  assert.ok(
    pool.events.every(
      (event) =>
        event.type === "pool-query" &&
        event.sql.includes("ON CONFLICT (proof_hash) DO NOTHING") &&
        !event.sql.includes("baynat_state")
    )
  );

  now += 180_000;
  assert.equal(
    await store.consumeProof({
      tokenHash: "b".repeat(64),
      expiresAt: now + 120_000,
    }),
    true
  );
  assert.equal(pool.proofs.has(proof.tokenHash), false);
});

test("Netlify Function reports setup, state, and database failures clearly", async () => {
  const missingConnectionHandler = createNetlifyApiHandler({
    environment: { BAYNAT_SETUP_KEY: SETUP_KEY },
    getDatabaseClient() {
      throw new MissingDatabaseConnectionError();
    },
    logger: { error() {} },
  });
  const missingConnection = await api(
    missingConnectionHandler,
    "/api/health"
  );
  assert.equal(missingConnection.response.status, 500);
  assert.equal(
    missingConnection.payload.error.code,
    "DATABASE_CONFIGURATION_ERROR"
  );

  const unavailableHandler = createNetlifyApiHandler({
    environment: { BAYNAT_SETUP_KEY: SETUP_KEY },
    getDatabaseClient() {
      throw new Error("database credentials unavailable");
    },
    logger: { error() {} },
  });
  const unavailable = await api(unavailableHandler, "/api/health");
  assert.equal(unavailable.response.status, 503);
  assert.equal(unavailable.payload.error.code, "DATABASE_UNAVAILABLE");

  const malformedClient = await api(
    createNetlifyApiHandler({
      environment: { BAYNAT_SETUP_KEY: SETUP_KEY },
      getDatabaseClient: () => ({ pool: {} }),
      logger: { error() {} },
    }),
    "/api/health"
  );
  assert.equal(malformedClient.response.status, 500);
  assert.equal(
    malformedClient.payload.error.code,
    "DATABASE_CONFIGURATION_ERROR"
  );

  const missingSchemaPool = new TransactionalFakePool();
  missingSchemaPool.failNext(
    "SELECT state FROM baynat_state",
    Object.assign(new Error('relation "baynat_state" does not exist'), {
      code: "42P01",
    })
  );
  const missingSchema = await api(
    createHandler(missingSchemaPool),
    "/api/health"
  );
  assert.equal(missingSchema.response.status, 500);
  assert.equal(
    missingSchema.payload.error.code,
    "DATABASE_CONFIGURATION_ERROR"
  );

  const missingKey = await api(
    createHandler(new TransactionalFakePool(), { setupKey: "" }),
    "/api/health"
  );
  assert.equal(missingKey.response.status, 500);
  assert.equal(
    missingKey.payload.error.code,
    "SETUP_KEY_CONFIGURATION_ERROR"
  );

  const malformedKeyHandler = createNetlifyApiHandler({
    environment: { BAYNAT_SETUP_KEY: "short" },
    getDatabaseClient: () => database(new TransactionalFakePool()),
    logger: { error() {} },
  });
  const malformedKey = await api(malformedKeyHandler, "/api/health");
  assert.equal(malformedKey.response.status, 500);
  assert.equal(
    malformedKey.payload.error.code,
    "SETUP_KEY_CONFIGURATION_ERROR"
  );

  const invalidState = new TransactionalFakePool({
    state: { version: 999, important: "keep-me" },
  });
  const invalid = await api(createHandler(invalidState), "/api/health");
  assert.equal(invalid.response.status, 500);
  assert.equal(invalid.payload.error.code, "DATABASE_STATE_INVALID");
  assert.deepEqual(invalidState.state, {
    version: 999,
    important: "keep-me",
  });

  const operationalPool = new TransactionalFakePool();
  const operational = await setupHandler(
    operationalPool,
    "مشرف تعطل القاعدة"
  );
  operationalPool.failNext(
    "UPDATE baynat_state",
    new Error("database write unavailable")
  );
  const failedWrite = await api(operational.handler, "/api/students", {
    method: "POST",
    token: operational.token,
    body: studentBody(),
  });
  assert.equal(failedWrite.response.status, 503);
  assert.equal(failedWrite.payload.error.code, "DATABASE_UNAVAILABLE");
});

test("each Netlify invocation resolves and closes a fresh database pool", async () => {
  const contexts = [];
  const pools = [];
  const handler = createNetlifyApiHandler({
    environment: { BAYNAT_SETUP_KEY: SETUP_KEY },
    getDatabaseClient: () => {
      contexts.push("automatic");
      const pool = new TransactionalFakePool();
      pools.push(pool);
      return database(pool);
    },
    logger: { error() {} },
    serverOptions: {
      accessDifficultyBits: 8,
      supervisorDifficultyBits: 8,
      nodeEnvironment: "test",
    },
  });

  const withoutDeployMetadata = await api(handler, "/api/health");
  const preview = await api(handler, "/api/health", {
    runtimeContext: {
      deploy: { context: "deploy-preview", id: "preview-id" },
    },
  });
  assert.equal(withoutDeployMetadata.response.status, 200);
  assert.equal(preview.response.status, 200);
  assert.deepEqual(contexts, ["automatic", "automatic"]);
  assert.equal(pools.length, 2);
  assert.notEqual(pools[0], pools[1]);
  assert.deepEqual(
    pools.map(
      (pool) => pool.events.filter((event) => event.type === "end").length
    ),
    [1, 1]
  );

  const failingPool = new TransactionalFakePool();
  failingPool.failNext(
    "SELECT state FROM baynat_state",
    new Error("connection dropped")
  );
  const failingHandler = createNetlifyApiHandler({
    environment: { BAYNAT_SETUP_KEY: SETUP_KEY },
    getDatabaseClient: () => database(failingPool),
    logger: { error() {} },
    serverOptions: {
      accessDifficultyBits: 8,
      supervisorDifficultyBits: 8,
      nodeEnvironment: "test",
    },
  });
  const failure = await api(failingHandler, "/api/health");
  assert.equal(failure.response.status, 503);
  assert.equal(
    failingPool.events.filter((event) => event.type === "end").length,
    1
  );
});

test("shared roster atomically rejects duplicate PIN creates and edits", async () => {
  const createPool = new TransactionalFakePool();
  const createContext = await setupHandler(createPool, "مشرفا الإضافة");
  const concurrentCreates = await Promise.all([
    api(createContext.handler, "/api/students", {
      method: "POST",
      token: createContext.token,
      body: studentBody({
        id: "student-concurrent-a",
        pin: "5566",
      }),
    }),
    api(createContext.handler, "/api/students", {
      method: "POST",
      token: createContext.token,
      body: studentBody({
        id: "student-concurrent-b",
        name: "ريم السبيعي",
        className: "ثاني ثانوي",
        halaqa: "سواعد",
        pin: "5566",
      }),
    }),
  ]);
  assert.deepEqual(
    concurrentCreates.map(({ response }) => response.status).sort(),
    [201, 409]
  );
  assert.equal(
    concurrentCreates.find(({ response }) => response.status === 409).payload
      .error.code,
    "DUPLICATE_PIN"
  );
  assert.equal(createPool.state.students.length, 1);

  const editPool = new TransactionalFakePool();
  const editContext = await setupHandler(editPool, "مشرفا التعديل");
  for (const body of [
    studentBody({
      id: "student-race-a",
      name: "نورة علي",
      pin: "1111",
    }),
    studentBody({
      id: "student-race-b",
      name: "هند محمد",
      className: "ثاني ثانوي",
      halaqa: "سواعد",
      pin: "2222",
    }),
  ]) {
    const created = await api(editContext.handler, "/api/students", {
      method: "POST",
      token: editContext.token,
      body,
    });
    assert.equal(created.response.status, 201);
  }
  const concurrentEdits = await Promise.all([
    api(editContext.handler, "/api/students/student-race-a", {
      method: "PATCH",
      token: editContext.token,
      body: studentBody({ name: "نورة علي", pin: "7788" }),
    }),
    api(editContext.handler, "/api/students/student-race-b", {
      method: "PATCH",
      token: editContext.token,
      body: studentBody({
        name: "هند محمد",
        className: "ثاني ثانوي",
        halaqa: "سواعد",
        pin: "7788",
      }),
    }),
  ]);
  assert.deepEqual(
    concurrentEdits.map(({ response }) => response.status).sort(),
    [200, 409]
  );
  assert.equal(
    concurrentEdits.find(({ response }) => response.status === 409).payload
      .error.code,
    "DUPLICATE_PIN"
  );
  assert.equal(
    new Set(editPool.state.students.map((student) => student.pinLookup)).size,
    2
  );
});

test("server idempotency deduplicates concurrent student and quiz creates", async () => {
  const pool = new TransactionalFakePool();
  const context = await setupHandler(pool, "مشرف إعادة المحاولة");
  const body = studentBody({ name: "سارة القحطاني" });
  const studentRetries = await Promise.all([
    api(context.handler, "/api/students", {
      method: "POST",
      token: context.token,
      idempotencyKey: "student-create-retry-00000001",
      body,
    }),
    api(context.handler, "/api/students", {
      method: "POST",
      token: context.token,
      idempotencyKey: "student-create-retry-00000001",
      body,
    }),
  ]);
  assert.deepEqual(
    studentRetries.map(({ response }) => response.status),
    [201, 201]
  );
  assert.equal(
    new Set(studentRetries.map(({ payload }) => payload.student.id)).size,
    1
  );
  assert.equal(pool.state.students.length, 1);

  const reusedStudentKey = await api(context.handler, "/api/students", {
    method: "POST",
    token: context.token,
    idempotencyKey: "student-create-retry-00000001",
    body: studentBody({
      name: "ريم السبيعي",
      className: "ثاني ثانوي",
      halaqa: "سواعد",
      pin: "5678",
    }),
  });
  assert.equal(reusedStudentKey.response.status, 409);
  assert.equal(
    reusedStudentKey.payload.error.code,
    "IDEMPOTENCY_KEY_REUSED"
  );

  const quizBody = {
    question: {
      type: "boolean",
      prompt: "الأرض تدور حول الشمس.",
      options: ["صح", "خطأ"],
      correctAnswer: "صح",
    },
    students: [],
  };
  const quizRetries = await Promise.all([
    api(context.handler, "/api/quizzes", {
      method: "POST",
      token: context.token,
      idempotencyKey: "quiz-create-retry-0000000001",
      body: quizBody,
    }),
    api(context.handler, "/api/quizzes", {
      method: "POST",
      token: context.token,
      idempotencyKey: "quiz-create-retry-0000000001",
      body: quizBody,
    }),
  ]);
  assert.deepEqual(
    quizRetries.map(({ response }) => response.status),
    [201, 201]
  );
  assert.equal(
    new Set(quizRetries.map(({ payload }) => payload.quizId)).size,
    1
  );
  assert.equal(
    new Set(quizRetries.map(({ payload }) => payload.adminToken)).size,
    1
  );
  assert.equal(Object.keys(pool.state.quizzes).length, 1);
  assert.equal(pool.state.security.quizCreations.global.length, 1);

  const reusedQuizKey = await api(context.handler, "/api/quizzes", {
    method: "POST",
    token: context.token,
    idempotencyKey: "quiz-create-retry-0000000001",
    body: {
      ...quizBody,
      question: {
        ...quizBody.question,
        prompt: "الماء يتجمد عند الصفر.",
      },
    },
  });
  assert.equal(reusedQuizKey.response.status, 409);
  assert.equal(reusedQuizKey.payload.error.code, "IDEMPOTENCY_KEY_REUSED");
});

test("lost reset responses replay atomically without clearing intervening answers", async () => {
  const pool = new TransactionalFakePool();
  const context = await setupHandler(pool, "مشرف إعادة الترتيب");
  const added = await api(context.handler, "/api/students", {
    method: "POST",
    token: context.token,
    body: studentBody({ id: "student-reset-retry" }),
  });
  assert.equal(added.response.status, 201);
  const created = await api(context.handler, "/api/quizzes", {
    method: "POST",
    token: context.token,
    idempotencyKey: "quiz-before-reset-retry-0001",
    body: {
      expectedCurrentQuizId: null,
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
  const credentials = studentBody();
  delete credentials.id;

  async function accessAndSubmit() {
    const challenge = await api(
      context.handler,
      `/api/quizzes/${created.payload.quizId}/access/challenge`,
      { method: "POST", body: credentials }
    );
    assert.equal(challenge.response.status, 200);
    const access = await api(
      context.handler,
      `/api/quizzes/${created.payload.quizId}/access`,
      {
        method: "POST",
        body: {
          ...credentials,
          challengeToken: challenge.payload.token,
          challengeCounter: solveChallenge(
            challenge.payload.token,
            challenge.payload.difficultyBits
          ),
        },
      }
    );
    assert.equal(access.response.status, 200);
    const submission = await api(
      context.handler,
      `/api/quizzes/${created.payload.quizId}/submissions`,
      {
        method: "POST",
        bearer: access.payload.token,
        body: { answer: "صح" },
      }
    );
    assert.equal(submission.response.status, 200);
    return submission.payload.result.entry.id;
  }

  await accessAndSubmit();
  const resetRequest = {
    method: "POST",
    token: context.token,
    idempotencyKey: "reset-round-1-lost-response-0001",
    body: { expectedRound: 1 },
  };
  const committedButLost = await api(
    context.handler,
    `/api/quizzes/${created.payload.quizId}/leaderboard/reset`,
    resetRequest
  );
  assert.equal(committedButLost.response.status, 200);

  const interveningSubmissionId = await accessAndSubmit();
  const replay = await api(
    context.handler,
    `/api/quizzes/${created.payload.quizId}/leaderboard/reset`,
    resetRequest
  );
  assert.equal(replay.response.status, 200);
  assert.deepEqual(replay.payload, committedButLost.payload);
  assert.equal(replay.payload.round, 2);

  const quiz = pool.state.quizzes[created.payload.quizId];
  assert.equal(quiz.round, 2);
  assert.deepEqual(
    quiz.submissions.map((submission) => submission.id),
    [interveningSubmissionId]
  );
  assert.deepEqual(
    quiz.answerRecords.map((record) => record.round),
    [1, 2]
  );
  assert.equal(quiz.resetRequests.length, 1);
});

test("retains only a bounded number of completed reset records", async () => {
  const pool = new TransactionalFakePool();
  const context = await setupHandler(pool, "مشرف سجل الإعادات");
  await api(context.handler, "/api/students", {
    method: "POST",
    token: context.token,
    body: studentBody({ id: "student-reset-bound" }),
  });
  const created = await api(context.handler, "/api/quizzes", {
    method: "POST",
    token: context.token,
    body: {
      expectedCurrentQuizId: null,
      question: {
        type: "boolean",
        prompt: "الماء يتجمد عند الصفر.",
        options: ["صح", "خطأ"],
        correctAnswer: "صح",
      },
      students: [],
    },
  });
  assert.equal(created.response.status, 201);

  for (let expectedRound = 1; expectedRound <= 40; expectedRound += 1) {
    const reset = await api(
      context.handler,
      `/api/quizzes/${created.payload.quizId}/leaderboard/reset`,
      {
        method: "POST",
        token: context.token,
        idempotencyKey: `bounded-reset-key-${String(expectedRound).padStart(4, "0")}`,
        body: { expectedRound },
      }
    );
    assert.equal(reset.response.status, 200);
    assert.equal(reset.payload.round, expectedRound + 1);
  }

  const quiz = pool.state.quizzes[created.payload.quizId];
  assert.equal(quiz.round, 41);
  assert.ok(quiz.resetRequests.length > 0);
  assert.ok(quiz.resetRequests.length <= 32);
  assert.equal(quiz.resetRequests.at(-1).response.round, 41);
});

test("concurrent stale publishers conflict and the winner supersedes the old link", async () => {
  const pool = new TransactionalFakePool();
  const first = await setupHandler(pool, "المشرف الأول");
  const secondPassword = "second-supervisor-password";
  const secondName = "المشرف الثاني";
  const addedSupervisor = await api(
    first.handler,
    "/api/admin/supervisors",
    {
      method: "POST",
      token: first.token,
      body: { displayName: secondName, password: secondPassword },
    }
  );
  assert.equal(addedSupervisor.response.status, 201);
  const secondHandler = createHandler(pool);
  const secondLogin = await api(secondHandler, "/api/admin/login", {
    method: "POST",
    body: { displayName: secondName, password: secondPassword },
  });
  assert.equal(secondLogin.response.status, 200);
  await api(first.handler, "/api/students", {
    method: "POST",
    token: first.token,
    body: studentBody({ id: "student-publish-race" }),
  });
  const baselineBody = {
    expectedCurrentQuizId: null,
    question: {
      type: "boolean",
      prompt: "الأرض تدور حول الشمس.",
      options: ["صح", "خطأ"],
      correctAnswer: "صح",
    },
    students: [],
  };
  const baseline = await api(first.handler, "/api/quizzes", {
    method: "POST",
    token: first.token,
    idempotencyKey: "baseline-publish-key-00000001",
    body: baselineBody,
  });
  assert.equal(baseline.response.status, 201);

  const attempts = [
    {
      handler: first.handler,
      token: first.token,
      key: "concurrent-publisher-one-00001",
      body: {
        expectedCurrentQuizId: baseline.payload.quizId,
        question: {
          type: "boolean",
          prompt: "السماء زرقاء في النهار.",
          options: ["صح", "خطأ"],
          correctAnswer: "صح",
        },
        students: [],
      },
    },
    {
      handler: secondHandler,
      token: secondLogin.payload.token,
      key: "concurrent-publisher-two-00002",
      body: {
        expectedCurrentQuizId: baseline.payload.quizId,
        question: {
          type: "boolean",
          prompt: "الشمس تدور حول الأرض.",
          options: ["صح", "خطأ"],
          correctAnswer: "خطأ",
        },
        students: [],
      },
    },
  ];
  const results = await Promise.all(
    attempts.map((attempt) =>
      api(attempt.handler, "/api/quizzes", {
        method: "POST",
        token: attempt.token,
        idempotencyKey: attempt.key,
        body: attempt.body,
      })
    )
  );
  assert.deepEqual(
    results.map(({ response }) => response.status).sort(),
    [201, 409]
  );
  const winningIndex = results.findIndex(
    ({ response }) => response.status === 201
  );
  const winner = results[winningIndex];
  const conflict = results.find(({ response }) => response.status === 409);
  assert.equal(conflict.payload.error.code, "QUIZ_PUBLISH_CONFLICT");
  assert.match(conflict.payload.error.message, /سؤال آخر|حدّث/);
  assert.equal(pool.state.activeQuizId, winner.payload.quizId);
  assert.equal(
    pool.state.quizzes[baseline.payload.quizId].supersededBy,
    winner.payload.quizId
  );
  assert.equal(Object.keys(pool.state.quizzes).length, 2);

  const winnerReplay = await api(
    attempts[winningIndex].handler,
    "/api/quizzes",
    {
      method: "POST",
      token: attempts[winningIndex].token,
      idempotencyKey: attempts[winningIndex].key,
      body: attempts[winningIndex].body,
    }
  );
  assert.equal(winnerReplay.response.status, 201);
  assert.equal(winnerReplay.payload.quizId, winner.payload.quizId);

  const superseded = await api(
    first.handler,
    `/api/quizzes/${baseline.payload.quizId}`
  );
  assert.equal(superseded.response.status, 410);
  assert.equal(superseded.payload.error.code, "QUIZ_SUPERSEDED");
});

test("student proof replay uses the proof table and only one state update", async () => {
  const pool = new TransactionalFakePool();
  const firstInstance = createHandler(pool);
  const secondInstance = createHandler(pool);
  const setup = await api(firstInstance, "/api/admin/setup", {
    method: "POST",
    body: {
      displayName: "مشرف Netlify",
      password: "secure-test-password",
      setupKey: SETUP_KEY,
    },
  });
  assert.equal(setup.response.status, 201);
  const supervisorToken = setup.payload.token;
  const added = await api(firstInstance, "/api/students", {
    method: "POST",
    token: supervisorToken,
    body: studentBody({ id: "student-netlify-a" }),
  });
  assert.equal(added.response.status, 201);
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

  const credentials = studentBody();
  delete credentials.id;
  const challenge = await api(
    firstInstance,
    `/api/quizzes/${created.payload.quizId}/access/challenge`,
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
  const proofEventStart = pool.events.length;
  const proofRace = await Promise.all([
    api(firstInstance, `/api/quizzes/${created.payload.quizId}/access`, {
      method: "POST",
      body: proofBody,
    }),
    api(secondInstance, `/api/quizzes/${created.payload.quizId}/access`, {
      method: "POST",
      body: proofBody,
    }),
  ]);
  assert.deepEqual(
    proofRace.map(({ response }) => response.status).sort(),
    [200, 409]
  );
  assert.equal(
    proofRace.find(({ response }) => response.status === 409).payload.error.code,
    "ACCESS_PROOF_REPLAYED"
  );
  assert.equal(pool.proofs.size, 1);
  assert.deepEqual(pool.state.consumedProofs, {});

  const proofEvents = pool.events.slice(proofEventStart);
  assert.equal(
    proofEvents.filter(
      (event) =>
        event.type === "pool-query" &&
        event.sql.includes("INSERT INTO baynat_consumed_proofs")
    ).length,
    2
  );
  const successful = proofRace.find(
    ({ response }) => response.status === 200
  );
  const submission = await api(
    secondInstance,
    `/api/quizzes/${created.payload.quizId}/submissions`,
    {
      method: "POST",
      bearer: successful.payload.token,
      body: { answer: "صح" },
    }
  );
  assert.equal(submission.response.status, 200);
  assert.equal(submission.payload.result.entry.isCorrect, true);
});

test("configured database no longer requires BAYNAT_SETUP_KEY", async () => {
  const pool = new TransactionalFakePool();
  const configured = await setupHandler(pool, "مشرف الإعداد");
  assert.ok(configured.token);

  const restarted = createHandler(pool, { setupKey: "" });
  const health = await api(restarted, "/api/health");
  const status = await api(restarted, "/api/admin/status");
  assert.equal(health.response.status, 200);
  assert.equal(status.response.status, 200);
  assert.equal(status.payload.configured, true);
  assert.equal(pool.state.setupKey, null);
});
