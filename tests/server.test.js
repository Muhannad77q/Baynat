import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createBaynatServer } from "../server.js";

const supervisorTokens = new Map();
const TEST_SUPERVISOR_PASSWORD = "baynat-test-admin";
const TEST_SUPERVISOR_NAME = "مشرف الاختبار";

async function listen(dataFile) {
  const { server, store } = await createBaynatServer({
    dataFile,
    accessDifficultyBits: 8,
    supervisorDifficultyBits: 8,
    logger: { error() {} },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const status = await fetch(`${baseUrl}/api/admin/status`).then((response) => response.json());
  const authentication = await fetch(
    `${baseUrl}/api/admin/${status.configured ? "login" : "setup"}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName:
          store.data.supervisors[0]?.displayName || TEST_SUPERVISOR_NAME,
        password: TEST_SUPERVISOR_PASSWORD,
        setupKey: store.data.setupKey,
      }),
    }
  ).then((response) => response.json());
  supervisorTokens.set(baseUrl, authentication.token);
  return {
    server,
    baseUrl,
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
      ...(supervisorTokens.get(baseUrl)
        ? { "X-Supervisor-Token": supervisorTokens.get(baseUrl) }
        : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json();
  return { response, payload };
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
  throw new Error("Challenge could not be solved");
}

async function createStudentProof(baseUrl, quizId, credentials) {
  const completeCredentials = {
    halaqa: "غير محدد",
    ...credentials,
  };
  const challenge = await request(
    baseUrl,
    `/api/quizzes/${quizId}/access/challenge`,
    {
      method: "POST",
      body: JSON.stringify(completeCredentials),
    }
  );
  assert.equal(challenge.response.status, 200);
  return {
    token: challenge.payload.token,
    counter: solveChallenge(
      challenge.payload.token,
      challenge.payload.difficultyBits
    ),
  };
}

async function accessStudent(baseUrl, quizId, credentials) {
  const proof = await createStudentProof(baseUrl, quizId, credentials);
  return accessStudentWithProof(baseUrl, quizId, credentials, proof);
}

async function accessStudentWithProof(baseUrl, quizId, credentials, proof) {
  const completeCredentials = {
    halaqa: "غير محدد",
    ...credentials,
  };
  return request(baseUrl, `/api/quizzes/${quizId}/access`, {
    method: "POST",
    body: JSON.stringify({
      ...completeCredentials,
      challengeToken: proof.token,
      challengeCounter: proof.counter,
    }),
  });
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
  const supervisorSession = await request(
    firstRun.baseUrl,
    "/api/admin/session"
  );
  assert.equal(
    supervisorSession.payload.supervisor.displayName,
    TEST_SUPERVISOR_NAME
  );

  await assert.rejects(
    createBaynatServer({ dataFile }),
    /ملف بيانات بَيّنات مقفول/
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
        {
          id: "student-sarah",
          name: "سارة القحطاني",
          className: "أولى ثانوي",
          halaqa: "زكاء",
          pin: "4821",
        },
        {
          id: "student-omar",
          name: "عمر الحربي",
          className: "ثاني ثانوي",
          halaqa: "سواعد",
          pin: "7350",
        },
      ],
    }),
  });

  assert.equal(created.response.status, 201);
  assert.match(created.payload.studentPath, /^\/student\.html\?q=/);
  assert.ok(created.payload.adminToken);
  const { quizId, adminToken } = created.payload;

  const publicQuiz = await request(firstRun.baseUrl, `/api/quizzes/${quizId}`);
  assert.equal(publicQuiz.response.status, 200);
  assert.deepEqual(publicQuiz.payload.quiz.question, { type: "multiple" });
  assert.equal(JSON.stringify(publicQuiz.payload).includes("الكوكب الأحمر"), false);
  assert.equal(JSON.stringify(publicQuiz.payload).includes("المريخ"), false);
  assert.equal(JSON.stringify(publicQuiz.payload).includes("4821"), false);
  assert.equal(JSON.stringify(publicQuiz.payload).includes("سارة"), false);
  assert.deepEqual(publicQuiz.payload.quiz.accessOptions, [
    { className: "أولى ثانوي", halaqas: ["زكاء", "سواعد"] },
    { className: "ثاني ثانوي", halaqas: ["زكاء", "سواعد"] },
    { className: "ثالث ثانوي", halaqas: ["زكاء", "سواعد"] },
  ]);

  const rejectedAccess = await accessStudent(firstRun.baseUrl, quizId, {
    name: "سارة القحطاني",
    className: "أولى ثانوي",
    halaqa: "زكاء",
    pin: "0000",
  });
  assert.equal(rejectedAccess.response.status, 401);
  assert.equal(rejectedAccess.payload.error.code, "PIN_REJECTED");

  const sarahCredentials = {
    name: "سارة القحطاني",
    className: "أولى ثانوي",
    halaqa: "زكاء",
    pin: "4821",
  };
  const sarahProof = await createStudentProof(
    firstRun.baseUrl,
    quizId,
    sarahCredentials
  );
  const firstSarahAccess = await accessStudentWithProof(
    firstRun.baseUrl,
    quizId,
    sarahCredentials,
    sarahProof
  );
  assert.equal(firstSarahAccess.response.status, 200);
  const replayedSarahProof = await accessStudentWithProof(
    firstRun.baseUrl,
    quizId,
    sarahCredentials,
    sarahProof
  );
  assert.equal(replayedSarahProof.response.status, 409);
  assert.equal(
    replayedSarahProof.payload.error.code,
    "ACCESS_PROOF_REPLAYED"
  );
  const sarahAccess = await accessStudent(
    firstRun.baseUrl,
    quizId,
    sarahCredentials
  );
  assert.equal(sarahAccess.response.status, 200);
  assert.equal(sarahAccess.payload.student.name, "سارة القحطاني");
  assert.equal(
    sarahAccess.payload.question.prompt,
    "أي كوكب يُعرف بالكوكب الأحمر؟"
  );
  assert.equal(sarahAccess.payload.result, null);
  const participantSummary = await request(firstRun.baseUrl, `/api/quizzes/${quizId}`);
  assert.equal(participantSummary.payload.quiz.participantCount, 1);

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

  const omarCredentials = {
    name: "عمر الحربي",
    className: "ثاني ثانوي",
    halaqa: "سواعد",
    pin: "7350",
  };
  const omarProof = await createStudentProof(
    firstRun.baseUrl,
    quizId,
    omarCredentials
  );
  const concurrentOmarAccess = await Promise.all([
    accessStudentWithProof(firstRun.baseUrl, quizId, omarCredentials, omarProof),
    accessStudentWithProof(firstRun.baseUrl, quizId, omarCredentials, omarProof),
  ]);
  assert.deepEqual(
    concurrentOmarAccess.map((result) => result.response.status).sort(),
    [200, 409]
  );
  const omarAccess = concurrentOmarAccess.find(
    (result) => result.response.status === 200
  );
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

  const addStudentRequest = () =>
    request(firstRun.baseUrl, "/api/students", {
      method: "POST",
      body: JSON.stringify({
        id: "student-reem",
        name: "ريم السبيعي",
        className: "أولى ثانوي",
        halaqa: "زكاء",
        pin: "2468",
      }),
    });
  const concurrentAdds = await Promise.all([addStudentRequest(), addStudentRequest()]);
  assert.deepEqual(
    concurrentAdds.map((result) => result.response.status).sort(),
    [201, 409]
  );
  assert.equal(
    concurrentAdds.find((result) => result.response.status === 201).payload.student.name,
    "ريم السبيعي"
  );

  const sharedRoster = await request(firstRun.baseUrl, "/api/students");
  assert.equal(sharedRoster.response.status, 200);
  assert.equal(sharedRoster.payload.students.length, 3);
  assert.equal(JSON.stringify(sharedRoster.payload).includes("pinHash"), false);
  const rejectedRosterSelection = await request(firstRun.baseUrl, "/api/students", {
    method: "POST",
    body: JSON.stringify({
      name: "طالب غير معتمد",
      className: "رابع ثانوي",
      halaqa: "حلقة أخرى",
      pin: "9999",
    }),
  });
  assert.equal(rejectedRosterSelection.response.status, 400);
  assert.equal(rejectedRosterSelection.payload.error.code, "INVALID_STUDENT_CLASS");
  const addedSupervisor = await request(
    firstRun.baseUrl,
    "/api/admin/supervisors",
    {
      method: "POST",
      body: JSON.stringify({
        displayName: "المشرف المساعد",
        password: "assistant-password",
      }),
    }
  );
  assert.equal(addedSupervisor.response.status, 201);
  const secondSupervisorLogin = await fetch(`${firstRun.baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      displayName: "المشرف المساعد",
      password: "assistant-password",
    }),
  }).then((response) => response.json());
  const secondSupervisorRoster = await fetch(`${firstRun.baseUrl}/api/students`, {
    headers: { "X-Supervisor-Token": secondSupervisorLogin.token },
  }).then((response) => response.json());
  assert.deepEqual(secondSupervisorRoster.students, sharedRoster.payload.students);
  const secondSupervisorDashboard = await fetch(
    `${firstRun.baseUrl}/api/admin/dashboard`,
    {
      headers: { "X-Supervisor-Token": secondSupervisorLogin.token },
    }
  ).then((response) => response.json());
  assert.equal(secondSupervisorDashboard.quiz.id, quizId);
  const secondSupervisorSnapshot = await fetch(
    `${firstRun.baseUrl}/api/quizzes/${quizId}/admin`,
    {
      headers: { "X-Supervisor-Token": secondSupervisorLogin.token },
    }
  );
  assert.equal(secondSupervisorSnapshot.status, 200);
  const reemSessionBeforeEdit = await accessStudent(firstRun.baseUrl, quizId, {
    name: "ريم السبيعي",
    className: "أولى ثانوي",
    halaqa: "زكاء",
    pin: "2468",
  });
  assert.equal(reemSessionBeforeEdit.response.status, 200);
  const editedReem = await request(firstRun.baseUrl, "/api/students/student-reem", {
    method: "PATCH",
    body: JSON.stringify({
      name: "ريم السبيعي",
      className: "ثالث ثانوي",
      halaqa: "سواعد",
      pin: "8642",
    }),
  });
  assert.equal(editedReem.response.status, 200);
  assert.equal(editedReem.payload.student.className, "ثالث ثانوي");
  const revokedReemSession = await request(
    firstRun.baseUrl,
    `/api/quizzes/${quizId}/submissions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${reemSessionBeforeEdit.payload.token}`,
      },
      body: JSON.stringify({ answer: "المريخ" }),
    }
  );
  assert.equal(revokedReemSession.response.status, 401);

  const oldReemAccess = await accessStudent(firstRun.baseUrl, quizId, {
    name: "ريم السبيعي",
    className: "أولى ثانوي",
    halaqa: "زكاء",
    pin: "2468",
  });
  assert.equal(oldReemAccess.response.status, 401);
  const oldReemPin = await accessStudent(firstRun.baseUrl, quizId, {
    name: "ريم السبيعي",
    className: "ثالث ثانوي",
    halaqa: "سواعد",
    pin: "2468",
  });
  assert.equal(oldReemPin.response.status, 401);
  const reemAccess = await accessStudent(firstRun.baseUrl, quizId, {
    name: "ريم السبيعي",
    className: "ثالث ثانوي",
    halaqa: "سواعد",
    pin: "8642",
  });
  assert.equal(reemAccess.response.status, 200);
  assert.equal(reemAccess.payload.student.id, "student-reem");

  const concurrentSubmissions = await Promise.all(
    Array.from({ length: 8 }, () =>
      request(firstRun.baseUrl, `/api/quizzes/${quizId}/submissions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${reemAccess.payload.token}` },
        body: JSON.stringify({ answer: "المريخ" }),
      })
    )
  );
  assert.ok(concurrentSubmissions.every((result) => result.response.status === 200));
  assert.equal(
    new Set(
      concurrentSubmissions.map((result) => result.payload.result.entry.id)
    ).size,
    1
  );

  const adminSnapshot = await request(firstRun.baseUrl, `/api/quizzes/${quizId}/admin`, {
    headers: { "X-Admin-Token": adminToken },
  });
  assert.equal(adminSnapshot.response.status, 200);
  assert.equal(adminSnapshot.payload.quiz.students.length, 3);
  assert.equal(adminSnapshot.payload.quiz.submissions.length, 3);
  assert.equal(adminSnapshot.payload.quiz.participants.length, 3);
  assert.equal(adminSnapshot.payload.quiz.answerRecords.length, 3);
  assert.ok(adminSnapshot.payload.quiz.participationRecords.length >= 4);
  assert.equal(adminSnapshot.payload.quiz.round, 1);
  assert.equal(adminSnapshot.payload.quiz.leaderboard.length, 3);

  await close(firstRun.server);
  const secondRun = await listen(dataFile);
  context.after(async () => {
    if (secondRun.server.listening) await close(secondRun.server);
  });
  const persisted = await request(secondRun.baseUrl, `/api/quizzes/${quizId}/admin`, {
    headers: { "X-Admin-Token": adminToken },
  });
  assert.equal(persisted.response.status, 200);
  assert.equal(persisted.payload.quiz.submissions.length, 3);
  assert.equal(persisted.payload.quiz.students.length, 3);
  const persistedRoster = await request(secondRun.baseUrl, "/api/students");
  assert.equal(persistedRoster.payload.students.length, 3);
  assert.equal(
    persistedRoster.payload.students.find((student) => student.id === "student-reem").halaqa,
    "سواعد"
  );
});

test("resets participant and answer records so students can answer again", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "baynat-reset-"));
  const dataFile = path.join(directory, "baynat.json");
  const { server, baseUrl } = await listen(dataFile);
  context.after(async () => {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  });

  const created = await request(baseUrl, "/api/quizzes", {
    method: "POST",
    body: JSON.stringify({
      question: {
        type: "boolean",
        prompt: "الأرض تدور حول الشمس.",
        options: ["صح", "خطأ"],
        correctAnswer: "صح",
      },
      students: [
        {
          id: "student-reset",
          name: "هند محمد",
          className: "ثالث ثانوي",
          halaqa: "زكاء",
          pin: "4312",
        },
      ],
    }),
  });
  const credentials = {
    name: "هند محمد",
    className: "ثالث ثانوي",
    halaqa: "زكاء",
    pin: "4312",
  };
  const firstAccess = await accessStudent(baseUrl, created.payload.quizId, credentials);
  const firstSubmission = await request(
    baseUrl,
    `/api/quizzes/${created.payload.quizId}/submissions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${firstAccess.payload.token}` },
      body: JSON.stringify({ answer: "صح" }),
    }
  );
  assert.equal(firstSubmission.response.status, 200);

  const reset = await request(
    baseUrl,
    `/api/quizzes/${created.payload.quizId}/leaderboard/reset`,
    {
      method: "POST",
      headers: { "X-Admin-Token": created.payload.adminToken },
    }
  );
  assert.equal(reset.response.status, 200);
  assert.deepEqual(reset.payload.cleared, { submissions: 1, participants: 1 });
  assert.deepEqual(reset.payload.recordsPreserved, {
    answers: 1,
    participations: 1,
  });
  const snapshot = await request(
    baseUrl,
    `/api/quizzes/${created.payload.quizId}/admin`,
    { headers: { "X-Admin-Token": created.payload.adminToken } }
  );
  assert.deepEqual(snapshot.payload.quiz.submissions, []);
  assert.deepEqual(snapshot.payload.quiz.participants, []);
  assert.equal(snapshot.payload.quiz.answerRecords.length, 1);
  assert.equal(snapshot.payload.quiz.participationRecords.length, 1);
  assert.equal(snapshot.payload.quiz.round, 2);

  const staleSession = await request(
    baseUrl,
    `/api/quizzes/${created.payload.quizId}/submissions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${firstAccess.payload.token}` },
      body: JSON.stringify({ answer: "صح" }),
    }
  );
  assert.equal(staleSession.response.status, 401);
  const secondAccess = await accessStudent(baseUrl, created.payload.quizId, credentials);
  const secondSubmission = await request(
    baseUrl,
    `/api/quizzes/${created.payload.quizId}/submissions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${secondAccess.payload.token}` },
      body: JSON.stringify({ answer: "صح" }),
    }
  );
  assert.equal(secondSubmission.response.status, 200);
  const historyAfterRetry = await request(
    baseUrl,
    `/api/quizzes/${created.payload.quizId}/admin`,
    { headers: { "X-Admin-Token": created.payload.adminToken } }
  );
  assert.deepEqual(
    historyAfterRetry.payload.quiz.answerRecords.map((record) => record.round),
    [1, 2]
  );
});

test("revalidates in-flight access and submissions against edits and resets", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "baynat-race-"));
  const dataFile = path.join(directory, "baynat.json");
  const { server, baseUrl } = await listen(dataFile);
  context.after(async () => {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  });
  const created = await request(baseUrl, "/api/quizzes", {
    method: "POST",
    body: JSON.stringify({
      question: {
        type: "boolean",
        prompt: "الأرض تدور حول الشمس.",
        options: ["صح", "خطأ"],
        correctAnswer: "صح",
      },
      students: [
        {
          id: "student-race",
          name: "نورة علي",
          className: "أولى ثانوي",
          halaqa: "زكاء",
          pin: "1122",
        },
      ],
    }),
  });
  const oldCredentials = {
    name: "نورة علي",
    className: "أولى ثانوي",
    halaqa: "زكاء",
    pin: "1122",
  };
  const oldProof = await createStudentProof(
    baseUrl,
    created.payload.quizId,
    oldCredentials
  );
  const [racingAccess, edit] = await Promise.all([
    accessStudentWithProof(
      baseUrl,
      created.payload.quizId,
      oldCredentials,
      oldProof
    ),
    request(baseUrl, "/api/students/student-race", {
      method: "PATCH",
      body: JSON.stringify({
        name: "نورة علي",
        className: "ثاني ثانوي",
        halaqa: "سواعد",
        pin: "3344",
      }),
    }),
  ]);
  assert.equal(edit.response.status, 200);
  assert.ok([200, 401, 409].includes(racingAccess.response.status));
  if (racingAccess.response.status === 200) {
    const staleSubmission = await request(
      baseUrl,
      `/api/quizzes/${created.payload.quizId}/submissions`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${racingAccess.payload.token}` },
        body: JSON.stringify({ answer: "صح" }),
      }
    );
    assert.equal(staleSubmission.response.status, 401);
  }

  const currentAccess = await accessStudent(baseUrl, created.payload.quizId, {
    name: "نورة علي",
    className: "ثاني ثانوي",
    halaqa: "سواعد",
    pin: "3344",
  });
  assert.equal(currentAccess.response.status, 200);
  const [racingSubmission, reset] = await Promise.all([
    request(baseUrl, `/api/quizzes/${created.payload.quizId}/submissions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${currentAccess.payload.token}` },
      body: JSON.stringify({ answer: "صح" }),
    }),
    request(
      baseUrl,
      `/api/quizzes/${created.payload.quizId}/leaderboard/reset`,
      {
        method: "POST",
        headers: { "X-Admin-Token": created.payload.adminToken },
      }
    ),
  ]);
  assert.equal(reset.response.status, 200);
  assert.ok([200, 401].includes(racingSubmission.response.status));
  const snapshot = await request(
    baseUrl,
    `/api/quizzes/${created.payload.quizId}/admin`,
    { headers: { "X-Admin-Token": created.payload.adminToken } }
  );
  assert.deepEqual(snapshot.payload.quiz.submissions, []);
  assert.equal(snapshot.payload.quiz.round, 2);
});

test("rejects duplicate PINs while allowing namesakes with distinct codes", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "baynat-security-"));
  const dataFile = path.join(directory, "baynat.json");
  const { server, baseUrl } = await listen(dataFile);
  context.after(async () => {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  });

  const unauthenticatedCreation = await fetch(`${baseUrl}/api/quizzes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(unauthenticatedCreation.status, 401);

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

  const namesakeRoster = await request(baseUrl, "/api/quizzes", {
    method: "POST",
    body: JSON.stringify({
      question: {
        type: "boolean",
        prompt: "الشمس نجم يمد الأرض بالضوء.",
        options: ["صح", "خطأ"],
        correctAnswer: "صح",
      },
      students: [
        { name: "أحمد علي", className: "٢ / أ", pin: "1111" },
        { name: "احمد علي", className: "٢ / أ", pin: "2222" },
      ],
    }),
  });
  assert.equal(namesakeRoster.response.status, 201);
  const firstNamesake = await accessStudent(
    baseUrl,
    namesakeRoster.payload.quizId,
    { name: "أحمد علي", className: "٢ / أ", pin: "1111" }
  );
  const secondNamesake = await accessStudent(
    baseUrl,
    namesakeRoster.payload.quizId,
    { name: "احمد علي", className: "٢ / أ", pin: "2222" }
  );
  assert.equal(firstNamesake.response.status, 200);
  assert.equal(secondNamesake.response.status, 200);
  assert.notEqual(firstNamesake.payload.student.id, secondNamesake.payload.student.id);

  const sarahRosterEntry = await request(baseUrl, "/api/students", {
    method: "POST",
    body: JSON.stringify({
      id: "student-sarah",
      name: "سارة القحطاني",
      className: "أولى ثانوي",
      halaqa: "زكاء",
      pin: "4821",
    }),
  });
  const omarRosterEntry = await request(baseUrl, "/api/students", {
    method: "POST",
    body: JSON.stringify({
      id: "student-omar",
      name: "عمر الحربي",
      className: "ثاني ثانوي",
      halaqa: "سواعد",
      pin: "7350",
    }),
  });
  assert.equal(sarahRosterEntry.response.status, 201);
  assert.equal(omarRosterEntry.response.status, 201);

  const created = await request(baseUrl, "/api/quizzes", {
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
        { name: "عمر الحربي", className: "٢ / أ", pin: "7350" },
        { name: "أحمد علي", className: "٢ / أ", pin: "1111" },
        { name: "أحمد علي", className: "٢ / ب", pin: "2222" },
      ],
    }),
  });
  const unauthorized = await fetch(
    `${baseUrl}/api/quizzes/${created.payload.quizId}/admin`,
    { headers: { "X-Admin-Token": "wrong-token" } }
  );
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).error.code, "ADMIN_UNAUTHORIZED");

  const sarahCredentials = {
    name: "سارة القحطاني",
    className: "أولى ثانوي",
    halaqa: "زكاء",
    pin: "4821",
  };
  const boundProof = await createStudentProof(
    baseUrl,
    created.payload.quizId,
    sarahCredentials
  );
  const changedCredential = await request(
    baseUrl,
    `/api/quizzes/${created.payload.quizId}/access`,
    {
      method: "POST",
      body: JSON.stringify({
        ...sarahCredentials,
        pin: "0000",
        challengeToken: boundProof.token,
        challengeCounter: boundProof.counter,
      }),
    }
  );
  assert.equal(changedCredential.response.status, 400);
  assert.equal(changedCredential.payload.error.code, "INVALID_ACCESS_PROOF");

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const failedAccess = await accessStudent(baseUrl, created.payload.quizId, {
      name: "سارة القحطاني",
      className: "أولى ثانوي",
      halaqa: "زكاء",
      pin: String(attempt).padStart(4, "0"),
    });
    assert.equal(failedAccess.response.status, 401);
  }
  const correctAfterFailures = await accessStudent(
    baseUrl,
    created.payload.quizId,
    sarahCredentials
  );
  assert.equal(correctAfterFailures.response.status, 200);

  const sameNetworkStudent = await accessStudent(baseUrl, created.payload.quizId, {
    name: "عمر الحربي",
    className: "ثاني ثانوي",
    halaqa: "سواعد",
    pin: "7350",
  });
  assert.equal(sameNetworkStudent.response.status, 200);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const invalidCreation = await request(baseUrl, "/api/quizzes", {
      method: "POST",
      body: JSON.stringify({}),
    });
    assert.equal(invalidCreation.response.status, 400);
  }

  const validQuizBody = JSON.stringify({
    question: {
      type: "boolean",
      prompt: "الأرض تدور حول الشمس.",
      options: ["صح", "خطأ"],
      correctAnswer: "صح",
    },
    students: [{ name: "عمر الحربي", className: "٢ / أ", pin: "7350" }],
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const allowedCreation = await request(baseUrl, "/api/quizzes", {
      method: "POST",
      body: validQuizBody,
    });
    assert.equal(allowedCreation.response.status, 201);
  }
  const creationLimited = await request(baseUrl, "/api/quizzes", {
    method: "POST",
    body: validQuizBody,
  });
  assert.equal(creationLimited.response.status, 429);
  assert.equal(creationLimited.payload.error.code, "QUIZ_CREATION_LIMIT");
});

test("requires the server bootstrap key and rate-limits supervisor login", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "baynat-supervisor-"));
  const dataFile = path.join(directory, "baynat.json");
  const setupKey = "bootstrap-key-for-tests";
  const { server } = await createBaynatServer({
    dataFile,
    setupKey,
    accessDifficultyBits: 8,
    supervisorDifficultyBits: 8,
    logger: { error() {} },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  context.after(async () => {
    if (server.listening) await close(server);
    await rm(directory, { recursive: true, force: true });
  });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const attackerSetup = await request(baseUrl, "/api/admin/setup", {
      method: "POST",
      body: JSON.stringify({
        displayName: TEST_SUPERVISOR_NAME,
        setupKey: "wrong-bootstrap-key",
        password: "attacker-password",
      }),
    });
    assert.equal(attackerSetup.response.status, 401);
    assert.equal(attackerSetup.payload.error.code, "SETUP_KEY_REJECTED");
  }

  const configured = await request(baseUrl, "/api/admin/setup", {
    method: "POST",
    body: JSON.stringify({
      displayName: TEST_SUPERVISOR_NAME,
      setupKey,
      password: TEST_SUPERVISOR_PASSWORD,
    }),
  });
  assert.equal(configured.response.status, 201);
  assert.ok(configured.payload.token);

  const takeover = await request(baseUrl, "/api/admin/setup", {
    method: "POST",
    body: JSON.stringify({
      displayName: "مشرف آخر",
      setupKey,
      password: "another-password",
    }),
  });
  assert.notEqual(takeover.response.status, 201);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const rejectedLogin = await request(baseUrl, "/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        displayName: TEST_SUPERVISOR_NAME,
        password: "wrong-password",
      }),
    });
    assert.equal(rejectedLogin.response.status, 401);
  }
  const limitedLogin = await request(baseUrl, "/api/admin/login", {
    method: "POST",
    body: JSON.stringify({
      displayName: TEST_SUPERVISOR_NAME,
      password: "wrong-password",
    }),
  });
  assert.equal(limitedLogin.response.status, 429);
  assert.equal(limitedLogin.payload.error.code, "SUPERVISOR_PROOF_REQUIRED");
  assert.ok(limitedLogin.payload.error.details.challengeToken);

  const legitimateStepUp = await request(baseUrl, "/api/admin/login", {
    method: "POST",
    body: JSON.stringify({
      displayName: TEST_SUPERVISOR_NAME,
      password: TEST_SUPERVISOR_PASSWORD,
    }),
  });
  assert.equal(legitimateStepUp.response.status, 429);
  assert.equal(
    legitimateStepUp.payload.error.code,
    "SUPERVISOR_PROOF_REQUIRED"
  );
  const { challengeToken, difficultyBits } =
    legitimateStepUp.payload.error.details;
  const legitimateLogin = await request(baseUrl, "/api/admin/login", {
    method: "POST",
    body: JSON.stringify({
      displayName: TEST_SUPERVISOR_NAME,
      password: TEST_SUPERVISOR_PASSWORD,
      challengeToken,
      challengeCounter: solveChallenge(challengeToken, difficultyBits),
    }),
  });
  assert.equal(legitimateLogin.response.status, 200);
  assert.ok(legitimateLogin.payload.token);

  const burst = await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      request(baseUrl, "/api/admin/login", {
        method: "POST",
        body: JSON.stringify({
          displayName: TEST_SUPERVISOR_NAME,
          password: `wrong-burst-${index}`,
        }),
      })
    )
  );
  const burstStatuses = burst.map((result) => result.response.status);
  assert.equal(burstStatuses.filter((status) => status === 401).length, 10);
  assert.equal(burstStatuses.filter((status) => status === 429).length, 14);
  assert.ok(
    burst
      .filter((result) => result.response.status === 429)
      .every(
        (result) =>
          result.payload.error.code === "SUPERVISOR_PROOF_REQUIRED" &&
          result.payload.error.details.challengeToken
      )
  );

  const postBurstStepUp = await request(baseUrl, "/api/admin/login", {
    method: "POST",
    body: JSON.stringify({
      displayName: TEST_SUPERVISOR_NAME,
      password: TEST_SUPERVISOR_PASSWORD,
    }),
  });
  assert.equal(postBurstStepUp.response.status, 429);
  const postBurstChallenge = postBurstStepUp.payload.error.details;
  const postBurstLogin = await request(baseUrl, "/api/admin/login", {
    method: "POST",
    body: JSON.stringify({
      displayName: TEST_SUPERVISOR_NAME,
      password: TEST_SUPERVISOR_PASSWORD,
      challengeToken: postBurstChallenge.challengeToken,
      challengeCounter: solveChallenge(
        postBurstChallenge.challengeToken,
        postBurstChallenge.difficultyBits
      ),
    }),
  });
  assert.equal(postBurstLogin.response.status, 200);
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
  const access = await accessStudent(firstRun.baseUrl, quizId, {
    name: "سارة القحطاني",
    className: "٢ / أ",
    pin: "4821",
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

test("migrates legacy rooms onto the 31-day expiration policy", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "baynat-expiry-"));
  const dataFile = path.join(directory, "baynat.json");
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
        prompt: "السماء زرقاء في النهار.",
        options: ["صح", "خطأ"],
        correctAnswer: "صح",
      },
      students: [{ name: "سارة القحطاني", className: "٢ / أ", pin: "4821" }],
    }),
  });
  await close(firstRun.server);

  const stored = JSON.parse(await readFile(dataFile, "utf8"));
  const legacyQuiz = stored.quizzes[created.payload.quizId];
  const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  legacyQuiz.createdAt = fortyDaysAgo;
  legacyQuiz.question.createdAt = fortyDaysAgo;
  delete legacyQuiz.expiresAt;
  await writeFile(dataFile, `${JSON.stringify(stored, null, 2)}\n`);

  const secondRun = await listen(dataFile);
  context.after(async () => {
    if (secondRun.server.listening) await close(secondRun.server);
  });
  const expired = await request(
    secondRun.baseUrl,
    `/api/quizzes/${created.payload.quizId}`
  );
  assert.equal(expired.response.status, 410);
  assert.equal(expired.payload.error.code, "QUIZ_EXPIRED");
  const migrated = JSON.parse(await readFile(dataFile, "utf8"));
  assert.ok(migrated.quizzes[created.payload.quizId].expiresAt);
});

test("migrates the legacy supervisor credential into a named account", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "baynat-supervisor-migration-"));
  const dataFile = path.join(directory, "baynat.json");
  const firstRun = await listen(dataFile);
  await close(firstRun.server);

  const legacy = JSON.parse(await readFile(dataFile, "utf8"));
  legacy.version = 1;
  legacy.adminCredential = legacy.supervisors[0].credential;
  legacy.setupKey = null;
  delete legacy.supervisors;
  await writeFile(dataFile, `${JSON.stringify(legacy, null, 2)}\n`);

  const { server, store } = await createBaynatServer({
    dataFile,
    accessDifficultyBits: 8,
    supervisorDifficultyBits: 8,
    logger: { error() {} },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  context.after(async () => {
    if (server.listening) await close(server);
    await rm(directory, { recursive: true, force: true });
  });

  assert.equal(store.data.version, 2);
  assert.equal(store.data.supervisors.length, 1);
  assert.equal(store.data.supervisors[0].displayName, "المشرف الرئيسي");
  assert.equal(Object.hasOwn(store.data, "adminCredential"), false);

  const login = await request(baseUrl, "/api/admin/login", {
    method: "POST",
    body: JSON.stringify({
      displayName: "المشرف الرئيسي",
      password: TEST_SUPERVISOR_PASSWORD,
    }),
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.payload.supervisor.displayName, "المشرف الرئيسي");
});

test("derives a legacy shared roster from the latest room only", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "baynat-roster-migration-"));
  const dataFile = path.join(directory, "baynat.json");
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
        prompt: "الأرض تدور حول الشمس.",
        options: ["صح", "خطأ"],
        correctAnswer: "صح",
      },
      students: [
        {
          id: "latest-student",
          name: "هند محمد",
          className: "ثاني ثانوي",
          halaqa: "سواعد",
          pin: "1357",
        },
      ],
    }),
  });
  await close(firstRun.server);

  const stored = JSON.parse(await readFile(dataFile, "utf8"));
  const latestQuiz = stored.quizzes[created.payload.quizId];
  const oldQuiz = structuredClone(latestQuiz);
  oldQuiz.id = "legacy-old-room";
  oldQuiz.question.id = "question-legacy-old-room";
  oldQuiz.students = Array.from({ length: 80 }, (_, index) => ({
    ...structuredClone(latestQuiz.students[0]),
    id: `historical-student-${index}`,
  }));
  oldQuiz.createdAt = new Date(Date.now() - 60_000).toISOString();
  oldQuiz.updatedAt = oldQuiz.createdAt;
  stored.quizzes = {
    [oldQuiz.id]: oldQuiz,
    [created.payload.quizId]: latestQuiz,
  };
  delete stored.students;
  await writeFile(dataFile, `${JSON.stringify(stored, null, 2)}\n`);

  const secondRun = await listen(dataFile);
  context.after(async () => {
    if (secondRun.server.listening) await close(secondRun.server);
  });
  const roster = await request(secondRun.baseUrl, "/api/students");
  assert.deepEqual(
    roster.payload.students.map((student) => student.id),
    ["latest-student"]
  );
});

test("migrates legacy namesakes without rejecting the stored classroom", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "baynat-namesakes-"));
  const dataFile = path.join(directory, "baynat.json");
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
        prompt: "الأرض تدور حول الشمس.",
        options: ["صح", "خطأ"],
        correctAnswer: "صح",
      },
      students: [
        { id: "student-ahmad-1", name: "أحمد علي", className: "٢ / أ", pin: "1111" },
        { id: "student-ahmad-2", name: "احمد علي", className: "٢ / أ", pin: "2222" },
      ],
    }),
  });
  assert.equal(created.response.status, 201);
  await close(firstRun.server);

  const stored = JSON.parse(await readFile(dataFile, "utf8"));
  const legacyStudents = stored.quizzes[created.payload.quizId].students;
  legacyStudents.forEach((student) => {
    delete student.identityLookup;
    delete student.halaqa;
  });
  stored.students.forEach((student) => {
    delete student.identityLookup;
    delete student.halaqa;
  });
  await writeFile(dataFile, `${JSON.stringify(stored, null, 2)}\n`);

  const secondRun = await listen(dataFile);
  context.after(async () => {
    if (secondRun.server.listening) await close(secondRun.server);
  });
  const migrated = JSON.parse(await readFile(dataFile, "utf8"));
  const migratedStudents = migrated.quizzes[created.payload.quizId].students;
  assert.equal(migratedStudents[0].identityLookup, migratedStudents[1].identityLookup);
  assert.equal(migratedStudents[0].halaqa, "غير محدد");
  assert.equal(migrated.students.length, 2);

  const firstAccess = await accessStudent(
    secondRun.baseUrl,
    created.payload.quizId,
    { name: "أحمد علي", className: "٢ / أ", pin: "1111" }
  );
  const secondAccess = await accessStudent(
    secondRun.baseUrl,
    created.payload.quizId,
    { name: "احمد علي", className: "٢ / أ", pin: "2222" }
  );
  assert.equal(firstAccess.response.status, 200);
  assert.equal(secondAccess.response.status, 200);
  assert.equal(firstAccess.payload.student.id, "student-ahmad-1");
  assert.equal(secondAccess.payload.student.id, "student-ahmad-2");
});

test("uses strong production proof difficulty defaults and floors", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "baynat-proof-config-"));
  const dataFile = path.join(directory, "baynat.json");
  const { server, store } = await createBaynatServer({
    dataFile,
    logger: { error() {} },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  context.after(async () => {
    if (server.listening) await close(server);
    await rm(directory, { recursive: true, force: true });
  });

  const setup = await request(baseUrl, "/api/admin/setup", {
    method: "POST",
    body: JSON.stringify({
      displayName: TEST_SUPERVISOR_NAME,
      setupKey: store.data.setupKey,
      password: TEST_SUPERVISOR_PASSWORD,
    }),
  });
  supervisorTokens.set(baseUrl, setup.payload.token);
  const created = await request(baseUrl, "/api/quizzes", {
    method: "POST",
    body: JSON.stringify({
      question: {
        type: "short",
        prompt: "ما عاصمة المملكة العربية السعودية؟",
        options: [],
        correctAnswer: "الرياض",
      },
      students: [
        { name: "سارة القحطاني", className: "٢ / أ", pin: "4821" },
      ],
    }),
  });
  const challenge = await request(
    baseUrl,
    `/api/quizzes/${created.payload.quizId}/access/challenge`,
    {
      method: "POST",
      body: JSON.stringify({
        name: "سارة القحطاني",
        className: "٢ / أ",
        halaqa: "غير محدد",
        pin: "4821",
      }),
    }
  );
  assert.equal(challenge.response.status, 200);
  assert.equal(challenge.payload.difficultyBits, 20);

  await assert.rejects(
    createBaynatServer({
      dataFile: path.join(directory, "weak-student.json"),
      accessDifficultyBits: 19,
      supervisorDifficultyBits: 16,
      nodeEnvironment: "production",
    }),
    /BAYNAT_ACCESS_DIFFICULTY/
  );
  await assert.rejects(
    createBaynatServer({
      dataFile: path.join(directory, "weak-supervisor.json"),
      accessDifficultyBits: 20,
      supervisorDifficultyBits: 15,
      nodeEnvironment: "production",
    }),
    /BAYNAT_SUPERVISOR_DIFFICULTY/
  );
});

test("refuses to overwrite unsupported database files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "baynat-schema-"));
  const dataFile = path.join(directory, "baynat.json");
  await mkdir(directory, { recursive: true });
  try {
    for (const unsupported of [
      '{"version":999,"important":"keep-me"}\n',
      '{"version":1,"secret":"123456789012345678901234","quizzes":[]}\n',
    ]) {
      await writeFile(dataFile, unsupported);
      await assert.rejects(
        createBaynatServer({ dataFile }),
        /إصدار أو بنية ملف بيانات بَيّنات غير مدعومة/
      );
      assert.equal(await readFile(dataFile, "utf8"), unsupported);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
