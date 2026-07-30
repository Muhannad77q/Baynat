import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLeaderboard,
  calculateScore,
  createInitialState,
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

test("validates student details and prevents duplicate access codes", () => {
  const existing = [{ id: "one", name: "سارة", className: "٢ / أ", pin: "4821" }];

  assert.deepEqual(
    validateStudentInput({ name: "عمر الحربي", className: "٢ / ب", pin: "٧٣٥٠" }, existing),
    {
      valid: true,
      value: { name: "عمر الحربي", className: "٢ / ب", pin: "7350" },
    }
  );
  assert.equal(
    validateStudentInput({ name: "نورة", className: "٢ / أ", pin: "٤٨٢١" }, existing).error,
    "رمز الدخول مستخدم لطالب آخر. اختر رمزًا مختلفًا."
  );
  assert.equal(
    validateStudentInput({ name: "جود", className: "٢ / أ", pin: "12" }, existing).valid,
    false
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

test("creates a Unicode-safe share link payload without exposing raw PIN fields", () => {
  const state = createInitialState(Date.parse("2026-07-30T12:00:00.000Z"));
  const payload = createSharePayload(state);

  assert.equal(payload.question.prompt, "أيّ كوكب يُعرف بالكوكب الأحمر؟");
  assert.equal(payload.students.every((student) => !Object.hasOwn(student, "pin")), true);
  assert.equal(payload.students.every((student) => Boolean(student.pinHash)), true);

  const encoded = encodeSharePayload(payload);
  assert.deepEqual(decodeSharePayload(encoded), payload);
  assert.equal(encoded.includes("4821"), false);
});

test("rejects incomplete or tampered shared-link payloads", () => {
  const state = createInitialState(Date.parse("2026-07-30T12:00:00.000Z"));
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

test("ships with a complete demo classroom and one unsubmitted test student", () => {
  const state = createInitialState(Date.parse("2026-07-30T12:00:00.000Z"));
  const sarah = state.students.find((student) => student.pin === "4821");

  assert.ok(sarah);
  assert.equal(state.students.length, 8);
  assert.equal(state.submissions.length, 6);
  assert.equal(state.submissions.some((submission) => submission.studentId === sarah.id), false);
  assert.equal(state.currentQuestion.correctAnswer, "المريخ");
});
