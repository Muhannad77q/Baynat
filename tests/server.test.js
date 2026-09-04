import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createBaynatServer,
  validateStoredData,
} from "../server.js";

const supervisorTokens = new Map();
const TEST_SUPERVISOR_PASSWORD = "baynat-test-admin";
const TEST_SUPERVISOR_NAME = "مشرف الاختبار";

async function listen(dataFile, options = {}) {
  const { server, store } = await createBaynatServer({
    dataFile,
    accessDifficultyBits: 8,
    supervisorDifficultyBits: 8,
    logger: { error() {} },
    ...options,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const status = await fetch(`${baseUrl}/api/admin/status`).then((response) =>
    response.json()
  );
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
  return { server, store, baseUrl };
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}

async function request(
  baseUrl,
  pathname,
  { body, withSupervisor = true, ...options } = {}
) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(withSupervisor && supervisorTokens.get(baseUrl)
        ? { "X-Supervisor-Token": supervisorTokens.get(baseUrl) }
        : {}),
      ...(options.headers || {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { response, payload: await response.json() };
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

async function createStudentProof(baseUrl, quizId, pin) {
  const challenge = await request(
    baseUrl,
    `/api/quizzes/${quizId}/access/challenge`,
    {
      method: "POST",
      withSupervisor: false,
      body: { pin },
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

async function accessStudentWithProof(baseUrl, quizId, pin, proof) {
  return request(baseUrl, `/api/quizzes/${quizId}/access`, {
    method: "POST",
    withSupervisor: false,
    body: {
      pin,
      challengeToken: proof.token,
      challengeCounter: proof.counter,
    },
  });
}

async function accessStudent(baseUrl, quizId, pin) {
  return accessStudentWithProof(
    baseUrl,
    quizId,
    pin,
    await createStudentProof(baseUrl, quizId, pin)
  );
}

const booleanQuestion = (prompt = "الأرض تدور حول الشمس.") => ({
  type: "boolean",
  prompt,
  correctAnswer: "صح",
});

const multipleQuestion = () => ({
  type: "multiple",
  prompt: "أي كوكب يُعرف بالكوكب الأحمر؟",
  options: ["الزهرة", "المريخ", "عطارد"],
  correctAnswer: "المريخ",
});

const shortQuestion = () => ({
  type: "short",
  prompt: "اذكر فائدة واحدة للقراءة اليومية.",
});

async function createQuiz(baseUrl, {
  question = booleanQuestion(),
  students = [
    {
      id: "student-sarah",
      name: "سارة القحطاني",
      className: "أولى ثانوي",
      pin: "4821",
    },
  ],
  expectedCurrentQuizId = null,
  idempotencyKey,
  legacy = false,
} = {}) {
  return request(baseUrl, "/api/quizzes", {
    method: "POST",
    headers: idempotencyKey
      ? { "Idempotency-Key": idempotencyKey }
      : {},
    body: {
      expectedCurrentQuizId,
      ...(legacy ? { question } : { questions: [question] }),
      students,
    },
  });
}

async function appendQuestion(baseUrl, quizId, question, idempotencyKey) {
  return request(baseUrl, `/api/quizzes/${quizId}/questions`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: { question },
  });
}

async function submit(baseUrl, quizId, token, questionId, answer) {
  return request(baseUrl, `/api/quizzes/${quizId}/submissions`, {
    method: "POST",
    withSupervisor: false,
    headers: { Authorization: `Bearer ${token}` },
    body: { questionId, answer },
  });
}

test("idempotently migrates v2 rooms, students, submissions, and credentials to v3", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "baynat-v2-migration-"));
  const dataFile = path.join(directory, "baynat.json");
  const firstRun = await listen(dataFile);
  context.after(async () => {
    await close(firstRun.server);
    await rm(directory, { recursive: true, force: true });
  });

  const created = await createQuiz(firstRun.baseUrl, {
    question: multipleQuestion(),
  });
  assert.equal(created.response.status, 201);
  const access = await accessStudent(
    firstRun.baseUrl,
    created.payload.quizId,
    "4821"
  );
  const submitted = await submit(
    firstRun.baseUrl,
    created.payload.quizId,
    access.payload.token,
    created.payload.questionId,
    "المريخ"
  );
  assert.equal(submitted.response.status, 200);
  await close(firstRun.server);

  const v2 = JSON.parse(await readFile(dataFile, "utf8"));
  const quiz = v2.quizzes[created.payload.quizId];
  const preserved = {
    studentId: v2.students[0].id,
    pinSalt: v2.students[0].pinSalt,
    pinHash: v2.students[0].pinHash,
    pinLookup: v2.students[0].pinLookup,
    supervisorId: v2.supervisors[0].id,
    submissionId: quiz.submissions[0].id,
    answerRecordId: quiz.answerRecords[0].id,
    round: quiz.round,
    questionId: quiz.questions[0].id,
  };
  v2.version = 2;
  const legacyQuizScopedLookup = createHmac("sha256", v2.secret)
    .update(`${created.payload.quizId}:4821`)
    .digest("hex");
  preserved.pinLookup = legacyQuizScopedLookup;
  for (const student of [...v2.students, ...quiz.students]) {
    student.halaqa = "زكاء";
    student.identityLookup = "legacy-name-class-halaqa-lookup";
    student.pinLookup = legacyQuizScopedLookup;
  }
  quiz.question = quiz.questions[0];
  delete quiz.questions;
  const oldStart = Object.values(quiz.starts)[0];
  quiz.starts = { [preserved.studentId]: oldStart };
  for (const record of [...quiz.submissions, ...quiz.answerRecords]) {
    delete record.gradingStatus;
    delete record.gradedBy;
    delete record.gradedAt;
    delete record.gradeRevision;
    delete record.gradeHistory;
    delete record.round;
  }
  quiz.answerRecords[0].round = 1;
  const legacyShortQuiz = {
    ...structuredClone(quiz),
    id: "legacy-short-room",
    question: {
      id: "question-legacy-short",
      type: "short",
      prompt: "اذكر فائدة واحدة للقراءة اليومية.",
      options: [],
      correctAnswer: "تنمية المعرفة",
      createdAt: quiz.createdAt,
    },
    submissions: [],
    sessions: {},
    starts: {},
    participants: {},
    answerRecords: [],
    participationRecords: [],
    resetRequests: [],
    createdAt: new Date(
      new Date(quiz.createdAt).getTime() - 60_000
    ).toISOString(),
    updatedAt: new Date(
      new Date(quiz.createdAt).getTime() - 60_000
    ).toISOString(),
    supersededBy: quiz.id,
  };
  v2.quizzes[legacyShortQuiz.id] = legacyShortQuiz;
  await writeFile(dataFile, `${JSON.stringify(v2, null, 2)}\n`);

  const secondRun = await listen(dataFile);
  context.after(() => close(secondRun.server));
  const migrated = secondRun.store.data;
  const migratedQuiz = migrated.quizzes[created.payload.quizId];
  assert.equal(migrated.version, 3);
  assert.equal(migrated.supervisors[0].id, preserved.supervisorId);
  assert.equal(migrated.students[0].id, preserved.studentId);
  assert.equal(migrated.students[0].pinSalt, preserved.pinSalt);
  assert.equal(migrated.students[0].pinHash, preserved.pinHash);
  assert.equal(migrated.students[0].pinLookup, preserved.pinLookup);
  assert.equal(Object.hasOwn(migrated.students[0], "halaqa"), false);
  assert.notEqual(
    migrated.students[0].identityLookup,
    "legacy-name-class-halaqa-lookup"
  );
  assert.equal(migratedQuiz.questions.length, 1);
  assert.equal(migratedQuiz.questions[0].id, preserved.questionId);
  assert.equal(Object.hasOwn(migratedQuiz, "question"), false);
  assert.equal(migratedQuiz.submissions[0].id, preserved.submissionId);
  assert.equal(migratedQuiz.answerRecords[0].id, preserved.answerRecordId);
  assert.equal(migratedQuiz.round, preserved.round);
  assert.equal(migratedQuiz.submissions[0].gradingStatus, "graded");
  assert.equal(migratedQuiz.submissions[0].gradedBy, "automatic");
  assert.equal(migratedQuiz.submissions[0].round, preserved.round);
  assert.equal(
    Object.keys(migratedQuiz.starts)[0],
    `${preserved.round}:${preserved.studentId}:${preserved.questionId}`
  );
  assert.equal(
    Object.hasOwn(
      migrated.quizzes["legacy-short-room"].questions[0],
      "correctAnswer"
    ),
    false
  );
  const duplicateLegacyPin = await request(secondRun.baseUrl, "/api/students", {
    method: "POST",
    body: {
      name: "طالب آخر",
      className: "ثاني ثانوي",
      pin: "4821",
    },
  });
  assert.equal(duplicateLegacyPin.response.status, 409);
  assert.equal(duplicateLegacyPin.payload.error.code, "DUPLICATE_PIN");

  const secondValidation = validateStoredData(structuredClone(migrated), "");
  assert.equal(secondValidation.migrated, false);
});

test("uses a global no-halaqa roster and PIN-only proof-bound access", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "baynat-pin-access-"));
  const dataFile = path.join(directory, "baynat.json");
  const { server, baseUrl } = await listen(dataFile);
  context.after(async () => {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  });

  const added = await request(baseUrl, "/api/students", {
    method: "POST",
    body: {
      id: "student-pin-only",
      name: "سارة القحطاني",
      className: "أولى ثانوي",
      pin: "4821",
    },
  });
  assert.equal(added.response.status, 201);
  assert.deepEqual(added.payload.student, {
    id: "student-pin-only",
    name: "سارة القحطاني",
    className: "أولى ثانوي",
  });

  const duplicatePin = await request(baseUrl, "/api/students", {
    method: "POST",
    body: {
      id: "student-duplicate-pin",
      name: "ريم السبيعي",
      className: "ثاني ثانوي",
      pin: "4821",
    },
  });
  assert.equal(duplicatePin.response.status, 409);
  assert.equal(duplicatePin.payload.error.code, "DUPLICATE_PIN");

  const created = await createQuiz(baseUrl, { students: [] });
  assert.equal(created.response.status, 201);
  const publicQuiz = await request(
    baseUrl,
    `/api/quizzes/${created.payload.quizId}`,
    { withSupervisor: false }
  );
  assert.equal(publicQuiz.response.status, 200);
  assert.deepEqual(publicQuiz.payload.quiz.questions, [
    { id: created.payload.questionId, type: "boolean" },
  ]);
  const publicText = JSON.stringify(publicQuiz.payload);
  assert.equal(publicText.includes("correctAnswer"), false);
  assert.equal(publicText.includes("سارة"), false);
  assert.equal(publicText.includes("halaqa"), false);

  const rejected = await accessStudent(
    baseUrl,
    created.payload.quizId,
    "0000"
  );
  assert.equal(rejected.response.status, 401);
  assert.equal(rejected.payload.error.code, "PIN_REJECTED");
  assert.equal(/الاسم|الصف|الحلقة/.test(rejected.payload.error.message), false);

  const proof = await createStudentProof(
    baseUrl,
    created.payload.quizId,
    "٤٨٢١"
  );
  const raced = await Promise.all([
    accessStudentWithProof(baseUrl, created.payload.quizId, "٤٨٢١", proof),
    accessStudentWithProof(baseUrl, created.payload.quizId, "٤٨٢١", proof),
  ]);
  assert.deepEqual(
    raced.map(({ response }) => response.status).sort(),
    [200, 409]
  );
  assert.equal(
    raced.find(({ response }) => response.status === 409).payload.error.code,
    "ACCESS_PROOF_REPLAYED"
  );
  const access = raced.find(({ response }) => response.status === 200);
  assert.equal(access.payload.student.id, "student-pin-only");
  assert.equal(access.payload.question.id, created.payload.questionId);
  assert.deepEqual(access.payload.progress, {
    answeredCount: 0,
    totalQuestions: 1,
    remainingCount: 1,
    pendingCount: 0,
  });

  const resumed = await request(
    baseUrl,
    `/api/quizzes/${created.payload.quizId}/session`,
    {
      withSupervisor: false,
      headers: { Authorization: `Bearer ${access.payload.token}` },
    }
  );
  assert.equal(resumed.response.status, 200);
  assert.equal(resumed.payload.student.id, "student-pin-only");
  assert.equal(resumed.payload.question.id, created.payload.questionId);

  const edited = await request(
    baseUrl,
    "/api/students/student-pin-only",
    {
      method: "PATCH",
      body: {
        name: "سارة القحطاني",
        className: "ثاني ثانوي",
      },
    }
  );
  assert.equal(edited.response.status, 200);
  assert.equal(edited.payload.student.className, "ثاني ثانوي");
  const staleAfterEdit = await request(
    baseUrl,
    `/api/quizzes/${created.payload.quizId}/session`,
    {
      withSupervisor: false,
      headers: { Authorization: `Bearer ${access.payload.token}` },
    }
  );
  assert.equal(staleAfterEdit.response.status, 401);
  const accessAfterEdit = await accessStudent(
    baseUrl,
    created.payload.quizId,
    "4821"
  );
  assert.equal(accessAfterEdit.response.status, 200);
  assert.equal(accessAfterEdit.payload.student.className, "ثاني ثانوي");
  const deleted = await request(
    baseUrl,
    "/api/students/student-pin-only",
    { method: "DELETE" }
  );
  assert.equal(deleted.response.status, 200);
  const staleAfterDelete = await request(
    baseUrl,
    `/api/quizzes/${created.payload.quizId}/session`,
    {
      withSupervisor: false,
      headers: { Authorization: `Bearer ${accessAfterEdit.payload.token}` },
    }
  );
  assert.equal(staleAfterDelete.response.status, 401);
});

test("appends three ordered questions without changing the link, session, or prior score", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "baynat-multi-question-"));
  const dataFile = path.join(directory, "baynat.json");
  const { server, store, baseUrl } = await listen(dataFile);
  context.after(async () => {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  });

  const created = await createQuiz(baseUrl, {
    question: multipleQuestion(),
  });
  const { quizId, questionId: firstQuestionId, studentPath } = created.payload;
  const access = await accessStudent(baseUrl, quizId, "4821");
  const sessionHashesBefore = Object.keys(store.data.quizzes[quizId].sessions);
  const missingQuestionId = await request(
    baseUrl,
    `/api/quizzes/${quizId}/submissions`,
    {
      method: "POST",
      withSupervisor: false,
      headers: { Authorization: `Bearer ${access.payload.token}` },
      body: { answer: "المريخ" },
    }
  );
  assert.equal(missingQuestionId.response.status, 400);
  assert.equal(
    missingQuestionId.payload.error.code,
    "QUESTION_ID_REQUIRED"
  );
  const firstSubmission = await submit(
    baseUrl,
    quizId,
    access.payload.token,
    firstQuestionId,
    "المريخ"
  );
  assert.equal(firstSubmission.payload.result.submission.isCorrect, true);
  const firstRetry = await submit(
    baseUrl,
    quizId,
    access.payload.token,
    firstQuestionId,
    "عطارد"
  );
  assert.equal(
    firstRetry.payload.result.submission.id,
    firstSubmission.payload.result.submission.id
  );
  assert.equal(firstRetry.payload.result.submission.isCorrect, true);
  const beforeAppend = firstSubmission.payload.result.entry;

  const second = await appendQuestion(
    baseUrl,
    quizId,
    booleanQuestion("الماء يتجمد عند درجة الصفر."),
    "append-question-two-0001"
  );
  const third = await appendQuestion(
    baseUrl,
    quizId,
    {
      ...shortQuestion(),
      correctAnswer: "يجب حذف هذه الإجابة",
    },
    "append-question-three-0001"
  );
  assert.equal(second.response.status, 201);
  assert.equal(third.response.status, 201);
  assert.equal(second.payload.quiz.id, quizId);
  assert.equal(third.payload.quiz.id, quizId);
  assert.equal(third.payload.quiz.studentPath, studentPath);
  assert.deepEqual(
    third.payload.quiz.questions.map((question) => question.id),
    [firstQuestionId, second.payload.questionId, third.payload.questionId]
  );
  assert.equal(
    Object.hasOwn(third.payload.quiz.questions[2], "correctAnswer"),
    false
  );
  assert.deepEqual(
    Object.keys(store.data.quizzes[quizId].sessions),
    sessionHashesBefore
  );
  assert.equal(store.data.quizzes[quizId].submissions.length, 1);
  assert.equal(store.data.quizzes[quizId].participants["student-sarah"].sessionCount, 1);

  const afterAppendLeaderboard = await request(
    baseUrl,
    `/api/quizzes/${quizId}/leaderboard`,
    {
      withSupervisor: false,
      headers: { Authorization: `Bearer ${access.payload.token}` },
    }
  );
  assert.deepEqual(afterAppendLeaderboard.payload.leaderboard[0], beforeAppend);

  const resumed = await request(baseUrl, `/api/quizzes/${quizId}/session`, {
    withSupervisor: false,
    headers: { Authorization: `Bearer ${access.payload.token}` },
  });
  assert.equal(resumed.response.status, 200);
  assert.equal(resumed.payload.question.id, second.payload.questionId);
  assert.equal(resumed.payload.quiz.questionCount, 3);
  const secondStartKey = `1:student-sarah:${second.payload.questionId}`;
  assert.equal(
    Object.hasOwn(store.data.quizzes[quizId].starts, secondStartKey),
    false
  );
  const startedSecond = await request(
    baseUrl,
    `/api/quizzes/${quizId}/session`,
    {
      withSupervisor: false,
      headers: {
        Authorization: `Bearer ${access.payload.token}`,
        "X-Start-Question": "1",
      },
    }
  );
  assert.equal(startedSecond.response.status, 200);
  assert.equal(
    Object.hasOwn(store.data.quizzes[quizId].starts, secondStartKey),
    true
  );

  const secondSubmission = await submit(
    baseUrl,
    quizId,
    access.payload.token,
    second.payload.questionId,
    "صح"
  );
  assert.equal(
    secondSubmission.payload.result.nextQuestion.id,
    third.payload.questionId
  );
  const pending = await submit(
    baseUrl,
    quizId,
    access.payload.token,
    third.payload.questionId,
    "تنمية المعرفة"
  );
  assert.equal(pending.response.status, 200);
  assert.equal(pending.payload.result.submission.gradingStatus, "pending");
  assert.equal(pending.payload.result.submission.isCorrect, null);
  assert.equal(pending.payload.result.nextQuestion, null);
  assert.equal(pending.payload.result.completed, true);
  assert.equal(pending.payload.result.pending, true);
  assert.equal(pending.payload.result.status, "pending");
  assert.equal(Object.hasOwn(pending.payload.result, "suggestedAnswer"), false);
  assert.equal(
    JSON.stringify(pending.payload).includes("يجب حذف هذه الإجابة"),
    false
  );
  assert.equal(pending.payload.result.entry.answeredCount, 3);
  assert.equal(pending.payload.result.entry.correctCount, 2);
  assert.equal(pending.payload.result.entry.pendingCount, 1);

  const remembered = await request(baseUrl, `/api/quizzes/${quizId}/session`, {
    withSupervisor: false,
    headers: { Authorization: `Bearer ${access.payload.token}` },
  });
  assert.equal(remembered.response.status, 200);
  assert.equal(remembered.payload.completed, true);
  assert.equal(remembered.payload.pending, true);
  assert.equal(remembered.payload.leaderboard[0].total, pending.payload.result.entry.total);
});

test("manually grades and regrades short answers with deterministic speed places", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "baynat-grading-"));
  const dataFile = path.join(directory, "baynat.json");
  const { server, store, baseUrl } = await listen(dataFile);
  context.after(async () => {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  });

  const created = await createQuiz(baseUrl, {
    question: shortQuestion(),
    students: [
      {
        id: "student-slow",
        name: "سارة القحطاني",
        className: "أولى ثانوي",
        pin: "4821",
      },
      {
        id: "student-fast",
        name: "ريم السبيعي",
        className: "ثاني ثانوي",
        pin: "7350",
      },
    ],
  });
  const { quizId, questionId } = created.payload;
  const slowAccess = await accessStudent(baseUrl, quizId, "4821");
  const fastAccess = await accessStudent(baseUrl, quizId, "7350");
  const baseTime = Date.now();
  await store.update((data) => {
    const quiz = data.quizzes[quizId];
    quiz.starts[`1:student-slow:${questionId}`] = baseTime - 5_000;
    quiz.starts[`1:student-fast:${questionId}`] = baseTime - 1_000;
  });

  const slowPending = await submit(
    baseUrl,
    quizId,
    slowAccess.payload.token,
    questionId,
    "إجابة سارة"
  );
  const fastPending = await submit(
    baseUrl,
    quizId,
    fastAccess.payload.token,
    questionId,
    "إجابة ريم"
  );
  assert.equal(slowPending.payload.result.submission.gradingStatus, "pending");
  assert.equal(fastPending.payload.result.submission.gradingStatus, "pending");
  const slowSubmissionId = slowPending.payload.result.submission.id;
  const fastSubmissionId = fastPending.payload.result.submission.id;

  const unauthorized = await fetch(
    `${baseUrl}/api/quizzes/${quizId}/submissions/${slowSubmissionId}/grade`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Token": created.payload.adminToken,
      },
      body: JSON.stringify({ isCorrect: true }),
    }
  );
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).error.code, "SUPERVISOR_UNAUTHORIZED");

  const grade = (submissionId, isCorrect, key) =>
    request(
      baseUrl,
      `/api/quizzes/${quizId}/submissions/${submissionId}/grade`,
      {
        method: "PATCH",
        headers: { "Idempotency-Key": key },
        body: { isCorrect },
      }
    );
  const slowFirst = await grade(
    slowSubmissionId,
    true,
    "grade-slow-correct-0001"
  );
  const fastSecond = await grade(
    fastSubmissionId,
    true,
    "grade-fast-correct-0001"
  );
  assert.equal(slowFirst.response.status, 200);
  assert.equal(fastSecond.response.status, 200);
  const initialEntries = new Map(
    fastSecond.payload.quiz.leaderboard.map((entry) => [entry.student.id, entry])
  );
  assert.equal(initialEntries.get("student-fast").placePoints, 30);
  assert.equal(initialEntries.get("student-slow").placePoints, 20);
  const originalSlowScore = {
    accuracyPoints: initialEntries.get("student-slow").accuracyPoints,
    speedPoints: initialEntries.get("student-slow").speedPoints,
    placePoints: initialEntries.get("student-slow").placePoints,
    total: initialEntries.get("student-slow").total,
    elapsedMs: initialEntries.get("student-slow").elapsedMs,
  };

  await grade(slowSubmissionId, false, "regrade-slow-wrong-0001");
  const slowCorrectAgain = await grade(
    slowSubmissionId,
    true,
    "regrade-slow-correct-0002"
  );
  const restoredSlow = slowCorrectAgain.payload.quiz.leaderboard.find(
    (entry) => entry.student.id === "student-slow"
  );
  assert.deepEqual(
    {
      accuracyPoints: restoredSlow.accuracyPoints,
      speedPoints: restoredSlow.speedPoints,
      placePoints: restoredSlow.placePoints,
      total: restoredSlow.total,
      elapsedMs: restoredSlow.elapsedMs,
    },
    originalSlowScore
  );
  assert.equal(slowCorrectAgain.payload.submission.gradeRevision, 3);

  const concurrentRetry = await Promise.all([
    grade(fastSubmissionId, true, "grade-fast-retry-same-key"),
    grade(fastSubmissionId, true, "grade-fast-retry-same-key"),
  ]);
  assert.ok(
    concurrentRetry.every(({ response }) => response.status === 200)
  );
  const activeFast = store.data.quizzes[quizId].submissions.find(
    (submission) => submission.id === fastSubmissionId
  );
  const durableFast = store.data.quizzes[quizId].answerRecords.find(
    (record) => record.id === fastSubmissionId
  );
  assert.equal(activeFast.gradeRevision, 2);
  assert.equal(activeFast.gradeHistory.length, 2);
  assert.equal(durableFast.gradeRevision, 2);
  assert.deepEqual(durableFast.gradeHistory, activeFast.gradeHistory);
  assert.equal(activeFast.gradedBy, store.data.supervisors[0].id);
});

test("reset is the only quiz-wide scoring reset and preserves questions and immutable history", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "baynat-global-reset-"));
  const dataFile = path.join(directory, "baynat.json");
  const { server, store, baseUrl } = await listen(dataFile);
  context.after(async () => {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  });

  const created = await createQuiz(baseUrl);
  const second = await appendQuestion(
    baseUrl,
    created.payload.quizId,
    shortQuestion(),
    "reset-append-short-0001"
  );
  const access = await accessStudent(baseUrl, created.payload.quizId, "4821");
  await submit(
    baseUrl,
    created.payload.quizId,
    access.payload.token,
    created.payload.questionId,
    "صح"
  );
  const pending = await submit(
    baseUrl,
    created.payload.quizId,
    access.payload.token,
    second.payload.questionId,
    "تنمية المعرفة"
  );
  assert.equal(pending.payload.result.submission.gradingStatus, "pending");

  const resetRequest = {
    method: "POST",
    headers: { "Idempotency-Key": "global-reset-round-one-0001" },
    body: { expectedRound: 1 },
  };
  const firstReset = await request(
    baseUrl,
    `/api/quizzes/${created.payload.quizId}/leaderboard/reset`,
    resetRequest
  );
  assert.equal(firstReset.response.status, 409);
  assert.equal(firstReset.payload.error.code, "PENDING_GRADES");
  const graded = await request(
    baseUrl,
    `/api/quizzes/${created.payload.quizId}/submissions/${pending.payload.result.submission.id}/grade`,
    {
      method: "PATCH",
      headers: { "Idempotency-Key": "grade-before-reset-0001" },
      body: { isCorrect: true },
    }
  );
  assert.equal(graded.response.status, 200);
  const completedReset = await request(
    baseUrl,
    `/api/quizzes/${created.payload.quizId}/leaderboard/reset`,
    resetRequest
  );
  const replayedReset = await request(
    baseUrl,
    `/api/quizzes/${created.payload.quizId}/leaderboard/reset`,
    resetRequest
  );
  assert.equal(completedReset.response.status, 200);
  assert.deepEqual(replayedReset.payload, completedReset.payload);
  assert.equal(completedReset.payload.round, 2);
  assert.deepEqual(completedReset.payload.cleared, {
    submissions: 2,
    participants: 1,
  });
  assert.deepEqual(completedReset.payload.recordsPreserved, {
    answers: 2,
    participations: 1,
  });

  const quiz = store.data.quizzes[created.payload.quizId];
  assert.equal(quiz.questions.length, 2);
  assert.deepEqual(quiz.submissions, []);
  assert.deepEqual(quiz.sessions, {});
  assert.deepEqual(quiz.starts, {});
  assert.deepEqual(quiz.participants, {});
  assert.equal(quiz.answerRecords.length, 2);
  assert.equal(quiz.answerRecords[1].gradingStatus, "graded");

  const staleSession = await request(
    baseUrl,
    `/api/quizzes/${created.payload.quizId}/session`,
    {
      withSupervisor: false,
      headers: { Authorization: `Bearer ${access.payload.token}` },
    }
  );
  assert.equal(staleSession.response.status, 401);
  const staleSubmission = await submit(
    baseUrl,
    created.payload.quizId,
    access.payload.token,
    created.payload.questionId,
    "صح"
  );
  assert.equal(staleSubmission.response.status, 401);

  const nextRoundAccess = await accessStudent(
    baseUrl,
    created.payload.quizId,
    "4821"
  );
  assert.equal(nextRoundAccess.payload.quiz.round, 2);
  assert.equal(nextRoundAccess.payload.question.id, created.payload.questionId);
  await submit(
    baseUrl,
    created.payload.quizId,
    nextRoundAccess.payload.token,
    created.payload.questionId,
    "صح"
  );
  assert.deepEqual(
    store.data.quizzes[created.payload.quizId].answerRecords.map(
      (record) => record.round
    ),
    [1, 1, 2]
  );
});

test("deduplicates concurrent appends and prevents replacing the stable weekly link", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "baynat-append-races-"));
  const dataFile = path.join(directory, "baynat.json");
  const { server, store, baseUrl } = await listen(dataFile);
  context.after(async () => {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  });

  const created = await createQuiz(baseUrl, {
    idempotencyKey: "initial-weekly-quiz-0001",
  });
  const legacyCapabilityOnly = await request(
    baseUrl,
    `/api/quizzes/${created.payload.quizId}/admin`,
    {
      withSupervisor: false,
      headers: { "X-Admin-Token": created.payload.adminToken },
    }
  );
  assert.equal(legacyCapabilityOnly.response.status, 401);
  assert.equal(
    legacyCapabilityOnly.payload.error.code,
    "SUPERVISOR_UNAUTHORIZED"
  );
  const sameAppend = () =>
    appendQuestion(
      baseUrl,
      created.payload.quizId,
      booleanQuestion("السماء زرقاء في النهار."),
      "same-append-retry-key-0001"
    );
  const retries = await Promise.all(
    Array.from({ length: 8 }, () => sameAppend())
  );
  assert.ok(retries.every(({ response }) => response.status === 201));
  assert.equal(
    new Set(retries.map(({ payload }) => payload.questionId)).size,
    1
  );
  assert.equal(store.data.quizzes[created.payload.quizId].questions.length, 2);

  const concurrent = await Promise.all([
    appendQuestion(
      baseUrl,
      created.payload.quizId,
      booleanQuestion("الشمس نجم يمد الأرض بالضوء."),
      "different-append-key-a-0001"
    ),
    appendQuestion(
      baseUrl,
      created.payload.quizId,
      {
        type: "multiple",
        prompt: "اختر العدد الزوجي من الخيارات.",
        options: ["ثلاثة", "أربعة", "خمسة"],
        correctAnswer: "أربعة",
      },
      "different-append-key-b-0001"
    ),
  ]);
  assert.ok(concurrent.every(({ response }) => response.status === 201));
  assert.equal(store.data.quizzes[created.payload.quizId].questions.length, 4);

  const attemptedReplacement = await createQuiz(baseUrl, {
    question: booleanQuestion("الماء سائل في درجة حرارة الغرفة."),
    students: [],
    expectedCurrentQuizId: created.payload.quizId,
    idempotencyKey: "successor-weekly-quiz-0001",
    legacy: true,
  });
  assert.equal(attemptedReplacement.response.status, 409);
  assert.equal(attemptedReplacement.payload.error.code, "WEEK_ALREADY_ACTIVE");
  assert.equal(store.data.activeQuizId, created.payload.quizId);
  const continuedAppend = await appendQuestion(
    baseUrl,
    created.payload.quizId,
    shortQuestion(),
    "stale-append-key-0001"
  );
  assert.equal(continuedAppend.response.status, 201);
  assert.equal(store.data.quizzes[created.payload.quizId].questions.length, 5);
});

test("never acknowledges a multi-question submission that failed to persist", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "baynat-transaction-"));
  const dataDirectory = path.join(directory, "data");
  const backupDirectory = path.join(directory, "data-backup");
  const dataFile = path.join(dataDirectory, "baynat.json");
  const firstRun = await listen(dataFile);
  context.after(async () => {
    await close(firstRun.server);
    await rm(directory, { recursive: true, force: true });
  });

  const created = await createQuiz(firstRun.baseUrl);
  const access = await accessStudent(
    firstRun.baseUrl,
    created.payload.quizId,
    "4821"
  );
  await rename(dataDirectory, backupDirectory);
  await writeFile(dataDirectory, "blocks the data directory");
  const failed = await submit(
    firstRun.baseUrl,
    created.payload.quizId,
    access.payload.token,
    created.payload.questionId,
    "صح"
  );
  assert.equal(failed.response.status, 500);

  await rm(dataDirectory, { force: true });
  await rename(backupDirectory, dataDirectory);
  const retried = await submit(
    firstRun.baseUrl,
    created.payload.quizId,
    access.payload.token,
    created.payload.questionId,
    "صح"
  );
  assert.equal(retried.response.status, 200);
  await close(firstRun.server);

  const secondRun = await listen(dataFile);
  context.after(() => close(secondRun.server));
  const persisted = await request(
    secondRun.baseUrl,
    `/api/quizzes/${created.payload.quizId}/admin`,
    { headers: { "X-Admin-Token": created.payload.adminToken } }
  );
  assert.equal(persisted.payload.quiz.submissions.length, 1);
  assert.equal(persisted.payload.quiz.answerRecords.length, 1);
});

test("preserves supervisor bootstrap security and refuses unsupported state files", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "baynat-security-"));
  const dataFile = path.join(directory, "baynat.json");
  const setupKey = "bootstrap-key-for-tests";
  const { server, store } = await createBaynatServer({
    dataFile,
    setupKey,
    accessDifficultyBits: 8,
    supervisorDifficultyBits: 8,
    logger: { error() {} },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  context.after(async () => {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  });

  const unauthorizedQuiz = await request(baseUrl, "/api/quizzes", {
    method: "POST",
    withSupervisor: false,
    body: {},
  });
  assert.equal(unauthorizedQuiz.response.status, 401);
  const wrongSetup = await request(baseUrl, "/api/admin/setup", {
    method: "POST",
    withSupervisor: false,
    body: {
      displayName: TEST_SUPERVISOR_NAME,
      password: TEST_SUPERVISOR_PASSWORD,
      setupKey: "wrong-bootstrap-key",
    },
  });
  assert.equal(wrongSetup.response.status, 401);
  assert.equal(wrongSetup.payload.error.code, "SETUP_KEY_REJECTED");
  const configured = await request(baseUrl, "/api/admin/setup", {
    method: "POST",
    withSupervisor: false,
    body: {
      displayName: TEST_SUPERVISOR_NAME,
      password: TEST_SUPERVISOR_PASSWORD,
      setupKey: store.data.setupKey,
    },
  });
  assert.equal(configured.response.status, 201);
  assert.equal(store.data.version, 3);

  await close(server);
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
});

test("keeps private files unreachable and enforces one JSON-store writer", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "baynat-static-lock-"));
  const dataFile = path.join(directory, "baynat.json");
  const run = await listen(dataFile);
  context.after(async () => {
    await close(run.server);
    await rm(directory, { recursive: true, force: true });
  });

  for (const privatePath of ["/.data/baynat.json", "/.git/config", "/server.js"]) {
    const response = await fetch(`${run.baseUrl}${privatePath}`);
    assert.equal(response.status, 404);
  }
  const logo = await fetch(`${run.baseUrl}/zakaa-logo.jpg`);
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get("content-type"), "image/jpeg");
  assert.ok((await logo.arrayBuffer()).byteLength > 10_000);
  await assert.rejects(
    createBaynatServer({ dataFile }),
    /ملف بيانات بَيّنات مقفول/
  );
});
