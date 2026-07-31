import assert from "node:assert/strict";
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
    halaqa: "زكاء",
    pin: "1234",
  };
  const equivalentPayload = {
    pin: "1234",
    halaqa: "زكاء",
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
    question: { type: "boolean", prompt: "هل الأرض كروية؟" },
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
      halaqa: "زكاء",
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

test("validates student class and halaqa selections and supports PIN-free edits", () => {
  const existing = [
    { id: "one", name: "سارة", className: "أولى ثانوي", halaqa: "زكاء", pin: "4821" },
  ];

  assert.deepEqual(
    validateStudentInput(
      { name: "عمر الحربي", className: "ثاني ثانوي", halaqa: "سواعد", pin: "٧٣٥٠" },
      existing
    ),
    {
      valid: true,
      value: {
        name: "عمر الحربي",
        className: "ثاني ثانوي",
        halaqa: "سواعد",
        pin: "7350",
      },
    }
  );
  assert.equal(
    validateStudentInput(
      { name: "نورة", className: "أولى ثانوي", halaqa: "زكاء", pin: "٤٨٢١" },
      existing
    ).error,
    "رمز الدخول مستخدم لطالب آخر. اختر رمزًا مختلفًا."
  );
  assert.equal(
    validateStudentInput(
      { name: "جود", className: "ثالث ثانوي", halaqa: "زكاء", pin: "12" },
      existing
    ).valid,
    false
  );
  assert.equal(
    validateStudentInput(
      { name: "سارة القحطاني", className: "ثالث ثانوي", halaqa: "سواعد", pin: "" },
      existing,
      { pinRequired: false, excludeId: "one" }
    ).valid,
    true
  );
  assert.equal(
    validateStudentInput(
      { name: "نورة", className: "أولى ثانوي", halaqa: "", pin: "1234" },
      existing
    ).error,
    "اختر حلقة الطالب."
  );
});

test("compares short Arabic answers after harmless spelling normalization", () => {
  const question = {
    type: "short",
    prompt: "ما عاصمة المملكة؟",
    correctAnswer: "الرِّياض | مدينة الرياض",
  };

  assert.equal(normalizeAnswer("  الرِّياض  "), "الرياض");
  assert.equal(isAnswerCorrect(question, "الرياض"), true);
  assert.equal(isAnswerCorrect(question, "مدينة الرِّياض"), true);
  assert.equal(isAnswerCorrect(question, "جدة"), false);
});

test("validates all supported daily question types", () => {
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
      correctAnswer: "",
    }).valid,
    false
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

test("ranks correct students by speed ahead of incorrect attempts", () => {
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
      elapsedMs: 2_000,
      submittedAt: "2026-07-30T12:00:00.000Z",
    },
    {
      id: "wrong",
      studentId: "c",
      questionId: "q1",
      isCorrect: false,
      elapsedMs: 300,
      submittedAt: "2026-07-30T12:00:01.000Z",
    },
    {
      id: "fast-correct",
      studentId: "b",
      questionId: "q1",
      isCorrect: true,
      elapsedMs: 1_000,
      submittedAt: "2026-07-30T12:00:02.000Z",
    },
  ];

  const leaderboard = buildLeaderboard(students, submissions, "q1");
  assert.deepEqual(
    leaderboard.map((entry) => [entry.rank, entry.studentId, entry.total]),
    [
      [1, "b", 188],
      [2, "a", 176],
      [3, "c", 0],
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
      halaqa: "زكاء",
      pin: "4821",
    },
    {
      id: "student-yousef",
      name: "يوسف الدوسري",
      className: "ثاني ثانوي",
      halaqa: "سواعد",
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
  assert.deepEqual(
    [...new Set(payload.students.map((student) => student.halaqa))].sort(),
    ["زكاء", "سواعد"].sort()
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
  assert.equal(state.currentQuestion.published, false);
  assert.equal(state.currentQuestion.id, "question-draft");
});
