import {
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import {
  closeSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DEFAULT_CLASS_OPTIONS,
  normalizeAnswer,
  normalizeDigits,
} from "./app.js";

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_FILE = path.join(ROOT_DIR, ".data", "baynat.json");
const MAX_BODY_BYTES = 128 * 1024;
const MAX_STUDENTS = 80;
const MAX_SUPERVISORS = 20;
const ACCESS_WINDOW_MS = 10 * 60 * 1000;
const SUPERVISOR_SESSION_MS = 12 * 60 * 60 * 1000;
const SUPERVISOR_ATTEMPTS_LIMIT = 10;
const STUDENT_ATTEMPTS_LIMIT = 30;
const ACCESS_CHALLENGE_MS = 2 * 60 * 1000;
const MAX_RATE_LIMIT_KEYS = 2_000;
const MAX_CONSUMED_PROOFS = 10_000;
const MAX_RESET_REQUESTS = 32;
const MAX_QUESTIONS = 100;
const QUIZ_RETENTION_MS = 31 * 24 * 60 * 60 * 1000;
const QUIZ_CREATION_WINDOW_MS = 60 * 60 * 1000;
const QUIZ_CREATION_IP_LIMIT = 5;
const QUIZ_CREATION_GLOBAL_LIMIT = 30;
const PLACE_BONUSES = [30, 20, 10];
const PUBLIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/student.html", "student.html"],
  ["/app.js", "app.js"],
  ["/student.js", "student.js"],
  ["/pow-worker.js", "pow-worker.js"],
  ["/styles.css", "styles.css"],
  ["/zakaa-logo.jpg", "zakaa-logo.jpg"],
]);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
};

export class HttpError extends Error {
  constructor(status, message, code = "REQUEST_FAILED", details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createSecurityState() {
  return {
    supervisorAttempts: {},
    studentAttempts: {},
    quizCreations: { byIp: {}, global: [] },
  };
}

function validateSecurityState(security) {
  let migrated = false;
  if (isRecord(security) && !Object.hasOwn(security, "studentAttempts")) {
    security.studentAttempts = {};
    migrated = true;
  }
  if (
    !isRecord(security) ||
    !isRecord(security.supervisorAttempts) ||
    !isRecord(security.studentAttempts) ||
    !isRecord(security.quizCreations) ||
    !isRecord(security.quizCreations.byIp) ||
    !Array.isArray(security.quizCreations.global)
  ) {
    throw new Error("سجل حماية الطلبات في ملف بَيّنات غير صالح.");
  }
  if (
    Object.keys(security.supervisorAttempts).length > MAX_RATE_LIMIT_KEYS ||
    Object.keys(security.studentAttempts).length > MAX_RATE_LIMIT_KEYS ||
    Object.keys(security.quizCreations.byIp).length > MAX_RATE_LIMIT_KEYS
  ) {
    throw new Error("سجل حماية الطلبات في ملف بَيّنات أكبر من الحد المسموح.");
  }

  const now = Date.now();
  for (const [key, state] of Object.entries(security.supervisorAttempts)) {
    if (
      !/^[a-f0-9]{64}$/.test(key) ||
      !isRecord(state) ||
      !Array.isArray(state.failures) ||
      !isRecord(state.reservations) ||
      state.failures.length > SUPERVISOR_ATTEMPTS_LIMIT ||
      Object.keys(state.reservations).length > SUPERVISOR_ATTEMPTS_LIMIT ||
      !state.failures.every(Number.isFinite) ||
      !Object.entries(state.reservations).every(
        ([reservationId, timestamp]) =>
          /^[A-Za-z0-9_-]{8,80}$/.test(reservationId) &&
          Number.isFinite(timestamp)
      )
    ) {
      throw new Error("سجل حماية دخول المشرف في ملف بَيّنات غير صالح.");
    }
    const failures = state.failures.filter(
      (timestamp) => now - timestamp < ACCESS_WINDOW_MS
    );
    const reservations = Object.fromEntries(
      Object.entries(state.reservations).filter(
        ([, timestamp]) => now - timestamp < ACCESS_WINDOW_MS
      )
    );
    if (
      failures.length !== state.failures.length ||
      Object.keys(reservations).length !== Object.keys(state.reservations).length
    ) {
      migrated = true;
    }
    if (!failures.length && !Object.keys(reservations).length) {
      delete security.supervisorAttempts[key];
      migrated = true;
    } else {
      state.failures = failures;
      state.reservations = reservations;
    }
  }

  for (const [key, state] of Object.entries(security.studentAttempts)) {
    if (
      !/^[a-f0-9]{64}$/.test(key) ||
      !isRecord(state) ||
      !Array.isArray(state.failures) ||
      !isRecord(state.reservations) ||
      state.failures.length > STUDENT_ATTEMPTS_LIMIT ||
      Object.keys(state.reservations).length > STUDENT_ATTEMPTS_LIMIT ||
      !state.failures.every(Number.isFinite) ||
      !Object.entries(state.reservations).every(
        ([reservationId, timestamp]) =>
          /^[A-Za-z0-9_-]{8,80}$/.test(reservationId) &&
          Number.isFinite(timestamp)
      )
    ) {
      throw new Error("سجل حماية دخول الطلاب في ملف البيانات غير صالح.");
    }
    const failures = state.failures.filter(
      (timestamp) => now - timestamp < ACCESS_WINDOW_MS
    );
    const reservations = Object.fromEntries(
      Object.entries(state.reservations).filter(
        ([, timestamp]) => now - timestamp < ACCESS_WINDOW_MS
      )
    );
    if (
      failures.length !== state.failures.length ||
      Object.keys(reservations).length !== Object.keys(state.reservations).length
    ) {
      migrated = true;
    }
    if (!failures.length && !Object.keys(reservations).length) {
      delete security.studentAttempts[key];
      migrated = true;
    } else {
      state.failures = failures;
      state.reservations = reservations;
    }
  }

  if (
    security.quizCreations.global.length > QUIZ_CREATION_GLOBAL_LIMIT ||
    !security.quizCreations.global.every(Number.isFinite)
  ) {
    throw new Error("سجل حماية نشر الأسئلة في ملف بَيّنات غير صالح.");
  }
  const recentGlobal = security.quizCreations.global.filter(
    (timestamp) => now - timestamp < QUIZ_CREATION_WINDOW_MS
  );
  if (recentGlobal.length !== security.quizCreations.global.length) {
    security.quizCreations.global = recentGlobal;
    migrated = true;
  }
  for (const [key, timestamps] of Object.entries(security.quizCreations.byIp)) {
    if (
      !/^[a-f0-9]{64}$/.test(key) ||
      !Array.isArray(timestamps) ||
      timestamps.length > QUIZ_CREATION_IP_LIMIT ||
      !timestamps.every(Number.isFinite)
    ) {
      throw new Error("سجل حماية نشر الأسئلة في ملف بَيّنات غير صالح.");
    }
    const recent = timestamps.filter(
      (timestamp) => now - timestamp < QUIZ_CREATION_WINDOW_MS
    );
    if (!recent.length) {
      delete security.quizCreations.byIp[key];
      migrated = true;
    } else if (recent.length !== timestamps.length) {
      security.quizCreations.byIp[key] = recent;
      migrated = true;
    }
  }
  return migrated;
}

function validateQuestionContract(question) {
  if (!isRecord(question) || String(question.prompt || "").trim().length < 5) {
    return { valid: false, error: "اكتب سؤالًا واضحًا لا يقل عن ٥ أحرف." };
  }
  if (!["multiple", "boolean", "short"].includes(question.type)) {
    return { valid: false, error: "اختر نوعًا صحيحًا للسؤال." };
  }
  const options = Array.isArray(question.options)
    ? question.options.map((option) => String(option).trim()).filter(Boolean)
    : [];
  if (question.type === "short") return { valid: true };
  const correctAnswer = String(question.correctAnswer || "").trim();
  if (!correctAnswer) {
    return { valid: false, error: "حدّد الإجابة الصحيحة قبل الحفظ." };
  }
  if (question.type === "multiple") {
    if (options.length < 2) {
      return { valid: false, error: "أضف خيارين على الأقل." };
    }
    if (new Set(options.map(normalizeAnswer)).size !== options.length) {
      return { valid: false, error: "لا يمكن تكرار الخيار نفسه أكثر من مرة." };
    }
    if (
      !options.some(
        (option) => normalizeAnswer(option) === normalizeAnswer(correctAnswer)
      )
    ) {
      return { valid: false, error: "حدّد الإجابة الصحيحة من الخيارات." };
    }
  }
  if (
    question.type === "boolean" &&
    !["صح", "خطأ"].some(
      (option) => normalizeAnswer(option) === normalizeAnswer(correctAnswer)
    )
  ) {
    return { valid: false, error: "حدّد صح أو خطأ بوصفها الإجابة الصحيحة." };
  }
  return { valid: true };
}

function isValidCreationRequest(request) {
  return (
    isRecord(request) &&
    typeof request.keyHash === "string" &&
    request.keyHash.length > 0 &&
    typeof request.requestHash === "string" &&
    request.requestHash.length > 0
  );
}

function questionStartKey(round, studentId, questionId) {
  return `${round}:${studentId}:${questionId}`;
}

function isStoredQuestion(question) {
  return (
    isRecord(question) &&
    typeof question.id === "string" &&
    /^[A-Za-z0-9_-]{3,100}$/.test(question.id) &&
    validateQuestionContract(question).valid &&
    Array.isArray(question.options) &&
    Number.isFinite(new Date(question.createdAt).getTime()) &&
    (question.creationRequest === undefined ||
      isValidCreationRequest(question.creationRequest)) &&
    (question.type !== "short" || !Object.hasOwn(question, "correctAnswer"))
  );
}

function isStoredStudent(student) {
  return (
    isRecord(student) &&
    typeof student.id === "string" &&
    /^[A-Za-z0-9_-]{3,80}$/.test(student.id) &&
    typeof student.name === "string" &&
    student.name.trim().length >= 2 &&
    typeof student.className === "string" &&
    Boolean(student.className.trim()) &&
    !Object.hasOwn(student, "halaqa") &&
    Number.isInteger(student.revision) &&
    student.revision >= 1 &&
    typeof student.identityLookup === "string" &&
    (student.pinLookup === undefined || typeof student.pinLookup === "string") &&
    typeof student.pinSalt === "string" &&
    typeof student.pinHash === "string" &&
    (student.creationRequest === undefined ||
      isValidCreationRequest(student.creationRequest))
  );
}

function isValidGradeHistory(history) {
  return (
    Array.isArray(history) &&
    history.every(
      (entry) =>
        isRecord(entry) &&
        Number.isInteger(entry.gradeRevision) &&
        entry.gradeRevision >= 1 &&
        typeof entry.isCorrect === "boolean" &&
        typeof entry.gradedBy === "string" &&
        entry.gradedBy.length > 0 &&
        Number.isFinite(new Date(entry.gradedAt).getTime()) &&
        (entry.creationRequest === undefined ||
          isValidCreationRequest(entry.creationRequest))
    )
  );
}

function migrateGradingRecord(record, question, defaultRound) {
  let migrated = false;
  if (!Number.isInteger(record.round) || record.round < 1) {
    record.round = defaultRound;
    migrated = true;
  }
  if (!Array.isArray(record.gradeHistory)) {
    record.gradeHistory = [];
    migrated = true;
  }
  const legacyGrade = typeof record.isCorrect === "boolean";
  const shouldBeGraded =
    question.type !== "short" ||
    record.gradingStatus === "graded" ||
    legacyGrade;
  const expectedStatus = shouldBeGraded ? "graded" : "pending";
  if (record.gradingStatus !== expectedStatus) {
    record.gradingStatus = expectedStatus;
    migrated = true;
  }
  if (shouldBeGraded) {
    if (typeof record.gradedBy !== "string" || !record.gradedBy) {
      record.gradedBy = question.type === "short" ? "legacy" : "automatic";
      migrated = true;
    }
    if (!Number.isFinite(new Date(record.gradedAt).getTime())) {
      record.gradedAt = record.submittedAt;
      migrated = true;
    }
    if (!Number.isInteger(record.gradeRevision) || record.gradeRevision < 1) {
      record.gradeRevision = 1;
      migrated = true;
    }
  } else {
    if (record.isCorrect !== null) {
      record.isCorrect = null;
      migrated = true;
    }
    if (record.gradedBy !== null) {
      record.gradedBy = null;
      migrated = true;
    }
    if (record.gradedAt !== null) {
      record.gradedAt = null;
      migrated = true;
    }
    if (record.gradeRevision !== 0) {
      record.gradeRevision = 0;
      migrated = true;
    }
  }
  return migrated;
}

function isStoredSubmission(record, questions, { activeRound = null } = {}) {
  const question = questions.find((item) => item.id === record?.questionId);
  const validGrade =
    record?.gradingStatus === "pending"
      ? question?.type === "short" &&
        record.isCorrect === null &&
        record.gradedBy === null &&
        record.gradedAt === null &&
        record.gradeRevision === 0
      : record?.gradingStatus === "graded" &&
        typeof record.isCorrect === "boolean" &&
        typeof record.gradedBy === "string" &&
        record.gradedBy.length > 0 &&
        Number.isFinite(new Date(record.gradedAt).getTime()) &&
        Number.isInteger(record.gradeRevision) &&
        record.gradeRevision >= 1;
  return (
    isRecord(record) &&
    typeof record.id === "string" &&
    typeof record.studentId === "string" &&
    Boolean(question) &&
    typeof record.answer === "string" &&
    record.answer.length > 0 &&
    record.answer.length <= 500 &&
    Number.isFinite(record.elapsedMs) &&
    record.elapsedMs >= 0 &&
    Number.isFinite(new Date(record.submittedAt).getTime()) &&
    Number.isInteger(record.round) &&
    record.round >= 1 &&
    (activeRound === null || record.round === activeRound) &&
    validGrade &&
    isValidGradeHistory(record.gradeHistory)
  );
}

export function validateStoredData(parsed, initialSetupKey) {
  const storedVersion = parsed?.version;
  if (
    ![1, 2, 3].includes(storedVersion) ||
    typeof parsed.secret !== "string" ||
    parsed.secret.length < 20 ||
    !isRecord(parsed.quizzes)
  ) {
    throw new Error("إصدار أو بنية ملف بيانات بَيّنات غير مدعومة؛ لن تتم الكتابة فوقه.");
  }

  let migrated = false;
  const validSupervisorCredential = (credential) =>
    isRecord(credential) &&
    typeof credential.salt === "string" &&
    typeof credential.hash === "string" &&
    Number.isFinite(new Date(credential.createdAt).getTime());

  if (storedVersion === 1) {
    const legacyCredential = parsed.adminCredential ?? null;
    if (
      legacyCredential !== null &&
      !validSupervisorCredential(legacyCredential)
    ) {
      throw new Error("بيانات دخول المشرف في ملف بَيّنات غير صالحة.");
    }
    parsed.supervisors = legacyCredential
      ? [
          {
            id: "supervisor-legacy",
            displayName: "المشرف الرئيسي",
            credential: legacyCredential,
          },
        ]
      : [];
    delete parsed.adminCredential;
    parsed.version = 2;
    migrated = true;
  } else if (!Array.isArray(parsed.supervisors)) {
    throw new Error("قائمة المشرفين في ملف بَيّنات غير صالحة.");
  }
  if (Object.hasOwn(parsed, "adminCredential")) {
    delete parsed.adminCredential;
    migrated = true;
  }

  const validSupervisors =
    parsed.supervisors.length <= MAX_SUPERVISORS &&
    parsed.supervisors.every(
      (supervisor) =>
        isRecord(supervisor) &&
        typeof supervisor.id === "string" &&
        /^[A-Za-z0-9_-]{3,80}$/.test(supervisor.id) &&
        typeof supervisor.displayName === "string" &&
        supervisor.displayName.trim().length >= 2 &&
        supervisor.displayName.trim().length <= 60 &&
        validSupervisorCredential(supervisor.credential)
    ) &&
    new Set(parsed.supervisors.map((supervisor) => supervisor.id)).size ===
      parsed.supervisors.length &&
    new Set(
      parsed.supervisors.map((supervisor) =>
        normalizeAnswer(supervisor.displayName)
      )
    ).size === parsed.supervisors.length;
  if (!validSupervisors) {
    throw new Error("قائمة المشرفين في ملف بَيّنات غير صالحة.");
  }

  if (parsed.supervisors.length > 0) {
    if (parsed.setupKey !== null) {
      parsed.setupKey = null;
      migrated = true;
    }
  } else if (initialSetupKey && parsed.setupKey !== initialSetupKey) {
    parsed.setupKey = initialSetupKey;
    migrated = true;
  } else if (typeof parsed.setupKey !== "string" || parsed.setupKey.length < 8) {
    parsed.setupKey = initialSetupKey || randomBytes(9).toString("base64url");
    migrated = true;
  }

  if (!isRecord(parsed.consumedProofs)) {
    parsed.consumedProofs = {};
    migrated = true;
  } else {
    const now = Date.now();
    for (const [tokenHash, expiresAt] of Object.entries(parsed.consumedProofs)) {
      if (!/^[a-f0-9]{64}$/.test(tokenHash) || !Number.isFinite(expiresAt)) {
        throw new Error("سجل تحققات الدخول في ملف بَيّنات غير صالح.");
      }
      if (expiresAt <= now) {
        delete parsed.consumedProofs[tokenHash];
        migrated = true;
      }
    }
    if (Object.keys(parsed.consumedProofs).length > MAX_CONSUMED_PROOFS) {
      throw new Error("سجل تحققات الدخول في ملف بَيّنات أكبر من الحد المسموح.");
    }
  }
  if (!Object.hasOwn(parsed, "security")) {
    parsed.security = createSecurityState();
    migrated = true;
  } else if (validateSecurityState(parsed.security)) {
    migrated = true;
  }

  const migrateStudent = (student) => {
    if (
      !isRecord(student) ||
      typeof student.name !== "string" ||
      typeof student.className !== "string"
    ) {
      return;
    }
    if (Object.hasOwn(student, "halaqa")) {
      delete student.halaqa;
      migrated = true;
    }
    if (!Number.isInteger(student.revision) || student.revision < 1) {
      student.revision = 1;
      migrated = true;
    }
    const expectedIdentityLookup = studentIdentityLookup(
      parsed.secret,
      student.name,
      student.className
    );
    if (student.identityLookup !== expectedIdentityLookup) {
      student.identityLookup = expectedIdentityLookup;
      migrated = true;
    }
  };

  let latestQuizRoster = [];
  let latestQuizTime = -Infinity;
  for (const [quizId, quiz] of Object.entries(parsed.quizzes)) {
    if (!isRecord(quiz) || quiz.id !== quizId) {
      throw new Error("ملف بيانات بَيّنات غير مكتمل أو تالف؛ تم إيقاف الخادم لحمايته.");
    }
    if (!Array.isArray(quiz.questions) && isRecord(quiz.question)) {
      quiz.questions = [quiz.question];
      delete quiz.question;
      migrated = true;
    } else if (Object.hasOwn(quiz, "question")) {
      delete quiz.question;
      migrated = true;
    }
    if (
      !Array.isArray(quiz.questions) ||
      quiz.questions.length === 0 ||
      quiz.questions.length > MAX_QUESTIONS
    ) {
      throw new Error("ملف بيانات بَيّنات غير مكتمل أو تالف؛ تم إيقاف الخادم لحمايته.");
    }
    for (const question of quiz.questions) {
      if (
        question?.type === "short" &&
        Object.hasOwn(question, "correctAnswer")
      ) {
        delete question.correctAnswer;
        migrated = true;
      }
    }
    if (
      !quiz.questions.every(isStoredQuestion) ||
      new Set(quiz.questions.map((question) => question.id)).size !==
        quiz.questions.length ||
      !Array.isArray(quiz.students) ||
      !Array.isArray(quiz.submissions) ||
      !isRecord(quiz.sessions) ||
      typeof quiz.adminTokenHash !== "string" ||
      !Number.isFinite(new Date(quiz.createdAt).getTime())
    ) {
      throw new Error("ملف بيانات بَيّنات غير مكتمل أو تالف؛ تم إيقاف الخادم لحمايته.");
    }

    for (const student of quiz.students) migrateStudent(student);
    if (!Number.isInteger(quiz.round) || quiz.round < 1) {
      quiz.round = 1;
      migrated = true;
    }
    if (!isRecord(quiz.starts)) {
      quiz.starts = {};
      migrated = true;
    }
    if (!isRecord(quiz.participants)) {
      quiz.participants = {};
      for (const [studentId, startedAt] of Object.entries(quiz.starts)) {
        if (
          quiz.students.some((student) => student.id === studentId) &&
          Number.isFinite(Number(startedAt))
        ) {
          const timestamp = new Date(Number(startedAt)).toISOString();
          quiz.participants[studentId] = {
            studentId,
            firstAccessedAt: timestamp,
            lastAccessedAt: timestamp,
            sessionCount: 1,
          };
        }
      }
      for (const submission of quiz.submissions) {
        if (!quiz.participants[submission.studentId]) {
          quiz.participants[submission.studentId] = {
            studentId: submission.studentId,
            firstAccessedAt: submission.submittedAt,
            lastAccessedAt: submission.submittedAt,
            sessionCount: 1,
          };
        }
      }
      migrated = true;
    }

    const migratedStarts = {};
    for (const [key, startedAt] of Object.entries(quiz.starts)) {
      const legacyStudent = quiz.students.find((student) => student.id === key);
      const nextKey = legacyStudent
        ? questionStartKey(quiz.round, legacyStudent.id, quiz.questions[0].id)
        : key;
      migratedStarts[nextKey] = startedAt;
      if (nextKey !== key) migrated = true;
    }
    quiz.starts = migratedStarts;

    for (const session of Object.values(quiz.sessions)) {
      const sessionStudent = quiz.students.find(
        (student) => student.id === session?.studentId
      );
      if (
        sessionStudent &&
        (!Number.isInteger(session.studentRevision) ||
          session.studentRevision < 1)
      ) {
        session.studentRevision = sessionStudent.revision;
        migrated = true;
      }
      if (!Number.isInteger(session.round) || session.round < 1) {
        session.round = quiz.round;
        migrated = true;
      }
    }

    for (const submission of quiz.submissions) {
      if (
        !submission.questionId &&
        quiz.questions.length === 1
      ) {
        submission.questionId = quiz.questions[0].id;
        migrated = true;
      }
      const question = quiz.questions.find(
        (item) => item.id === submission.questionId
      );
      if (question && migrateGradingRecord(submission, question, quiz.round)) {
        migrated = true;
      }
    }
    if (!Array.isArray(quiz.answerRecords)) {
      quiz.answerRecords = quiz.submissions.map((submission) => ({
        ...structuredClone(submission),
        round: 1,
      }));
      migrated = true;
    }
    for (const record of quiz.answerRecords) {
      if (!record.questionId && quiz.questions.length === 1) {
        record.questionId = quiz.questions[0].id;
        migrated = true;
      }
      const question = quiz.questions.find(
        (item) => item.id === record.questionId
      );
      if (question && migrateGradingRecord(record, question, 1)) {
        migrated = true;
      }
    }
    if (!Array.isArray(quiz.participationRecords)) {
      quiz.participationRecords = Object.values(quiz.participants).map(
        (participant) => ({
          studentId: participant.studentId,
          accessedAt: participant.firstAccessedAt,
          round: 1,
        })
      );
      migrated = true;
    }
    if (!Array.isArray(quiz.resetRequests)) {
      quiz.resetRequests = [];
      migrated = true;
    }

    const validStudents =
      quiz.students.length <= MAX_STUDENTS &&
      quiz.students.every(isStoredStudent) &&
      new Set(quiz.students.map((student) => student.id)).size ===
        quiz.students.length;
    const validSubmissions =
      quiz.submissions.every((submission) =>
        isStoredSubmission(submission, quiz.questions, {
          activeRound: quiz.round,
        })
      ) &&
      new Set(quiz.submissions.map((submission) => submission.id)).size ===
        quiz.submissions.length &&
      new Set(
        quiz.submissions.map(
          (submission) =>
            `${submission.studentId}\u0000${submission.questionId}`
        )
      ).size === quiz.submissions.length;
    const validSessions = Object.values(quiz.sessions).every(
      (session) =>
        typeof session?.tokenHash === "string" &&
        typeof session.studentId === "string" &&
        Number.isInteger(session.studentRevision) &&
        session.studentRevision >= 1 &&
        Number.isInteger(session.round) &&
        session.round >= 1 &&
        Number.isFinite(new Date(session.createdAt).getTime())
    );
    const validStarts = Object.values(quiz.starts).every(
      (startedAt) => Number.isFinite(Number(startedAt))
    );
    const validParticipants = Object.entries(quiz.participants).every(
      ([studentId, participant]) =>
        participant?.studentId === studentId &&
        Number.isFinite(new Date(participant.firstAccessedAt).getTime()) &&
        Number.isFinite(new Date(participant.lastAccessedAt).getTime()) &&
        Number.isInteger(participant.sessionCount) &&
        participant.sessionCount >= 1
    );
    const validAnswerRecords = quiz.answerRecords.every((record) =>
      isStoredSubmission(record, quiz.questions)
    );
    const validParticipationRecords = quiz.participationRecords.every(
      (record) =>
        typeof record?.studentId === "string" &&
        Number.isFinite(new Date(record.accessedAt).getTime()) &&
        Number.isInteger(record.round) &&
        record.round >= 1
    );
    const validResetRequests =
      quiz.resetRequests.length <= MAX_RESET_REQUESTS &&
      quiz.resetRequests.every(
        (record) =>
          isRecord(record) &&
          isValidCreationRequest(record.creationRequest) &&
          isRecord(record.response) &&
          record.response.ok === true &&
          Number.isInteger(record.response.round) &&
          record.response.round >= 2 &&
          isRecord(record.response.cleared) &&
          Number.isInteger(record.response.cleared.submissions) &&
          record.response.cleared.submissions >= 0 &&
          Number.isInteger(record.response.cleared.participants) &&
          record.response.cleared.participants >= 0 &&
          isRecord(record.response.recordsPreserved) &&
          Number.isInteger(record.response.recordsPreserved.answers) &&
          record.response.recordsPreserved.answers >= 0 &&
          Number.isInteger(record.response.recordsPreserved.participations) &&
          record.response.recordsPreserved.participations >= 0 &&
          Number.isFinite(new Date(record.completedAt).getTime())
      );
    if (
      !validStudents ||
      !validSubmissions ||
      !validSessions ||
      !validStarts ||
      !validParticipants ||
      !validAnswerRecords ||
      !validParticipationRecords ||
      !validResetRequests
    ) {
      throw new Error("ملف بيانات بَيّنات غير مكتمل أو تالف؛ تم إيقاف الخادم لحمايته.");
    }

    if (!quiz.expiresAt) {
      quiz.expiresAt = new Date(
        new Date(quiz.createdAt).getTime() + QUIZ_RETENTION_MS
      ).toISOString();
      migrated = true;
    } else if (!Number.isFinite(new Date(quiz.expiresAt).getTime())) {
      throw new Error("تاريخ انتهاء غرفة في ملف بَيّنات غير صالح.");
    }

    const quizTime = new Date(quiz.updatedAt || quiz.createdAt).getTime();
    if (Number.isFinite(quizTime) && quizTime >= latestQuizTime) {
      latestQuizTime = quizTime;
      latestQuizRoster = structuredClone(quiz.students);
    }
  }

  const now = Date.now();
  const activeCandidates = Object.values(parsed.quizzes)
    .filter(
      (quiz) =>
        new Date(quiz.expiresAt).getTime() > now && !quiz.supersededBy
    )
    .sort(
      (first, second) =>
        new Date(second.createdAt).getTime() -
        new Date(first.createdAt).getTime()
    );
  if (
    !Object.hasOwn(parsed, "activeQuizId") ||
    (parsed.activeQuizId === null && activeCandidates.length)
  ) {
    parsed.activeQuizId = activeCandidates[0]?.id || null;
    migrated = true;
  } else if (
    parsed.activeQuizId !== null &&
    (typeof parsed.activeQuizId !== "string" ||
      !parsed.quizzes[parsed.activeQuizId])
  ) {
    throw new Error("مرجع السؤال الأسبوعي النشط في ملف البيانات غير صالح.");
  }
  if (
    parsed.activeQuizId &&
    new Date(parsed.quizzes[parsed.activeQuizId].expiresAt).getTime() <= now
  ) {
    parsed.activeQuizId = null;
    migrated = true;
  }

  if (!Array.isArray(parsed.students)) {
    parsed.students = latestQuizRoster;
    migrated = true;
  }
  for (const student of parsed.students) migrateStudent(student);
  const rosterLookups = parsed.students
    .map((student) => student.pinLookup)
    .filter((lookup) => typeof lookup === "string");
  const validRoster =
    parsed.students.length <= MAX_STUDENTS &&
    parsed.students.every(isStoredStudent) &&
    new Set(parsed.students.map((student) => student.id)).size ===
      parsed.students.length &&
    new Set(rosterLookups).size === rosterLookups.length;
  if (!validRoster) {
    throw new Error("قائمة الطلاب المشتركة في ملف بَيّنات غير صالحة.");
  }

  if (parsed.version !== 3) {
    parsed.version = 3;
    migrated = true;
  }
  return { data: parsed, migrated };
}

export function createInitialData(initialSetupKey = "") {
  return {
    version: 3,
    secret: randomBytes(32).toString("base64url"),
    supervisors: [],
    setupKey: initialSetupKey || randomBytes(9).toString("base64url"),
    consumedProofs: {},
    security: createSecurityState(),
    students: [],
    quizzes: {},
    activeQuizId: null,
  };
}

class JsonStore {
  constructor(filePath, initialSetupKey) {
    this.filePath = filePath;
    this.initialSetupKey = initialSetupKey;
    this.lockPath = `${filePath}.lock`;
    this.lockFd = null;
    this.data = null;
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await this.acquireLock();
    let raw;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") {
        this.close();
        throw error;
      }
    }

    if (raw !== undefined) {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        this.close();
        throw new Error("ملف بيانات بَيّنات تالف؛ تم إيقاف الخادم لحماية البيانات.");
      }
      let validated;
      try {
        validated = validateStoredData(parsed, this.initialSetupKey);
      } catch (error) {
        this.close();
        throw error;
      }
      this.data = validated.data;
      if (validated.migrated) {
        try {
          await this.persist();
        } catch (error) {
          this.close();
          throw error;
        }
      }
      return;
    }

    this.data = createInitialData(this.initialSetupKey);
    try {
      await this.persist();
    } catch (error) {
      this.close();
      throw error;
    }
  }

  async acquireLock() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      this.lockFd = openSync(this.lockPath, "wx", 0o600);
      try {
        writeFileSync(this.lockFd, String(process.pid));
      } catch (error) {
        this.close();
        throw error;
      }
    } catch (error) {
      if (error.code === "EEXIST") {
        throw new Error(
          "ملف بيانات بَيّنات مقفول. تأكد من توقف الخادم الآخر قبل حذف ملف ‎.lock يدويًا."
        );
      }
      throw error;
    }
  }

  read(callback) {
    return callback(this.data);
  }

  update(callback) {
    const operation = this.writeQueue.then(async () => {
      const draft = structuredClone(this.data);
      const result = await callback(draft);
      await this.persist(draft);
      this.data = draft;
      return result;
    });
    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  async persist(data = this.data) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
  }

  close() {
    if (this.lockFd === null) return;
    try {
      closeSync(this.lockFd);
    } catch {
      // The process is already closing; best-effort lock cleanup is sufficient.
    }
    this.lockFd = null;
    try {
      unlinkSync(this.lockPath);
    } catch {
      // A stale lock includes the PID and is recovered safely on next start.
    }
  }
}

function json(response, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  response.end(body);
}

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, "حجم البيانات أكبر من الحد المسموح.", "PAYLOAD_TOO_LARGE");
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "تعذّرت قراءة البيانات المرسلة.", "INVALID_JSON");
  }
}

function safeEqual(first, second) {
  const firstBuffer = Buffer.from(String(first || ""));
  const secondBuffer = Buffer.from(String(second || ""));
  return firstBuffer.length === secondBuffer.length && timingSafeEqual(firstBuffer, secondBuffer);
}

function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function readIdempotencyRequest(request, secret, scope, actorId, body) {
  const key = request.headers["idempotency-key"];
  if (key === undefined) return null;
  if (
    typeof key !== "string" ||
    key.length === 0 ||
    Buffer.byteLength(key) > 255
  ) {
    throw new HttpError(
      400,
      "مفتاح إعادة المحاولة غير صالح.",
      "INVALID_IDEMPOTENCY_KEY"
    );
  }
  return {
    keyHash: createHmac("sha256", secret)
      .update(`idempotency-key:${scope}:${actorId}:${key}`)
      .digest("base64url"),
    requestHash: createHmac("sha256", secret)
      .update(`idempotency-request:${scope}:${canonicalJson(body)}`)
      .digest("base64url"),
  };
}

function findIdempotentResource(resources, idempotency) {
  if (!idempotency) return null;
  const existing = resources.find(
    (resource) => resource.creationRequest?.keyHash === idempotency.keyHash
  );
  if (!existing) return null;
  if (
    !safeEqual(
      existing.creationRequest.requestHash,
      idempotency.requestHash
    )
  ) {
    throw new HttpError(
      409,
      "استُخدم مفتاح إعادة المحاولة لطلب مختلف.",
      "IDEMPOTENCY_KEY_REUSED"
    );
  }
  return existing;
}

function pinLookup(secret, pinOrScope, legacyPin) {
  const scope = legacyPin === undefined ? "roster" : pinOrScope;
  const pin = legacyPin === undefined ? pinOrScope : legacyPin;
  return createHmac("sha256", secret)
    .update(`${scope}:${normalizeDigits(pin)}`)
    .digest("hex");
}

function possiblePinLookups(data, pin) {
  return new Set([
    pinLookup(data.secret, pin),
    ...Object.keys(data.quizzes || {}).map((quizId) =>
      pinLookup(data.secret, quizId, pin)
    ),
  ]);
}

function hashPin(pin, salt = randomBytes(16).toString("base64url")) {
  return new Promise((resolve, reject) => {
    scrypt(normalizeDigits(pin), salt, 32, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({
        pinSalt: salt,
        pinHash: derivedKey.toString("hex"),
      });
    });
  });
}

async function verifyPin(pin, student) {
  const candidate = await new Promise((resolve, reject) => {
    scrypt(normalizeDigits(pin), student.pinSalt, 32, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
  return safeEqual(candidate.toString("hex"), student.pinHash);
}

async function hashSupervisorPassword(password, salt = randomBytes(16).toString("base64url")) {
  const derived = await new Promise((resolve, reject) => {
    scrypt(String(password), salt, 32, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
  return {
    salt,
    hash: derived.toString("hex"),
    createdAt: new Date().toISOString(),
  };
}

async function verifySupervisorPassword(password, credential) {
  if (!credential) return false;
  const candidate = await new Promise((resolve, reject) => {
    scrypt(String(password), credential.salt, 32, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
  return safeEqual(candidate.toString("hex"), credential.hash);
}

function issueSupervisorToken(secret, supervisorId) {
  const expiresAt = Date.now() + SUPERVISOR_SESSION_MS;
  const nonce = randomBytes(24).toString("base64url");
  const payload = `${supervisorId}.${expiresAt}.${nonce}`;
  const signature = createHmac("sha256", secret).update(`supervisor:${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}

function verifySupervisorToken(token, secret) {
  const [supervisorId, expiresAtValue, nonce, signature, ...extra] = String(
    token || ""
  ).split(".");
  if (
    extra.length ||
    !/^[A-Za-z0-9_-]{3,80}$/.test(supervisorId || "") ||
    !/^\d{10,16}$/.test(expiresAtValue || "") ||
    !/^[A-Za-z0-9_-]{20,80}$/.test(nonce || "") ||
    !/^[A-Za-z0-9_-]{30,80}$/.test(signature || "")
  ) {
    return null;
  }
  const expiresAt = Number(expiresAtValue);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  const payload = `${supervisorId}.${expiresAtValue}.${nonce}`;
  const expected = createHmac("sha256", secret)
    .update(`supervisor:${payload}`)
    .digest("base64url");
  return safeEqual(signature, expected) ? supervisorId : null;
}

function canonicalStudentIdentity(name, className) {
  return `${normalizeAnswer(name)}|${normalizeAnswer(className)}`;
}

function studentIdentityLookup(secret, name, className) {
  return createHmac("sha256", secret)
    .update(`student:${canonicalStudentIdentity(name, className)}`)
    .digest("base64url");
}

function canonicalAccessCredential(pin) {
  return normalizeDigits(pin);
}

function issueAccessChallenge(secret, quizId, credential, difficultyBits) {
  const expiresAt = Date.now() + ACCESS_CHALLENGE_MS;
  const nonce = randomBytes(16).toString("base64url");
  const credentialTag = createHmac("sha256", secret)
    .update(`credential:${quizId}:${credential}`)
    .digest("base64url");
  const payload = `${expiresAt}.${nonce}.${difficultyBits}.${credentialTag}`;
  const signature = createHmac("sha256", secret)
    .update(`access-proof:${quizId}:${payload}`)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function hasLeadingZeroBits(buffer, difficultyBits) {
  let remaining = difficultyBits;
  for (const byte of buffer) {
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

function verifyAccessProof({
  secret,
  quizId,
  credential,
  token,
  counter,
  difficultyBits,
}) {
  const [expiresAtValue, nonce, tokenDifficultyValue, credentialTag, signature, ...extra] =
    String(token || "").split(".");
  const tokenDifficulty = Number(tokenDifficultyValue);
  const numericCounter = Number(counter);
  if (
    extra.length ||
    !/^\d{10,16}$/.test(expiresAtValue || "") ||
    !/^[A-Za-z0-9_-]{16,80}$/.test(nonce || "") ||
    !/^[A-Za-z0-9_-]{30,80}$/.test(credentialTag || "") ||
    !/^[A-Za-z0-9_-]{30,80}$/.test(signature || "") ||
    tokenDifficulty !== difficultyBits ||
    !Number.isSafeInteger(numericCounter) ||
    numericCounter < 0
  ) {
    return null;
  }
  const expiresAt = Number(expiresAtValue);
  if (expiresAt <= Date.now() || expiresAt > Date.now() + ACCESS_CHALLENGE_MS + 5_000) {
    return null;
  }
  const expectedCredentialTag = createHmac("sha256", secret)
    .update(`credential:${quizId}:${credential}`)
    .digest("base64url");
  if (!safeEqual(credentialTag, expectedCredentialTag)) return null;
  const payload = `${expiresAtValue}.${nonce}.${tokenDifficultyValue}.${credentialTag}`;
  const expectedSignature = createHmac("sha256", secret)
    .update(`access-proof:${quizId}:${payload}`)
    .digest("base64url");
  if (!safeEqual(signature, expectedSignature)) return null;
  const digest = createHash("sha256").update(`${token}.${numericCounter}`).digest();
  if (!hasLeadingZeroBits(digest, tokenDifficulty)) return null;
  return { expiresAt, tokenHash: hashToken(token) };
}

async function consumeProof(store, { tokenHash, expiresAt }) {
  if (typeof store.consumeProof === "function") {
    const consumed = await store.consumeProof({ tokenHash, expiresAt });
    if (!consumed) {
      throw new HttpError(
        409,
        "استُخدم تحقق الدخول مسبقًا. أعد المحاولة للحصول على تحقق جديد.",
        "ACCESS_PROOF_REPLAYED"
      );
    }
    return;
  }
  await store.update((data) => {
    const now = Date.now();
    data.consumedProofs ||= {};
    for (const [key, expiry] of Object.entries(data.consumedProofs)) {
      if (expiry <= now) delete data.consumedProofs[key];
    }
    const replayed = Object.hasOwn(data.consumedProofs, tokenHash);
    if (replayed) {
      throw new HttpError(
        409,
        "استُخدم تحقق الدخول مسبقًا. أعد المحاولة للحصول على تحقق جديد.",
        "ACCESS_PROOF_REPLAYED"
      );
    }
    if (Object.keys(data.consumedProofs).length >= MAX_CONSUMED_PROOFS) {
      throw new HttpError(
        503,
        "تعذّر بدء محاولة جديدة الآن. انتظر قليلًا ثم حاول مرة أخرى.",
        "ACCESS_PROOF_CAPACITY"
      );
    }
    data.consumedProofs[tokenHash] = expiresAt;
  });
}

function publicStudent(student) {
  return {
    id: student.id,
    name: student.name,
    className: student.className,
  };
}

function publicSupervisor(supervisor) {
  return {
    id: supervisor.id,
    displayName: supervisor.displayName,
    createdAt: supervisor.credential.createdAt,
  };
}

function publicQuestion(question) {
  const { id, type, prompt, options, createdAt } = question;
  return { id, type, prompt, options, createdAt };
}

function publicQuestionSummary(question) {
  return { id: question.id, type: question.type };
}

function quizCreationPayload(quiz, adminToken) {
  return {
    quizId: quiz.id,
    questionId: quiz.questions[0].id,
    adminToken,
    studentPath: `/student.html?q=${encodeURIComponent(quiz.id)}`,
    quiz: serializeAdminQuiz(quiz),
  };
}

function serializeParticipants(quiz) {
  return Object.values(quiz.participants || {}).map((participant) => ({
    studentId: participant.studentId,
    firstAccessedAt: participant.firstAccessedAt,
    lastAccessedAt: participant.lastAccessedAt,
    sessionCount: participant.sessionCount,
  }));
}

function calculateSubmissionScore(submission, speedPlace) {
  if (
    submission.gradingStatus !== "graded" ||
    submission.isCorrect !== true
  ) {
    return {
      accuracyPoints: 0,
      speedPoints: 0,
      placePoints: 0,
      total: 0,
    };
  }
  const elapsedMs = Math.max(0, Number(submission.elapsedMs) || 0);
  const speedPoints = Math.max(
    0,
    60 - Math.floor((elapsedMs / 1_000) * 2)
  );
  const placePoints = PLACE_BONUSES[speedPlace - 1] || 0;
  return {
    accuracyPoints: 100,
    speedPoints,
    placePoints,
    total: 100 + speedPoints + placePoints,
  };
}

function isObjectiveAnswerCorrect(question, answer) {
  return (
    question.type !== "short" &&
    normalizeAnswer(answer) === normalizeAnswer(question.correctAnswer)
  );
}

function compareIds(first, second) {
  return first < second ? -1 : first > second ? 1 : 0;
}

function serializeLeaderboard(quiz) {
  const speedPlaces = new Map();
  for (const question of quiz.questions) {
    quiz.submissions
      .filter(
        (submission) =>
          submission.questionId === question.id &&
          submission.gradingStatus === "graded" &&
          submission.isCorrect === true
      )
      .slice()
      .sort(
        (first, second) =>
          first.elapsedMs - second.elapsedMs ||
          compareIds(first.studentId, second.studentId) ||
          compareIds(first.id, second.id)
      )
      .forEach((submission, index) => {
        speedPlaces.set(submission.id, index + 1);
      });
  }

  const aggregateByStudent = new Map();
  for (const submission of quiz.submissions) {
    const student = quiz.students.find(
      (item) => item.id === submission.studentId
    ) || {
      id: submission.studentId,
      name: "طالب",
      className: "—",
    };
    const aggregate = aggregateByStudent.get(submission.studentId) || {
      id: submission.studentId,
      student: publicStudent(student),
      accuracyPoints: 0,
      speedPoints: 0,
      placePoints: 0,
      total: 0,
      correctCount: 0,
      answeredCount: 0,
      pendingCount: 0,
      elapsedMs: 0,
    };
    const score = calculateSubmissionScore(
      submission,
      speedPlaces.get(submission.id) || 0
    );
    aggregate.accuracyPoints += score.accuracyPoints;
    aggregate.speedPoints += score.speedPoints;
    aggregate.placePoints += score.placePoints;
    aggregate.total += score.total;
    aggregate.correctCount += Number(
      submission.gradingStatus === "graded" && submission.isCorrect === true
    );
    aggregate.answeredCount += 1;
    aggregate.pendingCount += Number(submission.gradingStatus === "pending");
    aggregate.elapsedMs += Math.max(0, Number(submission.elapsedMs) || 0);
    aggregateByStudent.set(submission.studentId, aggregate);
  }

  return [...aggregateByStudent.values()]
    .sort(
      (first, second) =>
        second.total - first.total ||
        second.correctCount - first.correctCount ||
        first.elapsedMs - second.elapsedMs ||
        compareIds(first.student.id, second.student.id)
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

function serializeAdminQuestion(question) {
  const { creationRequest, ...serialized } = question;
  return structuredClone(serialized);
}

function serializeAdminSubmission(submission) {
  return {
    ...structuredClone(submission),
    gradeHistory: submission.gradeHistory.map(
      ({ creationRequest, ...grade }) => structuredClone(grade)
    ),
  };
}

function serializeAdminQuiz(quiz) {
  return {
    id: quiz.id,
    questions: quiz.questions.map(serializeAdminQuestion),
    questionCount: quiz.questions.length,
    students: quiz.students.map(publicStudent),
    submissions: quiz.submissions.map(serializeAdminSubmission),
    participants: serializeParticipants(quiz),
    answerRecords: quiz.answerRecords.map(serializeAdminSubmission),
    participationRecords: structuredClone(quiz.participationRecords),
    round: quiz.round,
    leaderboard: serializeLeaderboard(quiz),
    studentPath: `/student.html?q=${encodeURIComponent(quiz.id)}`,
    createdAt: quiz.createdAt,
    expiresAt: quiz.expiresAt,
    updatedAt: quiz.updatedAt,
  };
}

function nextUnansweredQuestion(quiz, studentId) {
  const answered = new Set(
    quiz.submissions
      .filter((submission) => submission.studentId === studentId)
      .map((submission) => submission.questionId)
  );
  return quiz.questions.find((question) => !answered.has(question.id)) || null;
}

function ensureNextQuestionStart(quiz, studentId, now = Date.now()) {
  quiz.starts ||= {};
  const question = nextUnansweredQuestion(quiz, studentId);
  if (!question) return null;
  const key = questionStartKey(quiz.round, studentId, question.id);
  if (!Number.isFinite(Number(quiz.starts[key]))) {
    quiz.starts[key] = now;
  }
  return question;
}

function studentProgress(quiz, studentId) {
  const submissions = quiz.submissions.filter(
    (submission) => submission.studentId === studentId
  );
  const answeredQuestionIds = new Set(
    submissions.map((submission) => submission.questionId)
  );
  const answeredCount = answeredQuestionIds.size;
  const pendingCount = submissions.filter(
    (submission) => submission.gradingStatus === "pending"
  ).length;
  return {
    answeredCount,
    totalQuestions: quiz.questions.length,
    remainingCount: Math.max(0, quiz.questions.length - answeredCount),
    pendingCount,
  };
}

function publicQuizMetadata(quiz) {
  return {
    id: quiz.id,
    round: quiz.round,
    questions: quiz.questions.map(publicQuestionSummary),
    questionCount: quiz.questions.length,
    participantCount: Math.max(
      serializeParticipants(quiz).length,
      new Set(quiz.submissions.map((submission) => submission.studentId)).size
    ),
    updatedAt: quiz.updatedAt,
  };
}

function serializeStudentSession(quiz, student) {
  const question = nextUnansweredQuestion(quiz, student.id);
  const progress = studentProgress(quiz, student.id);
  const completed = progress.remainingCount === 0;
  const pending = progress.pendingCount > 0;
  return {
    student: publicStudent(student),
    quiz: publicQuizMetadata(quiz),
    question: question ? publicQuestion(question) : null,
    progress,
    completed,
    pending,
    status: !completed ? "in_progress" : pending ? "pending" : "complete",
    leaderboard: serializeLeaderboard(quiz),
  };
}

function serializeStudentSubmission(submission) {
  return {
    id: submission.id,
    questionId: submission.questionId,
    answer: submission.answer,
    gradingStatus: submission.gradingStatus,
    isCorrect: submission.isCorrect,
    elapsedMs: submission.elapsedMs,
    submittedAt: submission.submittedAt,
    gradedBy: submission.gradedBy,
    gradedAt: submission.gradedAt,
    gradeRevision: submission.gradeRevision,
  };
}

function serializeResult(quiz, submission) {
  const leaderboard = serializeLeaderboard(quiz);
  const entry =
    leaderboard.find((item) => item.student.id === submission.studentId) ||
    null;
  const nextQuestion = nextUnansweredQuestion(quiz, submission.studentId);
  const progress = studentProgress(quiz, submission.studentId);
  const completed = progress.remainingCount === 0;
  const pending = progress.pendingCount > 0;
  return {
    submission: serializeStudentSubmission(submission),
    entry,
    participantCount: Math.max(serializeParticipants(quiz).length, leaderboard.length),
    leaderboard,
    nextQuestion: nextQuestion ? publicQuestion(nextQuestion) : null,
    progress,
    completed,
    pending,
    status: !completed ? "in_progress" : pending ? "pending" : "complete",
  };
}

function sanitizeQuestion(
  question,
  { id, creationRequest = null } = {}
) {
  const cleaned = {
    id,
    type: String(question?.type || ""),
    prompt: String(question?.prompt || "").trim(),
    options: Array.isArray(question?.options)
      ? question.options.map((option) => String(option).trim()).filter(Boolean)
      : [],
    createdAt: new Date().toISOString(),
    ...(creationRequest ? { creationRequest } : {}),
  };
  if (cleaned.type === "short") {
    cleaned.options = [];
  } else {
    cleaned.correctAnswer = String(question?.correctAnswer || "").trim();
    if (cleaned.type === "boolean") cleaned.options = ["صح", "خطأ"];
  }
  const validation = validateQuestionContract(cleaned);
  if (!validation.valid) {
    throw new HttpError(400, validation.error, "INVALID_QUESTION");
  }
  return cleaned;
}

function validateStudentInputValue(student, { pinRequired = true } = {}) {
  const name = String(student?.name || "").trim();
  const className = String(student?.className || "").trim();
  const pin = normalizeDigits(student?.pin || "").trim();
  if (name.length < 2) {
    return { valid: false, error: "اكتب اسم الطالب كاملًا." };
  }
  if (!className) {
    return { valid: false, error: "اختر صف الطالب." };
  }
  if (pinRequired && !/^\d{4}$/.test(pin)) {
    return { valid: false, error: "يجب أن يتكوّن رمز الدخول من ٤ أرقام." };
  }
  if (!pinRequired && pin && !/^\d{4}$/.test(pin)) {
    return {
      valid: false,
      error: "رمز الدخول الجديد يجب أن يتكوّن من ٤ أرقام.",
    };
  }
  return { valid: true, value: { name, className, pin } };
}

function sanitizeStudentInputs(students, secret) {
  if (!Array.isArray(students) || students.length === 0) {
    throw new HttpError(400, "أضف طالبًا واحدًا على الأقل قبل نشر السؤال.", "EMPTY_ROSTER");
  }
  if (students.length > MAX_STUDENTS) {
    throw new HttpError(400, `الحد الأعلى هو ${MAX_STUDENTS} طالبًا.`, "ROSTER_TOO_LARGE");
  }

  const accepted = [];
  for (const student of students) {
    const validation = validateStudentInputValue(student);
    if (!validation.valid) {
      throw new HttpError(400, validation.error, "INVALID_STUDENT");
    }
    const id =
      typeof student.id === "string" && /^[a-zA-Z0-9_-]{3,80}$/.test(student.id)
        ? student.id
        : `student-${randomBytes(7).toString("base64url")}`;
    if (accepted.some((item) => item.id === id)) {
      throw new HttpError(400, "معرّف الطالب مكرر.", "INVALID_STUDENT");
    }
    const lookup = pinLookup(secret, validation.value.pin);
    const identityLookup = studentIdentityLookup(
      secret,
      validation.value.name,
      validation.value.className
    );
    if (accepted.some((item) => item.pinLookup === lookup)) {
      throw new HttpError(
        400,
        "رمز الدخول مستخدم لطالب آخر. اختر رمزًا مختلفًا.",
        "INVALID_STUDENT"
      );
    }
    accepted.push({
      id,
      name: validation.value.name,
      className: validation.value.className,
      revision: 1,
      pin: validation.value.pin,
      pinLookup: lookup,
      identityLookup,
    });
  }
  return accepted;
}

async function hashStudentInputs(students) {
  const secured = [];
  for (const student of students) {
    const { pin, ...publicFields } = student;
    secured.push({
      ...publicFields,
      ...(await hashPin(pin)),
    });
  }
  return secured;
}

function requireConfiguredStudentSelection(className) {
  if (!DEFAULT_CLASS_OPTIONS.includes(className)) {
    throw new HttpError(400, "اختر صفًا من القائمة المعتمدة.", "INVALID_STUDENT_CLASS");
  }
}

function requireQuiz(store, quizId) {
  const quiz = store.read((data) => data.quizzes[quizId]);
  if (!quiz) throw new HttpError(404, "رابط السؤال غير صالح أو انتهى.", "QUIZ_NOT_FOUND");
  if (quiz.expiresAt && new Date(quiz.expiresAt).getTime() <= Date.now()) {
    throw new HttpError(410, "انتهت صلاحية رابط الأسئلة الأسبوعية. اطلب رابطًا جديدًا.", "QUIZ_EXPIRED");
  }
  if (store.data.activeQuizId !== quiz.id) {
    throw new HttpError(
      410,
      "استُبدل هذا الرابط بأسبوع جديد. اطلب الرابط الأحدث من المشرف.",
      "QUIZ_SUPERSEDED"
    );
  }
  return quiz;
}

function requireAdmin(request, quiz, store) {
  return requireSupervisor(request, store);
}

function requireSupervisor(request, store) {
  const token = request.headers["x-supervisor-token"];
  const supervisorId = verifySupervisorToken(token, store.data.secret);
  const supervisor = supervisorId
    ? store.data.supervisors.find((item) => item.id === supervisorId)
    : null;
  if (!supervisor) {
    throw new HttpError(
      401,
      "سجّل دخول المشرف للمتابعة.",
      "SUPERVISOR_UNAUTHORIZED"
    );
  }
  return supervisor;
}

function readSupervisorDisplayName(body) {
  const displayName = String(body?.displayName || "").trim().replace(/\s+/g, " ");
  if (displayName.length < 2 || displayName.length > 60) {
    throw new HttpError(
      400,
      "اكتب اسم المشرف من حرفين إلى ٦٠ حرفًا.",
      "INVALID_SUPERVISOR_NAME"
    );
  }
  return displayName;
}

function readSupervisorPassword(body) {
  const password = String(body?.password || "");
  if (password.length < 6 || password.length > 128) {
    throw new HttpError(
      400,
      "اختر رمز مشرف لا يقل عن ٦ خانات.",
      "INVALID_SUPERVISOR_PASSWORD"
    );
  }
  return password;
}

function readStudentAccessInput(body) {
  const pin = normalizeDigits(body?.pin || "").trim();
  if (!/^\d{4}$/.test(pin)) {
    throw new HttpError(400, "أدخل رمزًا صحيحًا من ٤ أرقام.", "INVALID_PIN");
  }
  return {
    pin,
    credential: canonicalAccessCredential(pin),
  };
}

function requireStudent(request, quiz) {
  const authorization = request.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const tokenHash = hashToken(token);
  const session = Object.values(quiz.sessions).find((item) => safeEqual(item.tokenHash, tokenHash));
  if (!session) {
    throw new HttpError(401, "أعد إدخال رمز الطالب للمتابعة.", "STUDENT_UNAUTHORIZED");
  }
  const student = quiz.students.find((item) => item.id === session.studentId);
  if (
    !student ||
    session.studentRevision !== student.revision ||
    session.round !== quiz.round
  ) {
    throw new HttpError(401, "لم يعد الطالب موجودًا في هذا التحدّي.", "STUDENT_UNAUTHORIZED");
  }
  return { student, session };
}

function getClientIp(request, trustProxy) {
  const forwarded = trustProxy ? request.headers["x-forwarded-for"] : "";
  return String(forwarded || request.socket.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}

function rateLimitKey(store, request, trustProxy, scope) {
  return createHmac("sha256", store.data.secret)
    .update(`${scope}:${getClientIp(request, trustProxy)}`)
    .digest("hex");
}

function limitRecordSize(record, latestTimestamp) {
  const entries = Object.entries(record);
  if (entries.length <= MAX_RATE_LIMIT_KEYS) return;
  entries
    .sort(
      ([, first], [, second]) =>
        latestTimestamp(first) - latestTimestamp(second)
    )
    .slice(0, entries.length - MAX_RATE_LIMIT_KEYS)
    .forEach(([key]) => delete record[key]);
}

function currentSupervisorAttempts(data, key, now) {
  const stored = data.security.supervisorAttempts[key] || {
    failures: [],
    reservations: {},
  };
  return {
    failures: stored.failures.filter(
      (timestamp) => now - timestamp < ACCESS_WINDOW_MS
    ),
    reservations: Object.fromEntries(
      Object.entries(stored.reservations).filter(
        ([, timestamp]) => now - timestamp < ACCESS_WINDOW_MS
      )
    ),
  };
}

function createQuizCreationLimiter(store, trustProxy) {
  return (request, recordCreation = false) => {
    const now = Date.now();
    const key = rateLimitKey(store, request, trustProxy, "quiz-creation");
    return (data) => {
      const recentForIp = (data.security.quizCreations.byIp[key] || []).filter(
        (timestamp) => now - timestamp < QUIZ_CREATION_WINDOW_MS
      );
      const recentGlobal = data.security.quizCreations.global.filter(
        (timestamp) => now - timestamp < QUIZ_CREATION_WINDOW_MS
      );
      if (
        recentForIp.length >= QUIZ_CREATION_IP_LIMIT ||
        recentGlobal.length >= QUIZ_CREATION_GLOBAL_LIMIT
      ) {
        throw new HttpError(
          429,
          "تم إنشاء عدة أسئلة مؤخرًا. انتظر قليلًا قبل نشر سؤال جديد.",
          "QUIZ_CREATION_LIMIT"
        );
      }
      if (recordCreation) {
        recentForIp.push(now);
        recentGlobal.push(now);
      }
      data.security.quizCreations.byIp[key] = recentForIp;
      data.security.quizCreations.global = recentGlobal;
      limitRecordSize(
        data.security.quizCreations.byIp,
        (timestamps) => Math.max(...timestamps)
      );
    };
  };
}

function createSupervisorLimiter(store, trustProxy) {
  const keyFor = (request) =>
    rateLimitKey(store, request, trustProxy, "supervisor-login");
  const saveState = (data, key, state) => {
    if (!state.failures.length && !Object.keys(state.reservations).length) {
      delete data.security.supervisorAttempts[key];
    } else {
      data.security.supervisorAttempts[key] = state;
      limitRecordSize(data.security.supervisorAttempts, (entry) =>
        Math.max(
          0,
          ...entry.failures,
          ...Object.values(entry.reservations)
        )
      );
    }
  };
  return {
    async tryReserve(request) {
      const key = keyFor(request);
      const now = Date.now();
      const reservationId = randomBytes(9).toString("base64url");
      return store.update((data) => {
        const state = currentSupervisorAttempts(data, key, now);
        if (
          state.failures.length + Object.keys(state.reservations).length >=
          SUPERVISOR_ATTEMPTS_LIMIT
        ) {
          saveState(data, key, state);
          return null;
        }
        state.reservations[reservationId] = now;
        saveState(data, key, state);
        return reservationId;
      });
    },
    async recordFailure(request) {
      const key = keyFor(request);
      const now = Date.now();
      return store.update((data) => {
        const state = currentSupervisorAttempts(data, key, now);
        const limited =
          state.failures.length + Object.keys(state.reservations).length >=
          SUPERVISOR_ATTEMPTS_LIMIT;
        if (state.failures.length < SUPERVISOR_ATTEMPTS_LIMIT) {
          state.failures.push(now);
        }
        saveState(data, key, state);
        return limited;
      });
    },
    async finishFailure(request, reservationId) {
      const key = keyFor(request);
      const now = Date.now();
      await store.update((data) => {
        const state = currentSupervisorAttempts(data, key, now);
        delete state.reservations[reservationId];
        if (state.failures.length < SUPERVISOR_ATTEMPTS_LIMIT) {
          state.failures.push(now);
        }
        saveState(data, key, state);
      });
    },
    async release(request, reservationId) {
      const key = keyFor(request);
      const now = Date.now();
      await store.update((data) => {
        const state = currentSupervisorAttempts(data, key, now);
        delete state.reservations[reservationId];
        saveState(data, key, state);
      });
    },
    async clear(request) {
      const key = keyFor(request);
      await store.update((data) => {
        delete data.security.supervisorAttempts[key];
      });
    },
  };
}

function createStudentLimiter(store, trustProxy) {
  const keyFor = (request, quizId) =>
    rateLimitKey(
      store,
      request,
      trustProxy,
      `student-login:${quizId}`
    );
  const currentAttempts = (data, key, now) => {
    const stored = data.security.studentAttempts[key] || {
      failures: [],
      reservations: {},
    };
    return {
      failures: stored.failures.filter(
        (timestamp) => now - timestamp < ACCESS_WINDOW_MS
      ),
      reservations: Object.fromEntries(
        Object.entries(stored.reservations).filter(
          ([, timestamp]) => now - timestamp < ACCESS_WINDOW_MS
        )
      ),
    };
  };
  const saveState = (data, key, state) => {
    if (!state.failures.length && !Object.keys(state.reservations).length) {
      delete data.security.studentAttempts[key];
      return;
    }
    data.security.studentAttempts[key] = state;
    limitRecordSize(data.security.studentAttempts, (entry) =>
      Math.max(
        0,
        ...entry.failures,
        ...Object.values(entry.reservations)
      )
    );
  };
  return {
    async tryReserve(request, quizId) {
      const key = keyFor(request, quizId);
      const now = Date.now();
      const reservationId = randomBytes(9).toString("base64url");
      return store.update((data) => {
        const state = currentAttempts(data, key, now);
        if (
          state.failures.length + Object.keys(state.reservations).length >=
          STUDENT_ATTEMPTS_LIMIT
        ) {
          saveState(data, key, state);
          return null;
        }
        state.reservations[reservationId] = now;
        saveState(data, key, state);
        return reservationId;
      });
    },
    async finish(request, quizId, reservationId, failed) {
      const key = keyFor(request, quizId);
      const now = Date.now();
      await store.update((data) => {
        const state = currentAttempts(data, key, now);
        delete state.reservations[reservationId];
        if (failed && state.failures.length < STUDENT_ATTEMPTS_LIMIT) {
          state.failures.push(now);
        }
        saveState(data, key, state);
      });
    },
  };
}

async function serveStatic(request, response, pathname) {
  const publicFile = PUBLIC_FILES.get(pathname);
  if (!publicFile) throw new HttpError(404, "الصفحة غير موجودة.", "NOT_FOUND");
  const filePath = path.join(ROOT_DIR, publicFile);
  try {
    const content = await readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      "Content-Length": content.length,
      "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=300",
      ...securityHeaders(),
    });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      throw new HttpError(404, "الصفحة غير موجودة.", "NOT_FOUND");
    }
    throw error;
  }
}

export async function createBaynatServer({
  dataFile = DEFAULT_DATA_FILE,
  store: providedStore = null,
  trustProxy = process.env.TRUST_PROXY === "true",
  setupKey = process.env.BAYNAT_SETUP_KEY || "",
  accessDifficultyBits = Number(process.env.BAYNAT_ACCESS_DIFFICULTY || 20),
  supervisorDifficultyBits = Number(process.env.BAYNAT_SUPERVISOR_DIFFICULTY || 16),
  nodeEnvironment = process.env.NODE_ENV || "",
  logger = console,
} = {}) {
  if (
    !Number.isInteger(accessDifficultyBits) ||
    accessDifficultyBits < 8 ||
    accessDifficultyBits > 24 ||
    (nodeEnvironment === "production" && accessDifficultyBits < 20)
  ) {
    throw new Error("قيمة BAYNAT_ACCESS_DIFFICULTY يجب أن تكون بين 20 و24 في الإنتاج.");
  }
  if (
    !Number.isInteger(supervisorDifficultyBits) ||
    supervisorDifficultyBits < 8 ||
    supervisorDifficultyBits > 24 ||
    (nodeEnvironment === "production" && supervisorDifficultyBits < 16)
  ) {
    throw new Error("قيمة BAYNAT_SUPERVISOR_DIFFICULTY يجب أن تكون بين 16 و24 في الإنتاج.");
  }
  const store = providedStore || new JsonStore(dataFile, setupKey);
  await store.init();
  const challengeSecret = createHmac("sha256", store.data.secret)
    .update("baynat:access-challenge:v1")
    .digest("base64url");
  const recordQuizCreation = createQuizCreationLimiter(store, trustProxy);
  const supervisorLimiter = createSupervisorLimiter(store, trustProxy);
  const studentLimiter = createStudentLimiter(store, trustProxy);

  const handler = async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
      const pathname = url.pathname.replace(/\/+$/, "") || "/";

      if (pathname === "/api/health" && request.method === "GET") {
        json(response, 200, { ok: true, service: "baynat" }, securityHeaders());
        return;
      }

      if (pathname === "/api/admin/status" && request.method === "GET") {
        json(
          response,
          200,
          {
            configured: store.data.supervisors.length > 0,
            requiresSetupKey: store.data.supervisors.length === 0,
            supervisorNames: store.data.supervisors.map(
              (supervisor) => supervisor.displayName
            ),
          },
          securityHeaders()
        );
        return;
      }

      if (pathname === "/api/admin/session" && request.method === "GET") {
        const supervisor = requireSupervisor(request, store);
        json(
          response,
          200,
          { ok: true, supervisor: publicSupervisor(supervisor) },
          securityHeaders()
        );
        return;
      }

      if (pathname === "/api/admin/dashboard" && request.method === "GET") {
        requireSupervisor(request, store);
        const now = Date.now();
        const latestQuiz = store.data.activeQuizId
          ? store.data.quizzes[store.data.activeQuizId]
          : null;
        const activeQuiz =
          latestQuiz &&
          (!latestQuiz.expiresAt ||
            new Date(latestQuiz.expiresAt).getTime() > now)
            ? latestQuiz
            : null;
        json(
          response,
          200,
          { quiz: activeQuiz ? serializeAdminQuiz(activeQuiz) : null },
          securityHeaders()
        );
        return;
      }

      if (pathname === "/api/admin/setup" && request.method === "POST") {
        if (request.headers["sec-fetch-site"] === "cross-site") {
          throw new HttpError(403, "الطلب غير مسموح من موقع آخر.", "CROSS_SITE_REQUEST");
        }
        if (store.data.supervisors.length > 0) {
          throw new HttpError(
            409,
            "تم إعداد رمز المشرف مسبقًا.",
            "SUPERVISOR_ALREADY_CONFIGURED"
          );
        }
        const body = await readJsonBody(request);
        if (!store.data.setupKey || !safeEqual(body.setupKey, store.data.setupKey)) {
          const limited = await supervisorLimiter.recordFailure(request);
          if (limited) {
            throw new HttpError(
              429,
              "محاولات تهيئة كثيرة. أدخل مفتاح التهيئة الصحيح للمتابعة.",
              "SUPERVISOR_SETUP_LIMIT"
            );
          }
          throw new HttpError(
            401,
            "مفتاح التهيئة غير صحيح. تحقّق من المفتاح ثم حاول مجددًا.",
            "SETUP_KEY_REJECTED"
          );
        }
        const displayName = readSupervisorDisplayName(body);
        const password = readSupervisorPassword(body);
        const credential = await hashSupervisorPassword(password);
        const supervisor = {
          id: `supervisor-${randomBytes(7).toString("base64url")}`,
          displayName,
          credential,
        };
        await store.update((data) => {
          if (data.supervisors.length > 0) {
            throw new HttpError(
              409,
              "تم إعداد رمز المشرف مسبقًا.",
              "SUPERVISOR_ALREADY_CONFIGURED"
            );
          }
          if (
            !data.setupKey ||
            !safeEqual(body.setupKey, data.setupKey)
          ) {
            throw new HttpError(
              401,
              "مفتاح التهيئة غير صحيح. تحقّق من المفتاح ثم حاول مجددًا.",
              "SETUP_KEY_REJECTED"
            );
          }
          data.supervisors.push(supervisor);
          data.setupKey = null;
        });
        await supervisorLimiter.clear(request);
        json(
          response,
          201,
          {
            token: issueSupervisorToken(store.data.secret, supervisor.id),
            supervisor: publicSupervisor(supervisor),
          },
          securityHeaders()
        );
        return;
      }

      if (pathname === "/api/admin/login" && request.method === "POST") {
        const body = await readJsonBody(request);
        const displayName = readSupervisorDisplayName(body);
        const password = readSupervisorPassword(body);
        const loginCredential = `${normalizeAnswer(displayName)}|${password}`;
        const reservedAttempt = await supervisorLimiter.tryReserve(request);
        if (!reservedAttempt) {
          const proof = verifyAccessProof({
            secret: challengeSecret,
            quizId: "supervisor-login",
            credential: loginCredential,
            token: body.challengeToken,
            counter: body.challengeCounter,
            difficultyBits: supervisorDifficultyBits,
          });
          if (!proof) {
            throw new HttpError(
              429,
              "أكمل التحقق الآمن للمتابعة دون انتظار.",
              "SUPERVISOR_PROOF_REQUIRED",
              {
                challengeToken: issueAccessChallenge(
                  challengeSecret,
                  "supervisor-login",
                  loginCredential,
                  supervisorDifficultyBits
                ),
                difficultyBits: supervisorDifficultyBits,
              }
            );
          }
          await consumeProof(store, proof);
        }
        const supervisor = store.data.supervisors.find(
          (item) =>
            normalizeAnswer(item.displayName) === normalizeAnswer(displayName)
        );
        const credential =
          supervisor?.credential || store.data.supervisors[0]?.credential;
        let validPassword;
        try {
          validPassword = await verifySupervisorPassword(
            password,
            credential
          );
        } catch (error) {
          if (reservedAttempt) {
            await supervisorLimiter.release(request, reservedAttempt);
          }
          throw error;
        }
        if (!supervisor || !validPassword) {
          if (reservedAttempt) {
            await supervisorLimiter.finishFailure(request, reservedAttempt);
          }
          throw new HttpError(
            401,
            "اسم المشرف أو الرمز غير صحيح.",
            "SUPERVISOR_LOGIN_REJECTED"
          );
        }
        await supervisorLimiter.clear(request);
        json(
          response,
          200,
          {
            token: issueSupervisorToken(store.data.secret, supervisor.id),
            supervisor: publicSupervisor(supervisor),
          },
          securityHeaders()
        );
        return;
      }

      const supervisorAccountMatch = pathname.match(
        /^\/api\/admin\/supervisors(?:\/([A-Za-z0-9_-]+))?$/
      );
      if (supervisorAccountMatch) {
        const currentSupervisor = requireSupervisor(request, store);
        const supervisorId = supervisorAccountMatch[1];
        if (request.method === "GET" && !supervisorId) {
          json(
            response,
            200,
            {
              supervisors: store.data.supervisors.map(publicSupervisor),
              currentSupervisorId: currentSupervisor.id,
            },
            securityHeaders()
          );
          return;
        }
        if (request.headers["sec-fetch-site"] === "cross-site") {
          throw new HttpError(403, "الطلب غير مسموح من موقع آخر.", "CROSS_SITE_REQUEST");
        }
        if (request.method === "POST" && !supervisorId) {
          const body = await readJsonBody(request);
          const displayName = readSupervisorDisplayName(body);
          const password = readSupervisorPassword(body);
          const credential = await hashSupervisorPassword(password);
          const supervisor = {
            id: `supervisor-${randomBytes(7).toString("base64url")}`,
            displayName,
            credential,
          };
          await store.update((data) => {
            if (data.supervisors.length >= MAX_SUPERVISORS) {
              throw new HttpError(
                400,
                `الحد الأعلى هو ${MAX_SUPERVISORS} مشرفًا.`,
                "SUPERVISOR_LIMIT"
              );
            }
            if (
              data.supervisors.some(
                (item) =>
                  normalizeAnswer(item.displayName) ===
                  normalizeAnswer(displayName)
              )
            ) {
              throw new HttpError(
                409,
                "اسم المشرف مستخدم بالفعل.",
                "DUPLICATE_SUPERVISOR"
              );
            }
            data.supervisors.push(supervisor);
          });
          json(
            response,
            201,
            { supervisor: publicSupervisor(supervisor) },
            securityHeaders()
          );
          return;
        }
        if (request.method === "PATCH" && supervisorId) {
          const body = await readJsonBody(request);
          const displayName = readSupervisorDisplayName(body);
          let updatedSupervisor;
          await store.update((data) => {
            const supervisor = data.supervisors.find(
              (item) => item.id === supervisorId
            );
            if (!supervisor) {
              throw new HttpError(
                404,
                "حساب المشرف غير موجود.",
                "SUPERVISOR_NOT_FOUND"
              );
            }
            if (
              data.supervisors.some(
                (item) =>
                  item.id !== supervisorId &&
                  normalizeAnswer(item.displayName) ===
                    normalizeAnswer(displayName)
              )
            ) {
              throw new HttpError(
                409,
                "اسم المشرف مستخدم بالفعل.",
                "DUPLICATE_SUPERVISOR"
              );
            }
            supervisor.displayName = displayName;
            updatedSupervisor = structuredClone(supervisor);
          });
          json(
            response,
            200,
            { supervisor: publicSupervisor(updatedSupervisor) },
            securityHeaders()
          );
          return;
        }
        if (request.method === "DELETE" && supervisorId) {
          if (supervisorId === currentSupervisor.id) {
            throw new HttpError(
              400,
              "لا يمكنك حذف الحساب الذي تستخدمه الآن.",
              "CANNOT_DELETE_CURRENT_SUPERVISOR"
            );
          }
          await store.update((data) => {
            if (!data.supervisors.some((item) => item.id === supervisorId)) {
              throw new HttpError(
                404,
                "حساب المشرف غير موجود.",
                "SUPERVISOR_NOT_FOUND"
              );
            }
            if (data.supervisors.length <= 1) {
              throw new HttpError(
                400,
                "يجب أن يبقى حساب مشرف واحد على الأقل.",
                "CANNOT_DELETE_LAST_SUPERVISOR"
              );
            }
            data.supervisors = data.supervisors.filter(
              (item) => item.id !== supervisorId
            );
          });
          json(response, 200, { ok: true }, securityHeaders());
          return;
        }
      }

      const rosterMatch = pathname.match(/^\/api\/students(?:\/([A-Za-z0-9_-]+))?$/);
      if (rosterMatch) {
        const currentSupervisor = requireSupervisor(request, store);
        if (request.method === "GET" && !rosterMatch[1]) {
          json(
            response,
            200,
            { students: store.data.students.map(publicStudent) },
            securityHeaders()
          );
          return;
        }
        if (request.headers["sec-fetch-site"] === "cross-site") {
          throw new HttpError(403, "الطلب غير مسموح من موقع آخر.", "CROSS_SITE_REQUEST");
        }
        if (request.method === "POST" && !rosterMatch[1]) {
          const body = await readJsonBody(request);
          const idempotency = readIdempotencyRequest(
            request,
            store.data.secret,
            "student-create",
            currentSupervisor.id,
            body
          );
          const validation = validateStudentInputValue(body);
          if (!validation.valid) {
            throw new HttpError(400, validation.error, "INVALID_STUDENT");
          }
          requireConfiguredStudentSelection(validation.value.className);
          const id =
            typeof body.id === "string" && /^[a-zA-Z0-9_-]{3,80}$/.test(body.id)
              ? body.id
              : `student-${randomBytes(7).toString("base64url")}`;
          const student = {
            id,
            name: validation.value.name,
            className: validation.value.className,
            revision: 1,
            identityLookup: studentIdentityLookup(
              store.data.secret,
              validation.value.name,
              validation.value.className
            ),
            pinLookup: pinLookup(store.data.secret, validation.value.pin),
            ...(await hashPin(validation.value.pin)),
            ...(idempotency ? { creationRequest: idempotency } : {}),
          };
          const committedStudent = await store.update((data) => {
            const requestedPinLookups = possiblePinLookups(
              data,
              validation.value.pin
            );
            const duplicateId = data.students.some(
              (existing) => existing.id === student.id
            );
            const duplicatePin = data.students.some(
              (existing) => requestedPinLookups.has(existing.pinLookup)
            );
            const replayedStudent = findIdempotentResource(
              data.students,
              idempotency
            );
            if (replayedStudent) return replayedStudent;
            if (data.students.length >= MAX_STUDENTS) {
              throw new HttpError(
                400,
                `الحد الأعلى هو ${MAX_STUDENTS} طالبًا.`,
                "ROSTER_TOO_LARGE"
              );
            }
            if (duplicateId) {
              throw new HttpError(409, "الطالب مضاف بالفعل.", "DUPLICATE_STUDENT");
            }
            if (duplicatePin) {
              throw new HttpError(
                409,
                "رمز الدخول مستخدم لطالب آخر. اختر رمزًا مختلفًا.",
                "DUPLICATE_PIN"
              );
            }
            data.students.push(student);
            for (const quiz of Object.values(data.quizzes)) {
              if (!quiz.students.some((existing) => existing.id === student.id)) {
                quiz.students.push(structuredClone(student));
                quiz.updatedAt = new Date().toISOString();
              }
            }
            return student;
          });
          json(
            response,
            201,
            { student: publicStudent(committedStudent) },
            securityHeaders()
          );
          return;
        }
        if (request.method === "PATCH" && rosterMatch[1]) {
          const studentId = rosterMatch[1];
          const existing = store.data.students.find((student) => student.id === studentId);
          if (!existing) {
            throw new HttpError(404, "الطالب غير موجود.", "STUDENT_NOT_FOUND");
          }
          const body = await readJsonBody(request);
          const validation = validateStudentInputValue(
            {
              name: body.name,
              className: body.className,
              pin: body.pin || "",
            },
            { pinRequired: false }
          );
          if (!validation.valid) {
            throw new HttpError(400, validation.error, "INVALID_STUDENT");
          }
          requireConfiguredStudentSelection(validation.value.className);
          const identityLookup = studentIdentityLookup(
            store.data.secret,
            validation.value.name,
            validation.value.className
          );
          const updatedPinFields = validation.value.pin
            ? {
                pinLookup: pinLookup(store.data.secret, validation.value.pin),
                ...(await hashPin(validation.value.pin)),
              }
            : null;
          let committedReplacement;
          await store.update((data) => {
            const rosterIndex = data.students.findIndex((student) => student.id === studentId);
            if (rosterIndex === -1) {
              throw new HttpError(404, "الطالب غير موجود.", "STUDENT_NOT_FOUND");
            }
            const requestedPinLookups = validation.value.pin
              ? possiblePinLookups(data, validation.value.pin)
              : null;
            const duplicatePin = Boolean(
              updatedPinFields &&
                data.students.some(
                  (student) =>
                    student.id !== studentId &&
                    requestedPinLookups.has(student.pinLookup)
                )
            );
            if (duplicatePin) {
              throw new HttpError(
                409,
                "رمز الدخول مستخدم لطالب آخر. اختر رمزًا مختلفًا.",
                "DUPLICATE_PIN"
              );
            }
            committedReplacement = {
              ...data.students[rosterIndex],
              name: validation.value.name,
              className: validation.value.className,
              revision: data.students[rosterIndex].revision + 1,
              identityLookup,
              ...(updatedPinFields || {}),
            };
            data.students[rosterIndex] = committedReplacement;
            for (const quiz of Object.values(data.quizzes)) {
              const quizStudentIndex = quiz.students.findIndex(
                (student) => student.id === studentId
              );
              if (quizStudentIndex !== -1) {
                quiz.students[quizStudentIndex] = structuredClone(
                  committedReplacement
                );
                quiz.sessions = Object.fromEntries(
                  Object.entries(quiz.sessions).filter(
                    ([, session]) => session.studentId !== studentId
                  )
                );
                quiz.starts = Object.fromEntries(
                  Object.entries(quiz.starts).filter(
                    ([key]) => key.split(":")[1] !== studentId
                  )
                );
                if (
                  !quiz.submissions.some(
                    (submission) => submission.studentId === studentId
                  )
                ) {
                  delete quiz.participants[studentId];
                }
                quiz.updatedAt = new Date().toISOString();
              }
            }
          });
          json(
            response,
            200,
            { student: publicStudent(committedReplacement) },
            securityHeaders()
          );
          return;
        }
        if (request.method === "DELETE" && rosterMatch[1]) {
          const studentId = rosterMatch[1];
          if (!store.data.students.some((student) => student.id === studentId)) {
            throw new HttpError(404, "الطالب غير موجود.", "STUDENT_NOT_FOUND");
          }
          await store.update((data) => {
            data.students = data.students.filter((student) => student.id !== studentId);
            for (const quiz of Object.values(data.quizzes)) {
              quiz.students = quiz.students.filter((student) => student.id !== studentId);
              quiz.submissions = quiz.submissions.filter(
                (submission) => submission.studentId !== studentId
              );
              quiz.sessions = Object.fromEntries(
                Object.entries(quiz.sessions).filter(
                  ([, session]) => session.studentId !== studentId
                )
              );
              quiz.starts = Object.fromEntries(
                Object.entries(quiz.starts).filter(
                  ([key]) => key.split(":")[1] !== studentId
                )
              );
              delete quiz.participants[studentId];
              quiz.updatedAt = new Date().toISOString();
            }
          });
          json(response, 200, { ok: true }, securityHeaders());
          return;
        }
      }

      if (pathname === "/api/quizzes" && request.method === "POST") {
        const currentSupervisor = requireSupervisor(request, store);
        if (request.headers["sec-fetch-site"] === "cross-site") {
          throw new HttpError(403, "الطلب غير مسموح من موقع آخر.", "CROSS_SITE_REQUEST");
        }
        const body = await readJsonBody(request);
        const expectedCurrentQuizId =
          body.expectedCurrentQuizId === null ||
          body.expectedCurrentQuizId === undefined
            ? null
            : String(body.expectedCurrentQuizId);
        if (
          expectedCurrentQuizId !== null &&
          !/^[A-Za-z0-9_-]{3,80}$/.test(expectedCurrentQuizId)
        ) {
          throw new HttpError(
            400,
            "مرجع سؤال مساحة العمل غير صالح.",
            "INVALID_EXPECTED_QUIZ"
          );
        }
        const idempotency = readIdempotencyRequest(
          request,
          store.data.secret,
          "quiz-create",
          currentSupervisor.id,
          body
        );
        const quizId = randomBytes(6).toString("base64url");
        const adminToken = idempotency
          ? createHmac("sha256", store.data.secret)
              .update(`idempotent-quiz-admin:${idempotency.keyHash}`)
              .digest("base64url")
          : randomBytes(32).toString("base64url");
        if (
          body.questions !== undefined &&
          (!Array.isArray(body.questions) || body.questions.length !== 1)
        ) {
          throw new HttpError(
            400,
            "ابدأ الاختبار الأسبوعي بسؤال واحد.",
            "INVALID_QUESTION"
          );
        }
        const firstQuestion =
          body.questions?.[0] ?? body.firstQuestion ?? body.question;
        const question = sanitizeQuestion(firstQuestion, {
          id: `question-${quizId}`,
        });
        const studentInputs =
          store.data.students.length === 0
            ? sanitizeStudentInputs(body.students, store.data.secret)
            : null;
        const applyQuizCreationLimit = recordQuizCreation(request, true);
        const bootstrapStudents = studentInputs ? await hashStudentInputs(studentInputs) : null;
        const createdAt = new Date();
        const quiz = {
          id: quizId,
          questions: [question],
          students: [],
          submissions: [],
          sessions: {},
          starts: {},
          participants: {},
          round: 1,
          answerRecords: [],
          participationRecords: [],
          resetRequests: [],
          adminTokenHash: hashToken(adminToken),
          createdAt: createdAt.toISOString(),
          updatedAt: createdAt.toISOString(),
          expiresAt: new Date(createdAt.getTime() + QUIZ_RETENTION_MS).toISOString(),
          ...(idempotency ? { creationRequest: idempotency } : {}),
        };
        const creationPayload = await store.update((data) => {
          const replayedQuiz = findIdempotentResource(
            Object.values(data.quizzes),
            idempotency
          );
          if (replayedQuiz) {
            return quizCreationPayload(replayedQuiz, adminToken);
          }
          for (const [storedQuizId, storedQuiz] of Object.entries(data.quizzes)) {
            if (
              storedQuiz.expiresAt &&
              new Date(storedQuiz.expiresAt).getTime() <= createdAt.getTime()
            ) {
              delete data.quizzes[storedQuizId];
              if (data.activeQuizId === storedQuizId) {
                data.activeQuizId = null;
              }
            }
          }
          const authoritativeActiveQuizId = data.activeQuizId || null;
          if (authoritativeActiveQuizId) {
            throw new HttpError(
              409,
              "يوجد رابط أسبوعي نشط بالفعل. أضف السؤال إلى الرابط نفسه.",
              "WEEK_ALREADY_ACTIVE",
              { currentQuizId: authoritativeActiveQuizId }
            );
          }
          if (expectedCurrentQuizId !== null) {
            throw new HttpError(
              409,
              "تغيّر رابط مساحة العمل. حدّث الصفحة قبل إعادة النشر.",
              "QUIZ_PUBLISH_CONFLICT",
              { currentQuizId: null }
            );
          }
          applyQuizCreationLimit(data);
          if (data.students.length === 0 && bootstrapStudents) {
            data.students = structuredClone(bootstrapStudents);
          }
          if (data.students.length === 0) {
            throw new HttpError(
              400,
              "أضف طالبًا واحدًا على الأقل قبل نشر السؤال.",
              "EMPTY_ROSTER"
            );
          }
          quiz.students = structuredClone(data.students);
          data.quizzes[quizId] = quiz;
          data.activeQuizId = quiz.id;
          return quizCreationPayload(quiz, adminToken);
        });
        json(
          response,
          201,
          creationPayload,
          securityHeaders()
        );
        return;
      }

      const appendQuestionMatch = pathname.match(
        /^\/api\/quizzes\/([A-Za-z0-9_-]+)\/questions$/
      );
      if (appendQuestionMatch && request.method === "POST") {
        const quiz = requireQuiz(store, appendQuestionMatch[1]);
        requireAdmin(request, quiz, store);
        if (request.headers["sec-fetch-site"] === "cross-site") {
          throw new HttpError(
            403,
            "الطلب غير مسموح من موقع آخر.",
            "CROSS_SITE_REQUEST"
          );
        }
        const body = await readJsonBody(request);
        const idempotency = readIdempotencyRequest(
          request,
          store.data.secret,
          "quiz-question-create",
          quiz.id,
          body
        );
        if (!idempotency) {
          throw new HttpError(
            400,
            "مفتاح إعادة المحاولة مطلوب لإضافة السؤال.",
            "IDEMPOTENCY_KEY_REQUIRED"
          );
        }
        const question = sanitizeQuestion(body.question ?? body, {
          id: `question-${randomBytes(8).toString("base64url")}`,
          creationRequest: idempotency,
        });
        const appended = await store.update((data) => {
          const draftQuiz = data.quizzes[quiz.id];
          if (!draftQuiz || data.activeQuizId !== quiz.id) {
            throw new HttpError(
              410,
              "استُبدل هذا الاختبار الأسبوعي. استخدم الرابط النشط.",
              "QUIZ_SUPERSEDED"
            );
          }
          const replayedQuestion = findIdempotentResource(
            draftQuiz.questions,
            idempotency
          );
          if (replayedQuestion) {
            return {
              questionId: replayedQuestion.id,
              quiz: serializeAdminQuiz(draftQuiz),
            };
          }
          if (draftQuiz.questions.length >= MAX_QUESTIONS) {
            throw new HttpError(
              400,
              `الحد الأعلى هو ${MAX_QUESTIONS} سؤالًا.`,
              "QUESTION_LIMIT"
            );
          }
          draftQuiz.questions.push(question);
          draftQuiz.updatedAt = new Date().toISOString();
          draftQuiz.expiresAt = new Date(
            Date.now() + QUIZ_RETENTION_MS
          ).toISOString();
          return {
            questionId: question.id,
            quiz: serializeAdminQuiz(draftQuiz),
          };
        });
        json(response, 201, appended, securityHeaders());
        return;
      }

      const adminMatch = pathname.match(/^\/api\/quizzes\/([A-Za-z0-9_-]+)\/admin$/);
      if (adminMatch && request.method === "GET") {
        const quiz = requireQuiz(store, adminMatch[1]);
        requireAdmin(request, quiz, store);
        json(
          response,
          200,
          { quiz: serializeAdminQuiz(quiz) },
          securityHeaders()
        );
        return;
      }

      const resetLeaderboardMatch = pathname.match(
        /^\/api\/quizzes\/([A-Za-z0-9_-]+)\/leaderboard\/reset$/
      );
      if (resetLeaderboardMatch && request.method === "POST") {
        const quiz = requireQuiz(store, resetLeaderboardMatch[1]);
        requireAdmin(request, quiz, store);
        const resetBody = await readJsonBody(request);
        if (
          !Number.isInteger(resetBody.expectedRound) ||
          resetBody.expectedRound < 1
        ) {
          throw new HttpError(
            400,
            "رقم الجولة المتوقع غير صالح.",
            "INVALID_EXPECTED_ROUND"
          );
        }
        const idempotency = readIdempotencyRequest(
          request,
          store.data.secret,
          "leaderboard-reset",
          quiz.id,
          resetBody
        );
        if (!idempotency) {
          throw new HttpError(
            400,
            "مفتاح إعادة المحاولة مطلوب لإعادة تعيين النتائج.",
            "IDEMPOTENCY_KEY_REQUIRED"
          );
        }
        const resetResult = await store.update((data) => {
          const draftQuiz = data.quizzes[quiz.id];
          draftQuiz.resetRequests ||= [];
          const replayedReset = findIdempotentResource(
            draftQuiz.resetRequests,
            idempotency
          );
          if (replayedReset) return structuredClone(replayedReset.response);
          if (data.activeQuizId !== quiz.id) {
            throw new HttpError(
              410,
              "استُبدل هذا الرابط بأسبوع جديد. اطلب الرابط الأحدث من المشرف.",
              "QUIZ_SUPERSEDED"
            );
          }
          if (draftQuiz.round !== resetBody.expectedRound) {
            throw new HttpError(
              409,
              "تغيّرت جولة السؤال قبل اكتمال الطلب. حدّث النتائج ثم حاول مجددًا.",
              "QUIZ_ROUND_CONFLICT",
              { currentRound: draftQuiz.round }
            );
          }
          const pendingGrades = draftQuiz.submissions.filter(
            (submission) => submission.gradingStatus === "pending"
          ).length;
          if (pendingGrades > 0) {
            throw new HttpError(
              409,
              `صحّح ${pendingGrades} من الإجابات المقالية قبل إعادة تعيين المتصدرين.`,
              "PENDING_GRADES",
              { pendingGrades }
            );
          }
          const result = {
            ok: true,
            round: draftQuiz.round + 1,
            cleared: {
              submissions: draftQuiz.submissions.length,
              participants: serializeParticipants(draftQuiz).length,
            },
            recordsPreserved: {
              answers: draftQuiz.answerRecords.length,
              participations: draftQuiz.participationRecords.length,
            },
          };
          draftQuiz.submissions = [];
          draftQuiz.sessions = {};
          draftQuiz.starts = {};
          draftQuiz.participants = {};
          draftQuiz.round = result.round;
          const completedAt = new Date().toISOString();
          draftQuiz.updatedAt = completedAt;
          draftQuiz.expiresAt = new Date(
            Date.now() + QUIZ_RETENTION_MS
          ).toISOString();
          draftQuiz.resetRequests.push({
            creationRequest: idempotency,
            response: structuredClone(result),
            completedAt,
          });
          draftQuiz.resetRequests = draftQuiz.resetRequests.slice(
            -MAX_RESET_REQUESTS
          );
          return result;
        });
        json(
          response,
          200,
          resetResult,
          securityHeaders()
        );
        return;
      }

      const studentAdminMatch = pathname.match(
        /^\/api\/quizzes\/([A-Za-z0-9_-]+)\/students(?:\/([A-Za-z0-9_-]+))?$/
      );
      if (studentAdminMatch && request.method === "POST" && !studentAdminMatch[2]) {
        const quiz = requireQuiz(store, studentAdminMatch[1]);
        requireAdmin(request, quiz, store);
        const body = await readJsonBody(request);
        const validation = validateStudentInputValue(body);
        if (!validation.valid) {
          throw new HttpError(400, validation.error, "INVALID_STUDENT");
        }
        requireConfiguredStudentSelection(validation.value.className);
        const lookup = pinLookup(store.data.secret, validation.value.pin);
        const identityLookup = studentIdentityLookup(
          store.data.secret,
          validation.value.name,
          validation.value.className
        );
        if (
          store.data.students.some((student) =>
            possiblePinLookups(
              store.data,
              validation.value.pin
            ).has(student.pinLookup)
          )
        ) {
          throw new HttpError(
            409,
            "رمز الدخول مستخدم لطالب آخر. اختر رمزًا مختلفًا.",
            "DUPLICATE_PIN"
          );
        }
        const student = {
          id:
            typeof body.id === "string" && /^[a-zA-Z0-9_-]{3,80}$/.test(body.id)
              ? body.id
              : `student-${randomBytes(7).toString("base64url")}`,
          name: validation.value.name,
          className: validation.value.className,
          revision: 1,
          pinLookup: lookup,
          identityLookup,
          ...(await hashPin(validation.value.pin)),
        };
        await store.update((data) => {
          const requestedPinLookups = possiblePinLookups(
            data,
            validation.value.pin
          );
          if (
            data.students.some(
              (existing) =>
                existing.id === student.id ||
                requestedPinLookups.has(existing.pinLookup)
            )
          ) {
            throw new HttpError(
              409,
              "الطالب أو رمز الدخول مضاف بالفعل.",
              "DUPLICATE_STUDENT"
            );
          }
          data.students.push(student);
          for (const draftQuiz of Object.values(data.quizzes)) {
            if (
              !draftQuiz.students.some(
                (existing) => existing.id === student.id
              )
            ) {
              draftQuiz.students.push(structuredClone(student));
              draftQuiz.updatedAt = new Date().toISOString();
            }
          }
        });
        json(response, 201, { student: publicStudent(student) }, securityHeaders());
        return;
      }

      if (studentAdminMatch && request.method === "DELETE" && studentAdminMatch[2]) {
        const quiz = requireQuiz(store, studentAdminMatch[1]);
        requireAdmin(request, quiz, store);
        const studentId = studentAdminMatch[2];
        if (!quiz.students.some((student) => student.id === studentId)) {
          throw new HttpError(404, "الطالب غير موجود.", "STUDENT_NOT_FOUND");
        }
        await store.update((data) => {
          data.students = data.students.filter(
            (student) => student.id !== studentId
          );
          for (const draftQuiz of Object.values(data.quizzes)) {
            draftQuiz.students = draftQuiz.students.filter(
              (student) => student.id !== studentId
            );
            draftQuiz.submissions = draftQuiz.submissions.filter(
              (submission) => submission.studentId !== studentId
            );
            draftQuiz.sessions = Object.fromEntries(
              Object.entries(draftQuiz.sessions).filter(
                ([, session]) => session.studentId !== studentId
              )
            );
            draftQuiz.starts = Object.fromEntries(
              Object.entries(draftQuiz.starts).filter(
                ([key]) => key.split(":")[1] !== studentId
              )
            );
            delete draftQuiz.participants[studentId];
            draftQuiz.updatedAt = new Date().toISOString();
          }
        });
        json(response, 200, { ok: true }, securityHeaders());
        return;
      }

      const challengeMatch = pathname.match(
        /^\/api\/quizzes\/([A-Za-z0-9_-]+)\/access\/challenge$/
      );
      if (challengeMatch && request.method === "POST") {
        const quiz = requireQuiz(store, challengeMatch[1]);
        const input = readStudentAccessInput(await readJsonBody(request));
        json(
          response,
          200,
          {
            token: issueAccessChallenge(
              challengeSecret,
              quiz.id,
              input.credential,
              accessDifficultyBits
            ),
            difficultyBits: accessDifficultyBits,
          },
          securityHeaders()
        );
        return;
      }

      const accessMatch = pathname.match(/^\/api\/quizzes\/([A-Za-z0-9_-]+)\/access$/);
      if (accessMatch && request.method === "POST") {
        const quiz = requireQuiz(store, accessMatch[1]);
        const body = await readJsonBody(request);
        const input = readStudentAccessInput(body);
        const proof = verifyAccessProof({
          secret: challengeSecret,
          quizId: quiz.id,
          credential: input.credential,
          token: body.challengeToken,
          counter: body.challengeCounter,
          difficultyBits: accessDifficultyBits,
        });
        if (!proof) {
          throw new HttpError(
            400,
            "انتهى تحقق الدخول أو لم يكتمل. حاول مرة أخرى.",
            "INVALID_ACCESS_PROOF"
          );
        }
        await consumeProof(store, proof);
        const reservationId = await studentLimiter.tryReserve(
          request,
          quiz.id
        );
        if (!reservationId) {
          throw new HttpError(
            429,
            "تكررت محاولات الدخول غير الصحيحة. انتظر قليلًا ثم حاول مجددًا.",
            "STUDENT_ACCESS_LIMIT"
          );
        }
        let reservationFinished = false;
        try {
          const lookupCandidates = new Set([
            pinLookup(store.data.secret, input.pin),
            ...Object.keys(store.data.quizzes).map((storedQuizId) =>
              pinLookup(store.data.secret, storedQuizId, input.pin)
            ),
          ]);
          const candidates = store.data.students.filter(
            (student) =>
              lookupCandidates.has(student.pinLookup) ||
              student.pinLookup === undefined
          );
          const matchingStudents = [];
          for (const candidate of candidates) {
            if (await verifyPin(input.pin, candidate)) {
              matchingStudents.push(candidate);
            }
          }
          const rosterStudent =
            matchingStudents.length === 1 ? matchingStudents[0] : null;
          if (!rosterStudent) {
            const timingStudent = store.data.students[0];
            if (timingStudent && !candidates.includes(timingStudent)) {
              await verifyPin(input.pin, timingStudent);
            }
            await studentLimiter.finish(
              request,
              quiz.id,
              reservationId,
              true
            );
            reservationFinished = true;
            throw new HttpError(
              401,
              "رمز الدخول غير صحيح. تحقق منه أو راجع المشرف.",
              "PIN_REJECTED"
            );
          }
          const student = quiz.students.find(
            (item) => item.id === rosterStudent.id
          );
          if (!student) {
            await studentLimiter.finish(
              request,
              quiz.id,
              reservationId,
              true
            );
            reservationFinished = true;
            throw new HttpError(
              401,
              "رمز الدخول غير صحيح. تحقق منه أو راجع المشرف.",
              "PIN_REJECTED"
            );
          }
          const token = randomBytes(32).toString("base64url");
          const expectedStudentRevision = student.revision;
          const expectedPinLookup = rosterStudent.pinLookup;
          const expectedRound = quiz.round;
          const normalizedPinLookup = pinLookup(
            store.data.secret,
            input.pin
          );
          const accessState = await store.update((data) => {
            const draftQuiz = data.quizzes[quiz.id];
            const draftRosterStudent = data.students.find(
              (item) => item.id === student.id
            );
            const draftStudent = draftQuiz.students.find(
              (item) => item.id === student.id
            );
            if (
              data.activeQuizId !== quiz.id ||
              !draftRosterStudent ||
              !draftStudent ||
              draftStudent.revision !== expectedStudentRevision ||
              draftRosterStudent.revision !== expectedStudentRevision ||
              draftRosterStudent.pinLookup !== expectedPinLookup
            ) {
              throw new HttpError(
                409,
                "تغيّرت بيانات الطالب أثناء الدخول. تحقق من البيانات وحاول مجددًا.",
                "STUDENT_CHANGED_RETRY"
              );
            }
            if (
              data.students.some(
                (item) =>
                  item.id !== student.id &&
                  item.pinLookup === normalizedPinLookup
              )
            ) {
              throw new HttpError(
                409,
                "رمز الدخول متكرر بين طالبين. اطلب من المشرف تغيير أحد الرمزين.",
                "AMBIGUOUS_PIN"
              );
            }
            if (draftQuiz.round !== expectedRound) {
              throw new HttpError(
                409,
                "أعاد المشرف ترتيب السؤال. ابدأ الدخول من جديد.",
                "QUIZ_RESET_RETRY"
              );
            }
            draftRosterStudent.pinLookup = normalizedPinLookup;
            for (const storedQuiz of Object.values(data.quizzes)) {
              const storedStudent = storedQuiz.students.find(
                (item) => item.id === student.id
              );
              if (storedStudent) storedStudent.pinLookup = normalizedPinLookup;
            }
            draftQuiz.starts ||= {};
            draftQuiz.participants ||= {};
            ensureNextQuestionStart(draftQuiz, student.id);
            const accessedAt = new Date().toISOString();
            const previousParticipant = draftQuiz.participants[student.id];
            draftQuiz.participationRecords.push({
                studentId: student.id,
              accessedAt,
              round: draftQuiz.round,
            });
            draftQuiz.participants[student.id] = previousParticipant
              ? {
                  ...previousParticipant,
                  lastAccessedAt: accessedAt,
                  sessionCount: previousParticipant.sessionCount + 1,
                }
              : {
                  studentId: student.id,
                  firstAccessedAt: accessedAt,
                  lastAccessedAt: accessedAt,
                  sessionCount: 1,
                };
            draftQuiz.sessions[hashToken(token)] = {
              tokenHash: hashToken(token),
              studentId: student.id,
              studentRevision: draftStudent.revision,
              round: draftQuiz.round,
              createdAt: new Date().toISOString(),
            };
            const studentSessions = Object.values(draftQuiz.sessions)
              .filter((session) => session.studentId === student.id)
              .sort(
                (first, second) =>
                  new Date(second.createdAt).getTime() -
                  new Date(first.createdAt).getTime()
              );
            for (const expiredSession of studentSessions.slice(5)) {
              delete draftQuiz.sessions[expiredSession.tokenHash];
            }
            draftQuiz.updatedAt = new Date().toISOString();
            return serializeStudentSession(draftQuiz, draftStudent);
          });
          await studentLimiter.finish(
            request,
            quiz.id,
            reservationId,
            false
          );
          reservationFinished = true;
          json(
            response,
            200,
            {
              token,
              ...accessState,
            },
            securityHeaders()
          );
          return;
        } catch (error) {
          if (!reservationFinished) {
            await studentLimiter.finish(
              request,
              quiz.id,
              reservationId,
              false
            );
          }
          throw error;
        }
      }

      const studentSessionMatch = pathname.match(
        /^\/api\/quizzes\/([A-Za-z0-9_-]+)\/session$/
      );
      if (studentSessionMatch && request.method === "GET") {
        const quiz = requireQuiz(store, studentSessionMatch[1]);
        const { student, session } = requireStudent(request, quiz);
        const sessionState = await store.update((data) => {
          const draftQuiz = data.quizzes[quiz.id];
          const draftSession = draftQuiz?.sessions?.[session.tokenHash];
          const draftStudent = draftQuiz?.students?.find(
            (item) => item.id === student.id
          );
          if (
            data.activeQuizId !== quiz.id ||
            !draftSession ||
            !draftStudent ||
            draftSession.studentRevision !== draftStudent.revision ||
            draftSession.round !== draftQuiz.round
          ) {
            throw new HttpError(
              401,
              "أعد إدخال رمز الطالب للمتابعة.",
              "STUDENT_UNAUTHORIZED"
            );
          }
          if (request.headers["x-start-question"] === "1") {
            ensureNextQuestionStart(draftQuiz, draftStudent.id);
          }
          return serializeStudentSession(draftQuiz, draftStudent);
        });
        json(response, 200, sessionState, securityHeaders());
        return;
      }

      const submissionMatch = pathname.match(
        /^\/api\/quizzes\/([A-Za-z0-9_-]+)\/submissions$/
      );
      if (submissionMatch && request.method === "POST") {
        const quiz = requireQuiz(store, submissionMatch[1]);
        const { student, session } = requireStudent(request, quiz);
        const body = await readJsonBody(request);
        const questionId = String(body.questionId || "");
        if (!/^[A-Za-z0-9_-]{3,100}$/.test(questionId)) {
          throw new HttpError(
            400,
            "معرّف السؤال مطلوب لإرسال الإجابة.",
            "QUESTION_ID_REQUIRED"
          );
        }
        const answer = String(body.answer || "").trim();
        if (!answer || answer.length > 500) {
          throw new HttpError(400, "اكتب إجابة صالحة قبل الإرسال.", "INVALID_ANSWER");
        }

        const result = await store.update((data) => {
          const draftQuiz = data.quizzes[quiz.id];
          const draftSession = draftQuiz?.sessions?.[session.tokenHash];
          const draftStudent = draftQuiz?.students?.find(
            (item) => item.id === student.id
          );
          if (
            data.activeQuizId !== quiz.id ||
            !draftSession ||
            !draftStudent ||
            draftSession.studentRevision !== draftStudent.revision ||
            draftSession.round !== draftQuiz.round
          ) {
            throw new HttpError(
              401,
              "أعد إدخال رمز الطالب للمتابعة.",
              "STUDENT_UNAUTHORIZED"
            );
          }
          const existing = draftQuiz.submissions.find(
            (item) =>
              item.studentId === student.id &&
              item.questionId === questionId
          );
          if (existing) return serializeResult(draftQuiz, existing);
          const question = draftQuiz.questions.find(
            (item) => item.id === questionId
          );
          if (!question) {
            throw new HttpError(
              404,
              "السؤال المطلوب غير موجود في هذا الاختبار.",
              "QUESTION_NOT_FOUND"
            );
          }
          const expectedQuestion = nextUnansweredQuestion(
            draftQuiz,
            student.id
          );
          if (!expectedQuestion || expectedQuestion.id !== question.id) {
            throw new HttpError(
              409,
              "أرسل إجابة السؤال التالي بالترتيب.",
              "QUESTION_OUT_OF_ORDER"
            );
          }
          const now = Date.now();
          const startKey = questionStartKey(
            draftQuiz.round,
            student.id,
            question.id
          );
          const startedAt = Number(draftQuiz.starts[startKey]);
          if (!Number.isFinite(startedAt)) {
            draftQuiz.starts[startKey] = now;
          }
          const submittedAt = new Date(now).toISOString();
          const objective = question.type !== "short";
          const created = {
            id: `submission-${randomBytes(8).toString("base64url")}`,
            studentId: student.id,
            questionId: question.id,
            answer,
            gradingStatus: objective ? "graded" : "pending",
            isCorrect: objective
              ? isObjectiveAnswerCorrect(question, answer)
              : null,
            elapsedMs: Math.max(
              0,
              now -
                (Number.isFinite(startedAt)
                  ? startedAt
                  : draftQuiz.starts[startKey])
            ),
            submittedAt,
            gradedBy: objective ? "automatic" : null,
            gradedAt: objective ? submittedAt : null,
            gradeRevision: objective ? 1 : 0,
            gradeHistory: [],
            round: draftQuiz.round,
          };
          draftQuiz.submissions.push(created);
          draftQuiz.answerRecords.push(structuredClone(created));
          draftQuiz.updatedAt = submittedAt;
          return serializeResult(draftQuiz, created);
        });
        json(
          response,
          200,
          { result },
          securityHeaders()
        );
        return;
      }

      const gradeSubmissionMatch = pathname.match(
        /^\/api\/quizzes\/([A-Za-z0-9_-]+)\/submissions\/([A-Za-z0-9_-]+)\/grade$/
      );
      if (gradeSubmissionMatch && request.method === "PATCH") {
        const quiz = requireQuiz(store, gradeSubmissionMatch[1]);
        const supervisor = requireSupervisor(request, store);
        if (request.headers["sec-fetch-site"] === "cross-site") {
          throw new HttpError(
            403,
            "الطلب غير مسموح من موقع آخر.",
            "CROSS_SITE_REQUEST"
          );
        }
        const body = await readJsonBody(request);
        if (typeof body.isCorrect !== "boolean") {
          throw new HttpError(
            400,
            "حدّد ما إذا كانت الإجابة صحيحة.",
            "INVALID_GRADE"
          );
        }
        const submissionId = gradeSubmissionMatch[2];
        const idempotency = readIdempotencyRequest(
          request,
          store.data.secret,
          "submission-grade",
          `${supervisor.id}:${submissionId}`,
          body
        );
        const graded = await store.update((data) => {
          const draftQuiz = data.quizzes[quiz.id];
          if (!draftQuiz || data.activeQuizId !== quiz.id) {
            throw new HttpError(
              410,
              "استُبدل هذا الاختبار الأسبوعي. استخدم الرابط النشط.",
              "QUIZ_SUPERSEDED"
            );
          }
          if (
            !data.supervisors.some(
              (candidate) => candidate.id === supervisor.id
            )
          ) {
            throw new HttpError(
              401,
              "سجّل دخول المشرف للمتابعة.",
              "SUPERVISOR_UNAUTHORIZED"
            );
          }
          const submission = draftQuiz.submissions.find(
            (item) => item.id === submissionId
          );
          if (!submission) {
            throw new HttpError(
              404,
              "الإجابة المطلوب تقييمها غير موجودة.",
              "SUBMISSION_NOT_FOUND"
            );
          }
          const question = draftQuiz.questions.find(
            (item) => item.id === submission.questionId
          );
          if (question?.type !== "short") {
            throw new HttpError(
              409,
              "تُقيّم الإجابات الموضوعية تلقائيًا.",
              "SUBMISSION_NOT_MANUAL"
            );
          }
          const replayedGrade = findIdempotentResource(
            submission.gradeHistory,
            idempotency
          );
          if (!replayedGrade) {
            const gradedAt = new Date().toISOString();
            submission.gradingStatus = "graded";
            submission.isCorrect = body.isCorrect;
            submission.gradedBy = supervisor.id;
            submission.gradedAt = gradedAt;
            submission.gradeRevision += 1;
            const gradeRecord = {
              gradeRevision: submission.gradeRevision,
              isCorrect: submission.isCorrect,
              gradedBy: supervisor.id,
              gradedAt,
              ...(idempotency ? { creationRequest: idempotency } : {}),
            };
            submission.gradeHistory.push(gradeRecord);
            const answerRecord = draftQuiz.answerRecords.find(
              (record) =>
                record.id === submission.id &&
                record.round === submission.round
            );
            if (!answerRecord) {
              throw new Error("تعذّر العثور على سجل الإجابة الدائم.");
            }
            answerRecord.gradingStatus = submission.gradingStatus;
            answerRecord.isCorrect = submission.isCorrect;
            answerRecord.gradedBy = submission.gradedBy;
            answerRecord.gradedAt = submission.gradedAt;
            answerRecord.gradeRevision = submission.gradeRevision;
            answerRecord.gradeHistory.push(structuredClone(gradeRecord));
            draftQuiz.updatedAt = gradedAt;
          }
          return {
            submission: serializeAdminSubmission(submission),
            quiz: serializeAdminQuiz(draftQuiz),
          };
        });
        json(response, 200, graded, securityHeaders());
        return;
      }

      const leaderboardMatch = pathname.match(
        /^\/api\/quizzes\/([A-Za-z0-9_-]+)\/leaderboard$/
      );
      if (leaderboardMatch && request.method === "GET") {
        const quiz = requireQuiz(store, leaderboardMatch[1]);
        const { student } = requireStudent(request, quiz);
        if (!quiz.submissions.some((submission) => submission.studentId === student.id)) {
          throw new HttpError(
            403,
            "تظهر لوحة المتصدرين بعد إرسال إجابتك.",
            "ANSWER_REQUIRED"
          );
        }
        json(
          response,
          200,
          {
            leaderboard: serializeLeaderboard(quiz),
            updatedAt: quiz.updatedAt,
          },
          securityHeaders()
        );
        return;
      }

      const quizMatch = pathname.match(/^\/api\/quizzes\/([A-Za-z0-9_-]+)$/);
      if (quizMatch && request.method === "GET") {
        const quiz = requireQuiz(store, quizMatch[1]);
        json(
          response,
          200,
          {
            quiz: publicQuizMetadata(quiz),
          },
          securityHeaders()
        );
        return;
      }

      if (pathname.startsWith("/api/")) {
        throw new HttpError(404, "واجهة الطلب غير موجودة.", "API_NOT_FOUND");
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        throw new HttpError(405, "طريقة الطلب غير مسموحة.", "METHOD_NOT_ALLOWED");
      }
      await serveStatic(request, response, pathname);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message =
        error instanceof HttpError ? error.message : "حدث خطأ غير متوقع. حاول مرة أخرى.";
      if (!(error instanceof HttpError)) logger.error?.(error);
      if (!response.headersSent) {
        json(
          response,
          status,
          {
            error: {
              code: error instanceof HttpError ? error.code : "INTERNAL_ERROR",
              message,
              ...(error instanceof HttpError && error.details
                ? { details: error.details }
                : {}),
            },
          },
          securityHeaders()
        );
      } else {
        response.end();
      }
    }
  };
  const server = http.createServer(handler);

  server.on("close", () => store.close());
  return { server, store, handler };
}

async function start() {
  const port = Number(process.env.PORT || 5173);
  const dataFile = process.env.BAYNAT_DATA_FILE || DEFAULT_DATA_FILE;
  const { server, store } = await createBaynatServer({ dataFile });
  server.listen(port, "0.0.0.0", () => {
    console.log(`Baynat is ready at http://0.0.0.0:${port}`);
    if (store.data.setupKey) {
      console.log(`Baynat supervisor setup key: ${store.data.setupKey}`);
    }
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
