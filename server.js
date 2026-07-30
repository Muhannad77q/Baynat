import {
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { closeSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildLeaderboard,
  isAnswerCorrect,
  normalizeDigits,
  validateQuestion,
  validateStudentInput,
} from "./app.js";

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_FILE = path.join(ROOT_DIR, ".data", "baynat.json");
const MAX_BODY_BYTES = 128 * 1024;
const MAX_STUDENTS = 80;
const ACCESS_WINDOW_MS = 10 * 60 * 1000;
const ACCESS_ATTEMPTS_LIMIT = 20;
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

class HttpError extends Error {
  constructor(status, message, code = "REQUEST_FAILED") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateStoredData(parsed) {
  if (
    parsed?.version !== 1 ||
    typeof parsed.secret !== "string" ||
    parsed.secret.length < 20 ||
    !isRecord(parsed.quizzes)
  ) {
    throw new Error("إصدار أو بنية ملف بيانات بَيّنات غير مدعومة؛ لن تتم الكتابة فوقه.");
  }

  let migrated = false;
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
    const validStudents =
      validQuiz &&
      quiz.students.every(
        (student) =>
          typeof student?.id === "string" &&
          typeof student.name === "string" &&
          typeof student.className === "string" &&
          typeof student.pinLookup === "string" &&
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
          Number.isFinite(new Date(session.createdAt).getTime())
      );
    const uniqueStudents =
      validStudents &&
      new Set(quiz.students.map((student) => student.id)).size === quiz.students.length &&
      new Set(quiz.students.map((student) => student.pinLookup)).size === quiz.students.length;
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
      !uniqueStudents ||
      !uniqueSubmissions
    ) {
      throw new Error("ملف بيانات بَيّنات غير مكتمل أو تالف؛ تم إيقاف الخادم لحمايته.");
    }

    if (!isRecord(quiz.starts)) {
      quiz.starts = {};
      migrated = true;
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
  return { data: parsed, migrated };
}

class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
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
        validated = validateStoredData(parsed);
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

    this.data = {
      version: 1,
      secret: randomBytes(32).toString("base64url"),
      quizzes: {},
    };
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

function verifyPin(pin, student) {
  const candidate = scryptSync(normalizeDigits(pin), student.pinSalt, 32).toString("hex");
  return safeEqual(candidate, student.pinHash);
}

function publicStudent(student) {
  return { id: student.id, name: student.name, className: student.className };
}

function publicQuestion(quiz) {
  const { type, prompt, options, createdAt } = quiz.question;
  return { id: quiz.question.id, type, prompt, options, createdAt };
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

function serializeResult(quiz, submission) {
  const leaderboard = serializeLeaderboard(quiz);
  const entry = leaderboard.find((item) => item.id === submission.id);
  return {
    entry,
    participantCount: leaderboard.length,
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
    const validation = validateStudentInput(student, accepted);
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
      pin: validation.value.pin,
      pinLookup: lookup,
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

function requireQuiz(store, quizId) {
  const quiz = store.read((data) => data.quizzes[quizId]);
  if (!quiz) throw new HttpError(404, "رابط السؤال غير صالح أو انتهى.", "QUIZ_NOT_FOUND");
  if (quiz.expiresAt && new Date(quiz.expiresAt).getTime() <= Date.now()) {
    throw new HttpError(410, "انتهت صلاحية سؤال اليوم. اطلب رابطًا جديدًا.", "QUIZ_EXPIRED");
  }
  return quiz;
}

function requireAdmin(request, quiz) {
  const token = request.headers["x-admin-token"];
  if (!token || !safeEqual(hashToken(token), quiz.adminTokenHash)) {
    throw new HttpError(401, "انتهت صلاحية جلسة المشرف.", "ADMIN_UNAUTHORIZED");
  }
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
  if (!student) {
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

function getDeviceId(request) {
  const cookies = String(request.headers.cookie || "").split(";");
  const value = cookies
    .map((cookie) => cookie.trim().split("="))
    .find(([name]) => name === "baynat_device")?.[1];
  return value && /^[A-Za-z0-9_-]{20,80}$/.test(value) ? value : "";
}

function createDeviceCookie(request, quizId, trustProxy) {
  if (getDeviceId(request)) return null;
  const secure =
    Boolean(request.socket.encrypted) ||
    (trustProxy && request.headers["x-forwarded-proto"] === "https");
  return [
    `baynat_device=${randomBytes(24).toString("base64url")}`,
    `Path=/api/quizzes/${quizId}`,
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(QUIZ_RETENTION_MS / 1000)}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function createAccessLimiter(trustProxy) {
  const attempts = new Map();
  return (request, quizId, recordFailure = false) => {
    const deviceId = getDeviceId(request);
    const client = deviceId ? `device:${deviceId}` : `ip:${getClientIp(request, trustProxy)}`;
    const key = `${quizId}:${client}`;
    const now = Date.now();
    const recent = (attempts.get(key) || []).filter((time) => now - time < ACCESS_WINDOW_MS);
    if (recent.length >= ACCESS_ATTEMPTS_LIMIT) {
      throw new HttpError(
        429,
        "محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.",
        "TOO_MANY_ATTEMPTS"
      );
    }
    if (recordFailure) recent.push(now);
    attempts.set(key, recent);
  };
}

function createQuizCreationLimiter(trustProxy) {
  const byIp = new Map();
  let globalAttempts = [];
  return (request, recordCreation = false) => {
    const now = Date.now();
    const ip = getClientIp(request, trustProxy);
    const recentForIp = (byIp.get(ip) || []).filter(
      (time) => now - time < QUIZ_CREATION_WINDOW_MS
    );
    globalAttempts = globalAttempts.filter((time) => now - time < QUIZ_CREATION_WINDOW_MS);
    if (
      recentForIp.length >= QUIZ_CREATION_IP_LIMIT ||
      globalAttempts.length >= QUIZ_CREATION_GLOBAL_LIMIT
    ) {
      throw new HttpError(
        429,
        "تم إنشاء عدة أسئلة مؤخرًا. انتظر قليلًا قبل نشر سؤال جديد.",
        "QUIZ_CREATION_LIMIT"
      );
    }
    if (recordCreation) {
      recentForIp.push(now);
      globalAttempts.push(now);
    }
    byIp.set(ip, recentForIp);
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
  trustProxy = process.env.TRUST_PROXY === "true",
  logger = console,
} = {}) {
  const store = new JsonStore(dataFile);
  await store.init();
  const recordAccessAttempt = createAccessLimiter(trustProxy);
  const recordQuizCreation = createQuizCreationLimiter(trustProxy);

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
      const pathname = url.pathname.replace(/\/+$/, "") || "/";

      if (pathname === "/api/health" && request.method === "GET") {
        json(response, 200, { ok: true, service: "baynat" }, securityHeaders());
        return;
      }

      if (pathname === "/api/quizzes" && request.method === "POST") {
        if (request.headers["sec-fetch-site"] === "cross-site") {
          throw new HttpError(403, "الطلب غير مسموح من موقع آخر.", "CROSS_SITE_REQUEST");
        }
        const body = await readJsonBody(request);
        const quizId = randomBytes(6).toString("base64url");
        const adminToken = randomBytes(32).toString("base64url");
        const question = sanitizeQuestion(body.question, quizId);
        const studentInputs = sanitizeStudentInputs(body.students, store.data.secret, quizId);
        recordQuizCreation(request, true);
        const students = await hashStudentInputs(studentInputs);
        const createdAt = new Date();
        const quiz = {
          id: quizId,
          question,
          students,
          submissions: [],
          sessions: {},
          starts: {},
          adminTokenHash: hashToken(adminToken),
          createdAt: createdAt.toISOString(),
          updatedAt: createdAt.toISOString(),
          expiresAt: new Date(createdAt.getTime() + QUIZ_RETENTION_MS).toISOString(),
        };
        await store.update((data) => {
          for (const [storedQuizId, storedQuiz] of Object.entries(data.quizzes)) {
            if (
              storedQuiz.expiresAt &&
              new Date(storedQuiz.expiresAt).getTime() <= createdAt.getTime()
            ) {
              delete data.quizzes[storedQuizId];
            }
          }
          data.quizzes[quizId] = quiz;
        });
        json(
          response,
          201,
          {
            quizId,
            questionId: question.id,
            adminToken,
            studentPath: `/student.html?q=${encodeURIComponent(quizId)}`,
          },
          securityHeaders()
        );
        return;
      }

      const adminMatch = pathname.match(/^\/api\/quizzes\/([A-Za-z0-9_-]+)\/admin$/);
      if (adminMatch && request.method === "GET") {
        const quiz = requireQuiz(store, adminMatch[1]);
        requireAdmin(request, quiz);
        json(
          response,
          200,
          {
            quiz: {
              id: quiz.id,
              question: quiz.question,
              students: quiz.students.map(publicStudent),
              submissions: quiz.submissions,
              leaderboard: serializeLeaderboard(quiz),
              updatedAt: quiz.updatedAt,
            },
          },
          securityHeaders()
        );
        return;
      }

      const studentAdminMatch = pathname.match(
        /^\/api\/quizzes\/([A-Za-z0-9_-]+)\/students(?:\/([A-Za-z0-9_-]+))?$/
      );
      if (studentAdminMatch && request.method === "POST" && !studentAdminMatch[2]) {
        const quiz = requireQuiz(store, studentAdminMatch[1]);
        requireAdmin(request, quiz);
        const body = await readJsonBody(request);
        const validation = validateStudentInput(body, quiz.students);
        if (!validation.valid) {
          throw new HttpError(400, validation.error, "INVALID_STUDENT");
        }
        const lookup = pinLookup(store.data.secret, quiz.id, validation.value.pin);
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
          pinLookup: lookup,
          ...(await hashPin(validation.value.pin)),
        };
        await store.update((data) => {
          const draftQuiz = data.quizzes[quiz.id];
          if (
            draftQuiz.students.some(
              (existing) =>
                existing.id === student.id || existing.pinLookup === student.pinLookup
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
        requireAdmin(request, quiz);
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
          draftQuiz.updatedAt = new Date().toISOString();
        });
        json(response, 200, { ok: true }, securityHeaders());
        return;
      }

      const accessMatch = pathname.match(/^\/api\/quizzes\/([A-Za-z0-9_-]+)\/access$/);
      if (accessMatch && request.method === "POST") {
        let quiz = requireQuiz(store, accessMatch[1]);
        recordAccessAttempt(request, quiz.id);
        const body = await readJsonBody(request);
        const pin = normalizeDigits(body.pin || "");
        if (!/^\d{4}$/.test(pin)) {
          throw new HttpError(400, "أدخل رمزًا صحيحًا من ٤ أرقام.", "INVALID_PIN");
        }
        const lookup = pinLookup(store.data.secret, quiz.id, pin);
        const student = quiz.students.find((item) => item.pinLookup === lookup);
        if (!student || !verifyPin(pin, student)) {
          recordAccessAttempt(request, quiz.id, true);
          throw new HttpError(401, "الرمز غير صحيح. تأكد منه أو اطلبه من المشرف.", "PIN_REJECTED");
        }
        const token = randomBytes(32).toString("base64url");
        const startedAt = quiz.starts?.[student.id] || Date.now();
        await store.update((data) => {
          const draftQuiz = data.quizzes[quiz.id];
          draftQuiz.starts ||= {};
          draftQuiz.starts[student.id] ||= startedAt;
          draftQuiz.sessions = Object.fromEntries(
            Object.entries(draftQuiz.sessions).filter(
              ([, session]) => session.studentId !== student.id
            )
          );
          draftQuiz.sessions[hashToken(token)] = {
            tokenHash: hashToken(token),
            studentId: student.id,
            createdAt: new Date().toISOString(),
            startedAt: draftQuiz.starts[student.id],
          };
          draftQuiz.updatedAt = new Date().toISOString();
        });
        quiz = requireQuiz(store, accessMatch[1]);
        const existing = quiz.submissions.find(
          (submission) => submission.studentId === student.id
        );
        json(
          response,
          200,
          {
            token,
            student: publicStudent(student),
            question: publicQuestion(quiz),
            result: existing ? serializeResult(quiz, existing) : null,
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

        const startedAt = Number(session.startedAt) || new Date(session.createdAt).getTime();
        const submission = await store.update((data) => {
          const draftQuiz = data.quizzes[quiz.id];
          const existing = draftQuiz.submissions.find(
            (item) => item.studentId === student.id
          );
          if (existing) return existing;
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
          draftQuiz.updatedAt = new Date().toISOString();
          return created;
        });
        quiz = requireQuiz(store, submissionMatch[1]);
        json(
          response,
          200,
          { result: serializeResult(quiz, submission) },
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
        const deviceCookie = createDeviceCookie(request, quiz.id, trustProxy);
        json(
          response,
          200,
          {
            quiz: {
              id: quiz.id,
              question: publicQuestion(quiz),
              participantCount: quiz.submissions.length,
            },
          },
          {
            ...securityHeaders(),
            ...(deviceCookie ? { "Set-Cookie": deviceCookie } : {}),
          }
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
            },
          },
          securityHeaders()
        );
      } else {
        response.end();
      }
    }
  });

  server.on("close", () => store.close());
  return { server, store };
}

async function start() {
  const port = Number(process.env.PORT || 5173);
  const dataFile = process.env.BAYNAT_DATA_FILE || DEFAULT_DATA_FILE;
  const { server } = await createBaynatServer({ dataFile });
  server.listen(port, "0.0.0.0", () => {
    console.log(`Baynat is ready at http://0.0.0.0:${port}`);
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
