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
  DEFAULT_HALAQA_OPTIONS,
  buildLeaderboard,
  isAnswerCorrect,
  normalizeAnswer,
  normalizeDigits,
  validateQuestion,
  validateStudentInput,
} from "./app.js";

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_FILE = path.join(ROOT_DIR, ".data", "baynat.json");
const MAX_BODY_BYTES = 128 * 1024;
const MAX_STUDENTS = 80;
const MAX_SUPERVISORS = 20;
const ACCESS_WINDOW_MS = 10 * 60 * 1000;
const SUPERVISOR_SESSION_MS = 12 * 60 * 60 * 1000;
const SUPERVISOR_ATTEMPTS_LIMIT = 10;
const ACCESS_CHALLENGE_MS = 2 * 60 * 1000;
const MAX_RATE_LIMIT_KEYS = 2_000;
const MAX_CONSUMED_PROOFS = 10_000;
const MAX_RESET_REQUESTS = 32;
const QUIZ_RETENTION_MS = 31 * 24 * 60 * 60 * 1000;
const QUIZ_CREATION_WINDOW_MS = 60 * 60 * 1000;
const QUIZ_CREATION_IP_LIMIT = 5;
const QUIZ_CREATION_GLOBAL_LIMIT = 30;
const PUBLIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/student.html", "student.html"],
  ["/app.js", "app.js"],
  ["/student.js", "student.js"],
  ["/pow-worker.js", "pow-worker.js"],
  ["/styles.css", "styles.css"],
  ["/logo.svg", "logo.svg"],
]);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
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
    quizCreations: { byIp: {}, global: [] },
  };
}

function validateSecurityState(security) {
  if (
    !isRecord(security) ||
    !isRecord(security.supervisorAttempts) ||
    !isRecord(security.quizCreations) ||
    !isRecord(security.quizCreations.byIp) ||
    !Array.isArray(security.quizCreations.global)
  ) {
    throw new Error("سجل حماية الطلبات في ملف بَيّنات غير صالح.");
  }
  if (
    Object.keys(security.supervisorAttempts).length > MAX_RATE_LIMIT_KEYS ||
    Object.keys(security.quizCreations.byIp).length > MAX_RATE_LIMIT_KEYS
  ) {
    throw new Error("سجل حماية الطلبات في ملف بَيّنات أكبر من الحد المسموح.");
  }

  let migrated = false;
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

export function validateStoredData(parsed, initialSetupKey) {
  const storedVersion = parsed?.version;
  if (
    ![1, 2].includes(storedVersion) ||
    typeof parsed.secret !== "string" ||
    parsed.secret.length < 20 ||
    !isRecord(parsed.quizzes)
  ) {
    throw new Error("إصدار أو بنية ملف بيانات بَيّنات غير مدعومة؛ لن تتم الكتابة فوقه.");
  }

  let migrated = false;
  const migrateStudent = (student) => {
    if (
      !isRecord(student) ||
      typeof student.name !== "string" ||
      typeof student.className !== "string"
    ) {
      return;
    }
    if (typeof student.halaqa !== "string" || !student.halaqa.trim()) {
      student.halaqa = "غير محدد";
      migrated = true;
    }
    if (!Number.isInteger(student.revision) || student.revision < 1) {
      student.revision = 1;
      migrated = true;
    }
    const expectedIdentityLookup = studentIdentityLookup(
      parsed.secret,
      student.name,
      student.className,
      student.halaqa
    );
    if (student.identityLookup !== expectedIdentityLookup) {
      student.identityLookup = expectedIdentityLookup;
      migrated = true;
    }
  };
  const validSupervisorCredential = (credential) =>
    isRecord(credential) &&
    typeof credential.salt === "string" &&
    typeof credential.hash === "string" &&
    Number.isFinite(new Date(credential.createdAt).getTime());
  if (storedVersion === 1) {
    const legacyCredential = parsed.adminCredential ?? null;
    if (legacyCredential !== null && !validSupervisorCredential(legacyCredential)) {
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
      parsed.supervisors.map((supervisor) => normalizeAnswer(supervisor.displayName))
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
    parsed.setupKey =
      initialSetupKey || randomBytes(9).toString("base64url");
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
  let latestQuizRoster = [];
  let latestQuizTime = -Infinity;
  for (const [quizId, quiz] of Object.entries(parsed.quizzes)) {
    const validQuiz =
      isRecord(quiz) &&
      quiz.id === quizId &&
      validateQuestion(quiz.question).valid &&
      Array.isArray(quiz.students) &&
      Array.isArray(quiz.submissions) &&
      isRecord(quiz.sessions) &&
      typeof quiz.adminTokenHash === "string" &&
      Number.isFinite(new Date(quiz.createdAt).getTime());
    if (validQuiz) {
      for (const student of quiz.students) {
        migrateStudent(student);
      }
      if (!isRecord(quiz.starts)) {
        quiz.starts = {};
        migrated = true;
      }
      if (!isRecord(quiz.participants)) {
        quiz.participants = {};
        for (const [studentId, startedAt] of Object.entries(quiz.starts)) {
          const startedTime = Number(startedAt);
          if (Number.isFinite(startedTime)) {
            const timestamp = new Date(startedTime).toISOString();
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
      if (!Number.isInteger(quiz.round) || quiz.round < 1) {
        quiz.round = 1;
        migrated = true;
      }
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
      if (!Array.isArray(quiz.answerRecords)) {
        quiz.answerRecords = quiz.submissions.map((submission) => ({
          ...structuredClone(submission),
          round: 1,
        }));
        migrated = true;
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
      const quizTime = new Date(quiz.updatedAt || quiz.createdAt).getTime();
      if (Number.isFinite(quizTime) && quizTime >= latestQuizTime) {
        latestQuizTime = quizTime;
        latestQuizRoster = structuredClone(quiz.students);
      }
    }
    const validStudents =
      validQuiz &&
      quiz.students.every(
        (student) =>
          typeof student?.id === "string" &&
          typeof student.name === "string" &&
          typeof student.className === "string" &&
          typeof student.halaqa === "string" &&
          Number.isInteger(student.revision) &&
          student.revision >= 1 &&
          typeof student.identityLookup === "string" &&
          (student.pinLookup === undefined || typeof student.pinLookup === "string") &&
          typeof student.pinSalt === "string" &&
          typeof student.pinHash === "string"
      );
    const validSubmissions =
      validQuiz &&
      quiz.submissions.every(
        (submission) =>
          typeof submission?.id === "string" &&
          typeof submission.studentId === "string" &&
          submission.questionId === quiz.question.id &&
          typeof submission.answer === "string" &&
          typeof submission.isCorrect === "boolean" &&
          Number.isFinite(submission.elapsedMs) &&
          Number.isFinite(new Date(submission.submittedAt).getTime())
      );
    const validSessions =
      validQuiz &&
      Object.values(quiz.sessions).every(
        (session) =>
          typeof session?.tokenHash === "string" &&
          typeof session.studentId === "string" &&
          Number.isInteger(session.studentRevision) &&
          session.studentRevision >= 1 &&
          Number.isInteger(session.round) &&
          session.round >= 1 &&
          Number.isFinite(new Date(session.createdAt).getTime())
      );
    const validParticipants =
      validQuiz &&
      Object.entries(quiz.participants).every(
        ([studentId, participant]) =>
          participant?.studentId === studentId &&
          Number.isFinite(new Date(participant.firstAccessedAt).getTime()) &&
          Number.isFinite(new Date(participant.lastAccessedAt).getTime()) &&
          Number.isInteger(participant.sessionCount) &&
          participant.sessionCount >= 1
      );
    const validRound = validQuiz && Number.isInteger(quiz.round) && quiz.round >= 1;
    const validAnswerRecords =
      validQuiz &&
      quiz.answerRecords.every(
        (record) =>
          typeof record?.id === "string" &&
          typeof record.studentId === "string" &&
          record.questionId === quiz.question.id &&
          typeof record.answer === "string" &&
          typeof record.isCorrect === "boolean" &&
          Number.isFinite(record.elapsedMs) &&
          Number.isFinite(new Date(record.submittedAt).getTime()) &&
          Number.isInteger(record.round) &&
          record.round >= 1
      );
    const validParticipationRecords =
      validQuiz &&
      quiz.participationRecords.every(
        (record) =>
          typeof record?.studentId === "string" &&
          Number.isFinite(new Date(record.accessedAt).getTime()) &&
          Number.isInteger(record.round) &&
          record.round >= 1
      );
    const validResetRequests =
      validQuiz &&
      quiz.resetRequests.length <= MAX_RESET_REQUESTS &&
      quiz.resetRequests.every(
        (record) =>
          isRecord(record) &&
          isRecord(record.creationRequest) &&
          typeof record.creationRequest.keyHash === "string" &&
          record.creationRequest.keyHash.length > 0 &&
          typeof record.creationRequest.requestHash === "string" &&
          record.creationRequest.requestHash.length > 0 &&
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
    const uniqueStudents =
      validStudents &&
      new Set(quiz.students.map((student) => student.id)).size === quiz.students.length;
    const uniqueSubmissions =
      validSubmissions &&
      new Set(quiz.submissions.map((submission) => submission.id)).size ===
        quiz.submissions.length &&
      new Set(quiz.submissions.map((submission) => submission.studentId)).size ===
        quiz.submissions.length;
    if (
      !validQuiz ||
      !validStudents ||
      !validSubmissions ||
      !validSessions ||
      !validParticipants ||
      !validRound ||
      !validAnswerRecords ||
      !validParticipationRecords ||
      !validResetRequests ||
      !uniqueStudents ||
      !uniqueSubmissions
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
  }

  const now = Date.now();
  const activeCandidates = Object.values(parsed.quizzes)
    .filter(
      (quiz) =>
        new Date(quiz.expiresAt).getTime() > now &&
        !quiz.supersededBy
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
    throw new Error("مرجع سؤال اليوم النشط في ملف بَيّنات غير صالح.");
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
  } else {
    for (const student of parsed.students) migrateStudent(student);
  }
  const validRoster =
    parsed.students.length <= MAX_STUDENTS &&
    parsed.students.every(
      (student) =>
        typeof student?.id === "string" &&
        typeof student.name === "string" &&
        typeof student.className === "string" &&
        typeof student.halaqa === "string" &&
        Number.isInteger(student.revision) &&
        student.revision >= 1 &&
        typeof student.identityLookup === "string" &&
        (student.pinLookup === undefined || typeof student.pinLookup === "string") &&
        typeof student.pinSalt === "string" &&
        typeof student.pinHash === "string"
    ) &&
    new Set(parsed.students.map((student) => student.id)).size === parsed.students.length;
  if (!validRoster) {
    throw new Error("قائمة الطلاب المشتركة في ملف بَيّنات غير صالحة.");
  }
  return { data: parsed, migrated };
}

export function createInitialData(initialSetupKey = "") {
  return {
    version: 2,
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

function pinLookup(secret, quizId, pin) {
  return createHmac("sha256", secret).update(`${quizId}:${normalizeDigits(pin)}`).digest("hex");
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

function canonicalStudentIdentity(name, className, halaqa) {
  return `${normalizeAnswer(name)}|${normalizeAnswer(className)}|${normalizeAnswer(halaqa)}`;
}

function studentIdentityLookup(secret, name, className, halaqa) {
  return createHmac("sha256", secret)
    .update(`student:${canonicalStudentIdentity(name, className, halaqa)}`)
    .digest("base64url");
}

function canonicalAccessCredential(name, className, halaqa, pin) {
  return `${canonicalStudentIdentity(name, className, halaqa)}|${normalizeDigits(pin)}`;
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
    halaqa: student.halaqa,
  };
}

function publicSupervisor(supervisor) {
  return {
    id: supervisor.id,
    displayName: supervisor.displayName,
    createdAt: supervisor.credential.createdAt,
  };
}

function publicQuestion(quiz) {
  const { type, prompt, options, createdAt } = quiz.question;
  return { id: quiz.question.id, type, prompt, options, createdAt };
}

function publicQuestionSummary(quiz) {
  return { type: quiz.question.type };
}

function quizCreationPayload(quiz, adminToken) {
  return {
    quizId: quiz.id,
    questionId: quiz.question.id,
    adminToken,
    studentPath: `/student.html?q=${encodeURIComponent(quiz.id)}`,
  };
}

function publicAccessOptions(quiz) {
  const byClass = new Map(
    DEFAULT_CLASS_OPTIONS.map((className) => [
      className,
      new Set(DEFAULT_HALAQA_OPTIONS),
    ])
  );
  for (const student of quiz.students) {
    if (!byClass.has(student.className)) byClass.set(student.className, new Set());
    byClass.get(student.className).add(student.halaqa);
  }
  return [...byClass.entries()].map(([className, halaqas]) => ({
    className,
    halaqas: [...halaqas].sort((first, second) => first.localeCompare(second, "ar")),
  }));
}

function serializeParticipants(quiz) {
  return Object.values(quiz.participants || {}).map((participant) => ({
    studentId: participant.studentId,
    firstAccessedAt: participant.firstAccessedAt,
    lastAccessedAt: participant.lastAccessedAt,
    sessionCount: participant.sessionCount,
  }));
}

function acceptedAnswer(question) {
  return String(question.correctAnswer || "").split("|")[0].trim();
}

function serializeLeaderboard(quiz) {
  return buildLeaderboard(quiz.students, quiz.submissions, quiz.question.id).map((entry) => ({
    id: entry.id,
    rank: entry.rank,
    student: publicStudent(entry.student),
    isCorrect: entry.isCorrect,
    elapsedMs: entry.elapsedMs,
    submittedAt: entry.submittedAt,
    accuracyPoints: entry.accuracyPoints,
    speedPoints: entry.speedPoints,
    placePoints: entry.placePoints,
    total: entry.total,
  }));
}

function serializeAdminQuiz(quiz) {
  return {
    id: quiz.id,
    question: quiz.question,
    students: quiz.students.map(publicStudent),
    submissions: quiz.submissions,
    participants: serializeParticipants(quiz),
    answerRecords: quiz.answerRecords,
    participationRecords: quiz.participationRecords,
    round: quiz.round,
    leaderboard: serializeLeaderboard(quiz),
    updatedAt: quiz.updatedAt,
  };
}

function serializeResult(quiz, submission) {
  const leaderboard = serializeLeaderboard(quiz);
  const entry = leaderboard.find((item) => item.id === submission.id);
  return {
    entry,
    participantCount: Math.max(serializeParticipants(quiz).length, leaderboard.length),
    suggestedAnswer: submission.isCorrect ? null : acceptedAnswer(quiz.question),
    leaderboard,
  };
}

function sanitizeQuestion(question, quizId) {
  const cleaned = {
    id: `question-${quizId}`,
    type: String(question?.type || ""),
    prompt: String(question?.prompt || "").trim(),
    options: Array.isArray(question?.options)
      ? question.options.map((option) => String(option).trim()).filter(Boolean)
      : [],
    correctAnswer: String(question?.correctAnswer || "").trim(),
    createdAt: new Date().toISOString(),
  };
  if (cleaned.type === "boolean") cleaned.options = ["صح", "خطأ"];
  if (cleaned.type === "short") cleaned.options = [];
  const validation = validateQuestion(cleaned);
  if (!validation.valid) {
    throw new HttpError(400, validation.error, "INVALID_QUESTION");
  }
  return cleaned;
}

function sanitizeStudentInputs(students, secret, quizId) {
  if (!Array.isArray(students) || students.length === 0) {
    throw new HttpError(400, "أضف طالبًا واحدًا على الأقل قبل نشر السؤال.", "EMPTY_ROSTER");
  }
  if (students.length > MAX_STUDENTS) {
    throw new HttpError(400, `الحد الأعلى هو ${MAX_STUDENTS} طالبًا.`, "ROSTER_TOO_LARGE");
  }

  const accepted = [];
  for (const student of students) {
    const validation = validateStudentInput(
      { ...student, halaqa: student?.halaqa || "غير محدد" },
      accepted
    );
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
    const lookup = pinLookup(secret, quizId, validation.value.pin);
    const identityLookup = studentIdentityLookup(
      secret,
      validation.value.name,
      validation.value.className,
      validation.value.halaqa
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
      halaqa: validation.value.halaqa,
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

function requireConfiguredStudentSelections(className, halaqa) {
  if (!DEFAULT_CLASS_OPTIONS.includes(className)) {
    throw new HttpError(400, "اختر صفًا من القائمة المعتمدة.", "INVALID_STUDENT_CLASS");
  }
  if (!DEFAULT_HALAQA_OPTIONS.includes(halaqa)) {
    throw new HttpError(400, "اختر حلقة من القائمة المعتمدة.", "INVALID_STUDENT_HALAQA");
  }
}

function requireQuiz(store, quizId) {
  const quiz = store.read((data) => data.quizzes[quizId]);
  if (!quiz) throw new HttpError(404, "رابط السؤال غير صالح أو انتهى.", "QUIZ_NOT_FOUND");
  if (quiz.expiresAt && new Date(quiz.expiresAt).getTime() <= Date.now()) {
    throw new HttpError(410, "انتهت صلاحية سؤال اليوم. اطلب رابطًا جديدًا.", "QUIZ_EXPIRED");
  }
  if (store.data.activeQuizId !== quiz.id) {
    throw new HttpError(
      410,
      "استُبدل هذا الرابط بسؤال يوم جديد. اطلب الرابط الأحدث من المشرف.",
      "QUIZ_SUPERSEDED"
    );
  }
  return quiz;
}

function requireAdmin(request, quiz, store) {
  const token = request.headers["x-admin-token"];
  if (token && safeEqual(hashToken(token), quiz.adminTokenHash)) return;
  const supervisorId = verifySupervisorToken(
    request.headers["x-supervisor-token"],
    store.data.secret
  );
  if (
    supervisorId &&
    store.data.supervisors.some((supervisor) => supervisor.id === supervisorId)
  ) {
    return;
  }
  throw new HttpError(401, "انتهت صلاحية جلسة المشرف.", "ADMIN_UNAUTHORIZED");
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
  const name = String(body?.name || "").trim();
  const className = String(body?.className || "").trim();
  const halaqa = String(body?.halaqa || "").trim();
  const pin = normalizeDigits(body?.pin || "").trim();
  if (normalizeAnswer(name).length < 2) {
    throw new HttpError(400, "اكتب اسم الطالب كما سجّله المشرف.", "INVALID_STUDENT_NAME");
  }
  if (!normalizeAnswer(className)) {
    throw new HttpError(400, "اختر صف الطالب.", "INVALID_STUDENT_CLASS");
  }
  if (!normalizeAnswer(halaqa)) {
    throw new HttpError(400, "اختر حلقة الطالب.", "INVALID_STUDENT_HALAQA");
  }
  if (!/^\d{4}$/.test(pin)) {
    throw new HttpError(400, "أدخل رمزًا صحيحًا من ٤ أرقام.", "INVALID_PIN");
  }
  return {
    name,
    className,
    halaqa,
    pin,
    credential: canonicalAccessCredential(name, className, halaqa, pin),
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
          const validation = validateStudentInput(body);
          if (!validation.valid) {
            throw new HttpError(400, validation.error, "INVALID_STUDENT");
          }
          requireConfiguredStudentSelections(
            validation.value.className,
            validation.value.halaqa
          );
          const id =
            typeof body.id === "string" && /^[a-zA-Z0-9_-]{3,80}$/.test(body.id)
              ? body.id
              : `student-${randomBytes(7).toString("base64url")}`;
          const student = {
            id,
            name: validation.value.name,
            className: validation.value.className,
            halaqa: validation.value.halaqa,
            revision: 1,
            identityLookup: studentIdentityLookup(
              store.data.secret,
              validation.value.name,
              validation.value.className,
              validation.value.halaqa
            ),
            pinLookup: pinLookup(store.data.secret, "roster", validation.value.pin),
            ...(await hashPin(validation.value.pin)),
            ...(idempotency ? { creationRequest: idempotency } : {}),
          };
          const committedStudent = await store.update((data) => {
            const duplicateId = data.students.some(
              (existing) => existing.id === student.id
            );
            const duplicatePin = data.students.some(
              (existing) => existing.pinLookup === student.pinLookup
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
          const validation = validateStudentInput(
            {
              name: body.name,
              className: body.className,
              halaqa: body.halaqa,
              pin: body.pin || "",
            },
            [],
            { pinRequired: false }
          );
          if (!validation.valid) {
            throw new HttpError(400, validation.error, "INVALID_STUDENT");
          }
          requireConfiguredStudentSelections(
            validation.value.className,
            validation.value.halaqa
          );
          const identityLookup = studentIdentityLookup(
            store.data.secret,
            validation.value.name,
            validation.value.className,
            validation.value.halaqa
          );
          const updatedPinFields = validation.value.pin
            ? {
                pinLookup: pinLookup(
                  store.data.secret,
                  "roster",
                  validation.value.pin
                ),
                ...(await hashPin(validation.value.pin)),
              }
            : null;
          let committedReplacement;
          await store.update((data) => {
            const rosterIndex = data.students.findIndex((student) => student.id === studentId);
            if (rosterIndex === -1) {
              throw new HttpError(404, "الطالب غير موجود.", "STUDENT_NOT_FOUND");
            }
            const duplicatePin = Boolean(
              updatedPinFields &&
                data.students.some(
                  (student) =>
                    student.id !== studentId &&
                    student.pinLookup === updatedPinFields.pinLookup
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
              halaqa: validation.value.halaqa,
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
                if (
                  !quiz.submissions.some(
                    (submission) => submission.studentId === studentId
                  )
                ) {
                  delete quiz.starts[studentId];
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
              delete quiz.starts[studentId];
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
        const question = sanitizeQuestion(body.question, quizId);
        const studentInputs =
          store.data.students.length === 0
            ? sanitizeStudentInputs(body.students, store.data.secret, quizId)
            : null;
        const applyQuizCreationLimit = recordQuizCreation(request, true);
        const bootstrapStudents = studentInputs ? await hashStudentInputs(studentInputs) : null;
        const createdAt = new Date();
        const quiz = {
          id: quizId,
          question,
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
          if (authoritativeActiveQuizId !== expectedCurrentQuizId) {
            throw new HttpError(
              409,
              "نشر مشرف آخر سؤالًا جديدًا من هذه المساحة. حدّث الصفحة قبل إعادة النشر.",
              "QUIZ_PUBLISH_CONFLICT",
              { currentQuizId: authoritativeActiveQuizId }
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
          if (authoritativeActiveQuizId) {
            const previousQuiz = data.quizzes[authoritativeActiveQuizId];
            previousQuiz.supersededAt = createdAt.toISOString();
            previousQuiz.supersededBy = quiz.id;
          }
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
              "استُبدل هذا الرابط بسؤال يوم جديد. اطلب الرابط الأحدث من المشرف.",
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
        const validation = validateStudentInput(body, quiz.students);
        if (!validation.valid) {
          throw new HttpError(400, validation.error, "INVALID_STUDENT");
        }
        requireConfiguredStudentSelections(
          validation.value.className,
          validation.value.halaqa
        );
        const lookup = pinLookup(store.data.secret, quiz.id, validation.value.pin);
        const identityLookup = studentIdentityLookup(
          store.data.secret,
          validation.value.name,
          validation.value.className,
          validation.value.halaqa
        );
        if (quiz.students.some((student) => student.pinLookup === lookup)) {
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
          halaqa: validation.value.halaqa,
          revision: 1,
          pinLookup: lookup,
          identityLookup,
          ...(await hashPin(validation.value.pin)),
        };
        await store.update((data) => {
          const draftQuiz = data.quizzes[quiz.id];
          if (
            draftQuiz.students.some(
              (existing) =>
                existing.id === student.id ||
                existing.pinLookup === student.pinLookup
            )
          ) {
            throw new HttpError(
              409,
              "الطالب أو رمز الدخول مضاف بالفعل.",
              "DUPLICATE_STUDENT"
            );
          }
          draftQuiz.students.push(student);
          draftQuiz.updatedAt = new Date().toISOString();
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
          const draftQuiz = data.quizzes[quiz.id];
          draftQuiz.students = draftQuiz.students.filter((student) => student.id !== studentId);
          draftQuiz.submissions = draftQuiz.submissions.filter(
            (submission) => submission.studentId !== studentId
          );
          draftQuiz.sessions = Object.fromEntries(
            Object.entries(draftQuiz.sessions).filter(
              ([, session]) => session.studentId !== studentId
            )
          );
          if (draftQuiz.starts) delete draftQuiz.starts[studentId];
          if (draftQuiz.participants) delete draftQuiz.participants[studentId];
          draftQuiz.updatedAt = new Date().toISOString();
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
        let quiz = requireQuiz(store, accessMatch[1]);
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
        const identityLookup = studentIdentityLookup(
          store.data.secret,
          input.name,
          input.className,
          input.halaqa
        );
        const candidates = quiz.students.filter(
          (item) => item.identityLookup === identityLookup
        );
        let student = null;
        for (const candidate of candidates) {
          if (await verifyPin(input.pin, candidate)) {
            student = candidate;
            break;
          }
        }
        if (!student) {
          throw new HttpError(
            401,
            "الاسم أو الصف أو الحلقة أو الرمز غير صحيح. تأكد منها أو راجع المشرف.",
            "PIN_REJECTED"
          );
        }
        const token = randomBytes(32).toString("base64url");
        const expectedStudentRevision = student.revision;
        const expectedRound = quiz.round;
        const accessResult = await store.update((data) => {
          const draftQuiz = data.quizzes[quiz.id];
          const draftStudent = draftQuiz.students.find(
            (item) => item.id === student.id
          );
          if (
            !draftStudent ||
            draftStudent.revision !== expectedStudentRevision ||
            draftStudent.identityLookup !== identityLookup
          ) {
            throw new HttpError(
              409,
              "تغيّرت بيانات الطالب أثناء الدخول. تحقق من البيانات وحاول مجددًا.",
              "STUDENT_CHANGED_RETRY"
            );
          }
          if (draftQuiz.round !== expectedRound) {
            throw new HttpError(
              409,
              "أعاد المشرف ترتيب السؤال. ابدأ الدخول من جديد.",
              "QUIZ_RESET_RETRY"
            );
          }
          draftQuiz.starts ||= {};
          draftQuiz.participants ||= {};
          const startedAt = draftQuiz.starts[student.id] || Date.now();
          draftQuiz.starts[student.id] ||= startedAt;
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
          draftQuiz.sessions = Object.fromEntries(
            Object.entries(draftQuiz.sessions).filter(
              ([, session]) => session.studentId !== student.id
            )
          );
          draftQuiz.sessions[hashToken(token)] = {
            tokenHash: hashToken(token),
            studentId: student.id,
            studentRevision: draftStudent.revision,
            round: draftQuiz.round,
            createdAt: new Date().toISOString(),
            startedAt: draftQuiz.starts[student.id],
          };
          draftQuiz.updatedAt = new Date().toISOString();
          const existing = draftQuiz.submissions.find(
            (submission) => submission.studentId === student.id
          );
          return existing ? serializeResult(draftQuiz, existing) : null;
        });
        json(
          response,
          200,
          {
            token,
            student: publicStudent(student),
            question: publicQuestion(quiz),
            result: accessResult,
          },
          securityHeaders()
        );
        return;
      }

      const submissionMatch = pathname.match(
        /^\/api\/quizzes\/([A-Za-z0-9_-]+)\/submissions$/
      );
      if (submissionMatch && request.method === "POST") {
        let quiz = requireQuiz(store, submissionMatch[1]);
        const { student, session } = requireStudent(request, quiz);
        const body = await readJsonBody(request);
        const answer = String(body.answer || "").trim();
        if (!answer || answer.length > 500) {
          throw new HttpError(400, "اكتب إجابة صالحة قبل الإرسال.", "INVALID_ANSWER");
        }

        const result = await store.update((data) => {
          const draftQuiz = data.quizzes[quiz.id];
          const draftSession = draftQuiz.sessions[session.tokenHash];
          const draftStudent = draftQuiz.students.find(
            (item) => item.id === student.id
          );
          if (
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
            (item) => item.studentId === student.id
          );
          if (existing) return serializeResult(draftQuiz, existing);
          const startedAt =
            Number(draftSession.startedAt) ||
            new Date(draftSession.createdAt).getTime();
          const created = {
            id: `submission-${randomBytes(8).toString("base64url")}`,
            studentId: student.id,
            questionId: draftQuiz.question.id,
            answer,
            isCorrect: isAnswerCorrect(draftQuiz.question, answer),
            elapsedMs: Math.max(0, Date.now() - startedAt),
            submittedAt: new Date().toISOString(),
          };
          draftQuiz.submissions.push(created);
          draftQuiz.answerRecords.push({
            ...structuredClone(created),
            round: draftQuiz.round,
          });
          draftQuiz.updatedAt = new Date().toISOString();
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
            quiz: {
              id: quiz.id,
              question: publicQuestionSummary(quiz),
              accessOptions: publicAccessOptions(quiz),
              participantCount: Math.max(
                serializeParticipants(quiz).length,
                quiz.submissions.length
              ),
            },
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
