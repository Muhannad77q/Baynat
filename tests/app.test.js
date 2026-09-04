import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildLeaderboard,
  calculateScore,
  createIdempotencyKeyManager,
  createInitialState,
  createQuizPublishRequest,
  createSharePayload,
  decodeSharePayload,
  encodeSharePayload,
  isAnswerCorrect,
  normalizeAnswer,
  normalizeDigits,
  validateQuestion,
  validateStudentInput,
} from "../app.js";

test("normalizes Arabic and Persian digits for four-digit student codes", () => {
  assert.equal(normalizeDigits("٤٨٢١"), "4821");
  assert.equal(normalizeDigits("۴۸۲۱"), "4821");
  assert.equal(normalizeDigits("4821"), "4821");
});

test("reuses create idempotency keys until payload change or success", () => {
  let sequence = 0;
  const manager = createIdempotencyKeyManager({
    createKey: () => `test-key-${++sequence}`,
  });
  const firstPayload = {
    name: "سارة القحطاني",
    className: "أولى ثانوي",
    pin: "1234",
  };
  const equivalentPayload = {
    pin: "1234",
    className: "أولى ثانوي",
    name: "سارة القحطاني",
  };

  const firstKey = manager.keyFor("student-create", firstPayload);
  assert.equal(
    manager.keyFor("student-create", equivalentPayload),
    firstKey
  );
  const changedKey = manager.keyFor("student-create", {
    ...firstPayload,
    pin: "5678",
  });
  assert.notEqual(changedKey, firstKey);

  manager.complete("student-create", firstPayload, firstKey);
  assert.equal(
    manager.keyFor("student-create", { ...firstPayload, pin: "5678" }),
    changedKey
  );
  manager.complete(
    "student-create",
    { ...firstPayload, pin: "5678" },
    changedKey
  );
  assert.notEqual(
    manager.keyFor("student-create", { ...firstPayload, pin: "5678" }),
    changedKey
  );
});

test("persists publish and reset attempts across a failed request and reload", () => {
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
  let sequence = 0;
  const options = {
    createKey: () => `persistent-key-${++sequence}`,
    storage,
    storageKey: "baynat.test.pending-operations",
  };
  const publishRequest = {
    expectedCurrentQuizId: "quiz-current",
    questions: [{ type: "boolean", prompt: "هل الأرض كروية؟" }],
  };
  const resetRequest = {
    quizId: "quiz-current",
    expectedRound: 3,
  };
  const firstManager = createIdempotencyKeyManager(options);
  const publishKey = firstManager.keyFor("quiz-create", publishRequest);
  const resetKey = firstManager.keyFor("leaderboard-reset:quiz-current", resetRequest);

  const reloadedManager = createIdempotencyKeyManager(options);
  assert.deepEqual(
    reloadedManager.pending("quiz-create"),
    { key: publishKey, payload: publishRequest }
  );
  assert.equal(
    reloadedManager.keyFor("quiz-create", structuredClone(publishRequest)),
    publishKey
  );
  assert.equal(
    reloadedManager.keyFor(
      "leaderboard-reset:quiz-current",
      structuredClone(resetRequest)
    ),
    resetKey
  );

  reloadedManager.complete("quiz-create", publishRequest, publishKey);
  const afterSuccessReload = createIdempotencyKeyManager(options);
  assert.notEqual(
    afterSuccessReload.keyFor("quiz-create", publishRequest),
    publishKey
  );
});

test("rebuilds a failed publish with its persisted expected quiz after reload", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  const state = createInitialState(
    Date.parse("2026-07-31T12:00:00.000Z")
  );
  state.expectedCurrentQuizId = "quiz-authoritative";
  state.currentQuestion.published = true;
  state.students = [
    {
      id: "student-one",
      name: "سارة القحطاني",
      className: "أولى ثانوي",
      pin: "1234",
    },
  ];
  const firstRequest = createQuizPublishRequest(state);
  const firstManager = createIdempotencyKeyManager({
    createKey: () => "persisted-publish-key",
    storage,
    storageKey: "baynat.test.publish-reload",
  });
  firstManager.keyFor("quiz-create", firstRequest);

  const reloadedState = structuredClone(state);
  reloadedState.students[0].revision = 2;
  const reloadedManager = createIdempotencyKeyManager({
    createKey: () => "must-not-be-used",
    storage,
    storageKey: "baynat.test.publish-reload",
  });
  const retriedRequest = createQuizPublishRequest(
    reloadedState,
    reloadedManager.pending("quiz-create")
  );
  assert.deepEqual(retriedRequest, firstRequest);
  assert.equal(
    retriedRequest.expectedCurrentQuizId,
    "quiz-authoritative"
  );

  reloadedState.currentQuestion.prompt = "سؤال جديد مختلف تمامًا";
  assert.notDeepEqual(
    createQuizPublishRequest(
      reloadedState,
      reloadedManager.pending("quiz-create")
    ),
    firstRequest
  );
});

test("validates supervisor-managed student details and supports PIN-free edits", () => {
  const existing = [
    { id: "one", name: "سارة", className: "أولى ثانوي", pin: "4821" },
  ];

  assert.deepEqual(
    validateStudentInput(
      { name: "عمر الحربي", className: "ثاني ثانوي", pin: "٧٣٥٠" },
      existing
    ),
    {
      valid: true,
      value: {
        name: "عمر الحربي",
        className: "ثاني ثانوي",
        pin: "7350",
      },
    }
  );
  assert.equal(
    validateStudentInput(
      { name: "نورة", className: "أولى ثانوي", pin: "٤٨٢١" },
      existing
    ).error,
    "رمز الدخول مستخدم لطالب آخر. اختر رمزًا مختلفًا."
  );
  assert.equal(
    validateStudentInput(
      { name: "جود", className: "ثالث ثانوي", pin: "12" },
      existing
    ).valid,
    false
  );
  assert.equal(
    validateStudentInput(
      { name: "سارة القحطاني", className: "ثالث ثانوي", pin: "" },
      existing,
      { pinRequired: false, excludeId: "one" }
    ).valid,
    true
  );
  assert.equal(
    validateStudentInput(
      { name: "نورة", className: "", pin: "1234" },
      existing
    ).error,
    "اختر صف الطالب."
  );
});

test("normalizes Arabic text but leaves short answers for manual grading", () => {
  const question = {
    type: "short",
    prompt: "ما عاصمة المملكة؟",
  };

  assert.equal(normalizeAnswer("  الرِّياض  "), "الرياض");
  assert.equal(isAnswerCorrect(question, "الرياض"), false);
  assert.equal(isAnswerCorrect(question, "جدة"), false);
});

test("validates objective questions and accepts manually graded short questions", () => {
  assert.equal(
    validateQuestion({
      type: "multiple",
      prompt: "أي كوكب يعرف بالكوكب الأحمر؟",
      options: ["الزهرة", "المريخ", "عطارد"],
      correctAnswer: "المريخ",
    }).valid,
    true
  );
  assert.equal(
    validateQuestion({
      type: "multiple",
      prompt: "اختر الإجابة الصحيحة",
      options: ["نعم", "نعم"],
      correctAnswer: "نعم",
    }).error,
    "لا يمكن تكرار الخيار نفسه أكثر من مرة."
  );
  assert.equal(
    validateQuestion({
      type: "boolean",
      prompt: "الماء يتجمد عند صفر مئوية",
      options: ["صح", "خطأ"],
      correctAnswer: "صح",
    }).valid,
    true
  );
  assert.equal(
    validateQuestion({
      type: "short",
      prompt: "اكتب عاصمة المملكة",
      options: [],
    }).valid,
    true
  );
});

test("awards accuracy, speed, and podium points transparently", () => {
  assert.deepEqual(calculateScore({ isCorrect: true, elapsedMs: 8_500, speedPlace: 1 }), {
    accuracyPoints: 100,
    speedPoints: 43,
    placePoints: 30,
    total: 173,
  });
  assert.deepEqual(calculateScore({ isCorrect: true, elapsedMs: 120_000, speedPlace: 8 }), {
    accuracyPoints: 100,
    speedPoints: 0,
    placePoints: 0,
    total: 100,
  });
  assert.deepEqual(calculateScore({ isCorrect: false, elapsedMs: 500, speedPlace: 1 }), {
    accuracyPoints: 0,
    speedPoints: 0,
    placePoints: 0,
    total: 0,
  });
});

test("builds a cumulative leaderboard across questions while pending grades add no points", () => {
  const students = [
    { id: "a", name: "أمل", className: "٢ / أ" },
    { id: "b", name: "بدر", className: "٢ / أ" },
    { id: "c", name: "جنى", className: "٢ / أ" },
  ];
  const submissions = [
    {
      id: "slow-correct",
      studentId: "a",
      questionId: "q1",
      isCorrect: true,
      gradingStatus: "graded",
      elapsedMs: 2_000,
      submittedAt: "2026-07-30T12:00:00.000Z",
    },
    {
      id: "wrong",
      studentId: "c",
      questionId: "q1",
      isCorrect: false,
      gradingStatus: "graded",
      elapsedMs: 300,
      submittedAt: "2026-07-30T12:00:01.000Z",
    },
    {
      id: "fast-correct",
      studentId: "b",
      questionId: "q1",
      isCorrect: true,
      gradingStatus: "graded",
      elapsedMs: 1_000,
      submittedAt: "2026-07-30T12:00:02.000Z",
    },
    {
      id: "second-correct",
      studentId: "a",
      questionId: "q2",
      isCorrect: true,
      gradingStatus: "graded",
      elapsedMs: 1_000,
      submittedAt: "2026-07-30T12:01:00.000Z",
    },
    {
      id: "pending-manual",
      studentId: "b",
      questionId: "q2",
      isCorrect: null,
      gradingStatus: "pending",
      elapsedMs: 900,
      submittedAt: "2026-07-30T12:01:01.000Z",
    },
  ];

  const leaderboard = buildLeaderboard(students, submissions);
  assert.deepEqual(
    leaderboard.map((entry) => [
      entry.rank,
      entry.student.id,
      entry.total,
      entry.answeredCount,
      entry.pendingCount,
    ]),
    [
      [1, "a", 364, 2, 0],
      [2, "b", 188, 2, 1],
      [3, "c", 0, 1, 0],
    ]
  );
});

function createPopulatedState() {
  const state = createInitialState(Date.parse("2026-07-30T12:00:00.000Z"));
  state.currentQuestion = {
    id: "question-red-planet",
    type: "multiple",
    prompt: "أيّ كوكب يُعرف بالكوكب الأحمر؟",
    options: ["الزهرة", "المريخ"],
    correctAnswer: "المريخ",
    createdAt: "2026-07-30T12:00:00.000Z",
    published: true,
  };
  state.students = [
    {
      id: "student-sarah",
      name: "سارة القحطاني",
      className: "أولى ثانوي",
      pin: "4821",
    },
    {
      id: "student-yousef",
      name: "يوسف الدوسري",
      className: "ثاني ثانوي",
      pin: "2904",
    },
  ];
  state.submissions = [
    {
      id: "submission-sarah",
      studentId: "student-sarah",
      questionId: state.currentQuestion.id,
      answer: "المريخ",
      isCorrect: true,
      elapsedMs: 1_500,
      submittedAt: "2026-07-30T12:01:00.000Z",
    },
  ];
  return state;
}

test("creates a Unicode-safe share link payload without exposing raw PIN fields", () => {
  const state = createPopulatedState();
  const payload = createSharePayload(state);

  assert.equal(payload.question.prompt, "أيّ كوكب يُعرف بالكوكب الأحمر؟");
  assert.equal(payload.students.every((student) => !Object.hasOwn(student, "pin")), true);
  assert.equal(payload.students.every((student) => Boolean(student.pinHash)), true);
  assert.equal(
    payload.students.every((student) => !Object.hasOwn(student, "halaqa")),
    true
  );

  const encoded = encodeSharePayload(payload);
  assert.deepEqual(decodeSharePayload(encoded), payload);
  assert.equal(encoded.includes("4821"), false);
});

test("rejects incomplete or tampered shared-link payloads", () => {
  const state = createPopulatedState();
  const payload = createSharePayload(state);
  const missingPins = {
    ...payload,
    students: payload.students.map(({ pinHash: _pinHash, ...student }) => student),
  };
  const invalidSubmission = {
    ...payload,
    submissions: [{ ...payload.submissions[0], elapsedMs: -10 }],
  };

  assert.equal(decodeSharePayload("not-valid-base64"), null);
  assert.equal(decodeSharePayload(encodeSharePayload(missingPins)), null);
  assert.equal(decodeSharePayload(encodeSharePayload(invalidSubmission)), null);
});

test("starts with a clean classroom and an unpublished question draft", () => {
  const state = createInitialState(Date.parse("2026-07-30T12:00:00.000Z"));

  assert.equal(state.students.length, 0);
  assert.equal(state.submissions.length, 0);
  assert.equal(state.participants.length, 0);
  assert.equal(state.answerRecords.length, 0);
  assert.equal(state.participationRecords.length, 0);
  assert.equal(state.currentRound, 1);
  assert.equal(state.expectedCurrentQuizId, null);
  assert.equal(state.version, 3);
  assert.equal(state.questions.length, 0);
  assert.equal(state.leaderboard.length, 0);
  assert.equal(state.currentQuestion.published, false);
  assert.equal(state.currentQuestion.id, "question-draft");
});

test("ships the Zakaa weekly brand and PIN-only student form", async () => {
  const [
    adminHtml,
    adminScript,
    studentHtml,
    studentScript,
    buildScript,
    logo,
  ] =
    await Promise.all([
      readFile(new URL("../index.html", import.meta.url), "utf8"),
      readFile(new URL("../app.js", import.meta.url), "utf8"),
      readFile(new URL("../student.html", import.meta.url), "utf8"),
      readFile(new URL("../student.js", import.meta.url), "utf8"),
      readFile(new URL("../scripts/build-netlify.js", import.meta.url), "utf8"),
      readFile(new URL("../zakaa-logo.jpg", import.meta.url)),
    ]);

  assert.match(adminHtml, /<title>السؤال الأسبوعي لفريق زكاء<\/title>/);
  assert.match(studentHtml, /<title>السؤال الأسبوعي لفريق زكاء<\/title>/);
  assert.match(adminHtml, /src="\.\/zakaa-logo\.jpg"/);
  assert.match(studentHtml, /src="\.\/zakaa-logo\.jpg"/);
  assert.match(buildScript, /"zakaa-logo\.jpg"/);
  assert.ok(logo.length > 10_000);
  assert.doesNotMatch(adminHtml, /studentHalaqa|name="halaqa"|سواعد/);
  assert.doesNotMatch(
    studentHtml,
    /studentFullName|studentClassName|studentHalaqa|name="halaqa"|سواعد/
  );
  assert.equal(
    (studentHtml.match(/<input\b/g) || []).length,
    1,
    "The student access page should expose only its PIN input."
  );
  assert.match(studentScript, /"X-Start-Question": "1"/);
  assert.match(
    adminScript,
    /answerRecordsBody\.addEventListener\("click", handleGradeAction\)/
  );
  assert.ok(
    (
      studentScript.match(
        /requestStudentSession\(\{ startQuestion: true \}\)/g
      ) || []
    ).length >= 2,
    "Resumed and subsequent questions should start server-side timing when shown."
  );
});
