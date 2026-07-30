import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createBaynatServer } from "../server.js";

async function listen(dataFile) {
  const { server } = await createBaynatServer({ dataFile });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function close(server) {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json();
  return { response, payload };
}

test("shares one server-backed quiz across independent student sessions", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "baynat-server-"));
  const dataFile = path.join(directory, "baynat.json");
  const firstRun = await listen(dataFile);
  context.after(async () => {
    if (firstRun.server.listening) await close(firstRun.server);
    await rm(directory, { recursive: true, force: true });
  });

  const studentPage = await fetch(`${firstRun.baseUrl}/student.html`);
  assert.equal(studentPage.status, 200);
  assert.match(await studentPage.text(), /بوابة الطالب/);
  for (const privatePath of ["/.data/baynat.json", "/.git/config", "/server.js"]) {
    const privateResponse = await fetch(`${firstRun.baseUrl}${privatePath}`);
    assert.equal(privateResponse.status, 404);
  }

  await assert.rejects(
    createBaynatServer({ dataFile }),
    /شغّل نسخة واحدة فقط/
  );

  const created = await request(firstRun.baseUrl, "/api/quizzes", {
    method: "POST",
    body: JSON.stringify({
      question: {
        type: "multiple",
        prompt: "أي كوكب يُعرف بالكوكب الأحمر؟",
        options: ["الزهرة", "المريخ", "عطارد"],
        correctAnswer: "المريخ",
      },
      students: [
        { id: "student-sarah", name: "سارة القحطاني", className: "٢ / أ", pin: "4821" },
        { id: "student-omar", name: "عمر الحربي", className: "٢ / أ", pin: "7350" },
      ],
    }),
  });

  assert.equal(created.response.status, 201);
  assert.match(created.payload.studentPath, /^\/student\.html\?q=/);
  assert.ok(created.payload.adminToken);
  const { quizId, adminToken } = created.payload;

  const publicQuiz = await request(firstRun.baseUrl, `/api/quizzes/${quizId}`);
  assert.equal(publicQuiz.response.status, 200);
  assert.equal(publicQuiz.payload.quiz.question.prompt, "أي كوكب يُعرف بالكوكب الأحمر؟");
  assert.equal("correctAnswer" in publicQuiz.payload.quiz.question, false);
  assert.equal(JSON.stringify(publicQuiz.payload).includes("4821"), false);
  assert.equal(JSON.stringify(publicQuiz.payload).includes("سارة"), false);

  const rejectedAccess = await request(firstRun.baseUrl, `/api/quizzes/${quizId}/access`, {
    method: "POST",
    body: JSON.stringify({ pin: "0000" }),
  });
  assert.equal(rejectedAccess.response.status, 401);
  assert.equal(rejectedAccess.payload.error.code, "PIN_REJECTED");

  const sarahAccess = await request(firstRun.baseUrl, `/api/quizzes/${quizId}/access`, {
    method: "POST",
    body: JSON.stringify({ pin: "4821" }),
  });
  assert.equal(sarahAccess.response.status, 200);
  assert.equal(sarahAccess.payload.student.name, "سارة القحطاني");
  assert.equal(sarahAccess.payload.result, null);

  const earlyLeaderboard = await request(
    firstRun.baseUrl,
    `/api/quizzes/${quizId}/leaderboard`,
    { headers: { Authorization: `Bearer ${sarahAccess.payload.token}` } }
  );
  assert.equal(earlyLeaderboard.response.status, 403);
  assert.equal(earlyLeaderboard.payload.error.code, "ANSWER_REQUIRED");

  await new Promise((resolve) => setTimeout(resolve, 35));
  const sarahSubmission = await request(
    firstRun.baseUrl,
    `/api/quizzes/${quizId}/submissions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${sarahAccess.payload.token}` },
      body: JSON.stringify({ answer: "المريخ", elapsedMs: 8_200 }),
    }
  );
  assert.equal(sarahSubmission.response.status, 200);
  assert.equal(sarahSubmission.payload.result.entry.isCorrect, true);
  assert.equal(sarahSubmission.payload.result.entry.rank, 1);
  assert.ok(sarahSubmission.payload.result.entry.total > 100);
  assert.ok(sarahSubmission.payload.result.entry.elapsedMs >= 25);

  const omarAccess = await request(firstRun.baseUrl, `/api/quizzes/${quizId}/access`, {
    method: "POST",
    body: JSON.stringify({ pin: "7350" }),
  });
  const omarSubmission = await request(
    firstRun.baseUrl,
    `/api/quizzes/${quizId}/submissions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${omarAccess.payload.token}` },
      body: JSON.stringify({ answer: "المريخ", elapsedMs: 14_900 }),
    }
  );
  assert.equal(omarSubmission.response.status, 200);
  assert.deepEqual(
    omarSubmission.payload.result.leaderboard.map((entry) => [entry.student.name, entry.rank]),
    [
      ["عمر الحربي", 1],
      ["سارة القحطاني", 2],
    ]
  );

  const duplicate = await request(firstRun.baseUrl, `/api/quizzes/${quizId}/submissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${sarahAccess.payload.token}` },
    body: JSON.stringify({ answer: "عطارد", elapsedMs: 100 }),
  });
  assert.equal(duplicate.payload.result.entry.id, sarahSubmission.payload.result.entry.id);
  assert.equal(duplicate.payload.result.entry.isCorrect, true);

  const addedStudent = await request(firstRun.baseUrl, `/api/quizzes/${quizId}/students`, {
    method: "POST",
    headers: { "X-Admin-Token": adminToken },
    body: JSON.stringify({
      id: "student-reem",
      name: "ريم السبيعي",
      className: "٢ / ج",
      pin: "2468",
    }),
  });
  assert.equal(addedStudent.response.status, 201);
  assert.equal(addedStudent.payload.student.name, "ريم السبيعي");

  const reemAccess = await request(firstRun.baseUrl, `/api/quizzes/${quizId}/access`, {
    method: "POST",
    body: JSON.stringify({ pin: "2468" }),
  });
  assert.equal(reemAccess.response.status, 200);
  assert.equal(reemAccess.payload.student.id, "student-reem");

  const adminSnapshot = await request(firstRun.baseUrl, `/api/quizzes/${quizId}/admin`, {
    headers: { "X-Admin-Token": adminToken },
  });
  assert.equal(adminSnapshot.response.status, 200);
  assert.equal(adminSnapshot.payload.quiz.students.length, 3);
  assert.equal(adminSnapshot.payload.quiz.submissions.length, 2);
  assert.equal(adminSnapshot.payload.quiz.leaderboard[0].student.name, "عمر الحربي");

  await close(firstRun.server);
  const secondRun = await listen(dataFile);
  context.after(async () => {
    if (secondRun.server.listening) await close(secondRun.server);
  });
  const persisted = await request(secondRun.baseUrl, `/api/quizzes/${quizId}/admin`, {
    headers: { "X-Admin-Token": adminToken },
  });
  assert.equal(persisted.response.status, 200);
  assert.equal(persisted.payload.quiz.submissions.length, 2);
  assert.equal(persisted.payload.quiz.students.length, 3);
});

test("rejects duplicate PINs and unauthorized admin access", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "baynat-security-"));
  const dataFile = path.join(directory, "baynat.json");
  const { server, baseUrl } = await listen(dataFile);
  context.after(async () => {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  });

  const duplicateRoster = await request(baseUrl, "/api/quizzes", {
    method: "POST",
    body: JSON.stringify({
      question: {
        type: "boolean",
        prompt: "الشمس نجم يمد الأرض بالضوء.",
        options: ["صح", "خطأ"],
        correctAnswer: "صح",
      },
      students: [
        { name: "سارة القحطاني", className: "٢ / أ", pin: "4821" },
        { name: "ريم السبيعي", className: "٢ / ج", pin: "4821" },
      ],
    }),
  });
  assert.equal(duplicateRoster.response.status, 400);
  assert.equal(duplicateRoster.payload.error.code, "INVALID_STUDENT");

  const created = await request(baseUrl, "/api/quizzes", {
    method: "POST",
    body: JSON.stringify({
      question: {
        type: "boolean",
        prompt: "الشمس نجم يمد الأرض بالضوء.",
        options: ["صح", "خطأ"],
        correctAnswer: "صح",
      },
      students: [{ name: "سارة القحطاني", className: "٢ / أ", pin: "4821" }],
    }),
  });
  const unauthorized = await request(
    baseUrl,
    `/api/quizzes/${created.payload.quizId}/admin`,
    { headers: { "X-Admin-Token": "wrong-token" } }
  );
  assert.equal(unauthorized.response.status, 401);
  assert.equal(unauthorized.payload.error.code, "ADMIN_UNAUTHORIZED");

  for (let attempt = 0; attempt < 22; attempt += 1) {
    const validAccess = await request(
      baseUrl,
      `/api/quizzes/${created.payload.quizId}/access`,
      {
        method: "POST",
        body: JSON.stringify({ pin: "4821" }),
      }
    );
    assert.equal(validAccess.response.status, 200);
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const failedAccess = await request(
      baseUrl,
      `/api/quizzes/${created.payload.quizId}/access`,
      {
        method: "POST",
        headers: { "X-Forwarded-For": `198.51.100.${attempt + 1}` },
        body: JSON.stringify({ pin: "0000" }),
      }
    );
    assert.equal(failedAccess.response.status, 401);
  }
  const rateLimited = await request(
    baseUrl,
    `/api/quizzes/${created.payload.quizId}/access`,
    {
      method: "POST",
      headers: { "X-Forwarded-For": "203.0.113.250" },
      body: JSON.stringify({ pin: "0000" }),
    }
  );
  assert.equal(rateLimited.response.status, 429);
  assert.equal(rateLimited.payload.error.code, "TOO_MANY_ATTEMPTS");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const invalidCreation = await request(baseUrl, "/api/quizzes", {
      method: "POST",
      body: JSON.stringify({}),
    });
    assert.equal(invalidCreation.response.status, 400);
  }
  const creationLimited = await request(baseUrl, "/api/quizzes", {
    method: "POST",
    body: JSON.stringify({}),
  });
  assert.equal(creationLimited.response.status, 429);
  assert.equal(creationLimited.payload.error.code, "QUIZ_CREATION_LIMIT");
});

test("never acknowledges a submission that failed to persist", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "baynat-transaction-"));
  const dataDirectory = path.join(directory, "data");
  const backupDirectory = path.join(directory, "data-backup");
  const dataFile = path.join(dataDirectory, "baynat.json");
  const firstRun = await listen(dataFile);
  context.after(async () => {
    if (firstRun.server.listening) await close(firstRun.server);
    await rm(directory, { recursive: true, force: true });
  });

  const created = await request(firstRun.baseUrl, "/api/quizzes", {
    method: "POST",
    body: JSON.stringify({
      question: {
        type: "boolean",
        prompt: "الماء يتجمّد عند الصفر.",
        options: ["صح", "خطأ"],
        correctAnswer: "صح",
      },
      students: [{ name: "سارة القحطاني", className: "٢ / أ", pin: "4821" }],
    }),
  });
  const { quizId, adminToken } = created.payload;
  const access = await request(firstRun.baseUrl, `/api/quizzes/${quizId}/access`, {
    method: "POST",
    body: JSON.stringify({ pin: "4821" }),
  });

  await rename(dataDirectory, backupDirectory);
  await writeFile(dataDirectory, "blocks the data directory");
  const failedSubmission = await request(
    firstRun.baseUrl,
    `/api/quizzes/${quizId}/submissions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${access.payload.token}` },
      body: JSON.stringify({ answer: "صح" }),
    }
  );
  assert.equal(failedSubmission.response.status, 500);

  await rm(dataDirectory, { force: true });
  await rename(backupDirectory, dataDirectory);
  const retriedSubmission = await request(
    firstRun.baseUrl,
    `/api/quizzes/${quizId}/submissions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${access.payload.token}` },
      body: JSON.stringify({ answer: "صح" }),
    }
  );
  assert.equal(retriedSubmission.response.status, 200);

  await close(firstRun.server);
  const secondRun = await listen(dataFile);
  context.after(async () => {
    if (secondRun.server.listening) await close(secondRun.server);
  });
  const persisted = await request(secondRun.baseUrl, `/api/quizzes/${quizId}/admin`, {
    headers: { "X-Admin-Token": adminToken },
  });
  assert.equal(persisted.payload.quiz.submissions.length, 1);
});

test("refuses to overwrite unsupported database files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "baynat-schema-"));
  const dataFile = path.join(directory, "baynat.json");
  const unsupported = '{"version":999,"important":"keep-me"}\n';
  await mkdir(directory, { recursive: true });
  await writeFile(dataFile, unsupported);
  try {
    await assert.rejects(
      createBaynatServer({ dataFile }),
      /إصدار ملف بيانات بَيّنات غير مدعوم/
    );
    assert.equal(await readFile(dataFile, "utf8"), unsupported);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
