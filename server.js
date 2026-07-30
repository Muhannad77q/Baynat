import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
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

class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = null;
    this.writeQueue = Promise.resolve();
  }

  async init() {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      if (parsed?.version === 1 && parsed.secret && parsed.quizzes) {
        this.data = parsed;
        return;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    this.data = {
      version: 1,
      secret: randomBytes(32).toString("base64url"),
      quizzes: {},
    };
    await this.persist();
  }

  read(callback) {
    return callback(this.data);
  }

  update(callback) {
    const operation = this.writeQueue.then(async () => {
      const result = await callback(this.data);
      await this.persist();
      return result;
    });
    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  async persist() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
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
  return {
    pinSalt: salt,
    pinHash: scryptSync(normalizeDigits(pin), salt, 32).toString("hex"),
  };
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

function sanitizeStudents(students, secret, quizId) {
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
    const lookup = pinLookup(secret, quizId, validation.value.pin);
    if (accepted.some((item) => item.pinLookup === lookup)) {
      throw new HttpError(
        400,
        "رمز الدخول مستخدم لطالب آخر. اختر رمزًا مختلفًا.",
        "INVALID_STUDENT"
      );
    }
    const pinData = hashPin(validation.value.pin);
    accepted.push({
      id,
      name: validation.value.name,
      className: validation.value.className,
      pinLookup: lookup,
      ...pinData,
    });
  }
  return accepted;
}

function requireQuiz(store, quizId) {
  const quiz = store.read((data) => data.quizzes[quizId]);
  if (!quiz) throw new HttpError(404, "رابط السؤال غير صالح أو انتهى.", "QUIZ_NOT_FOUND");
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
  return student;
}

function getClientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  return String(forwarded || request.socket.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}

function createAccessLimiter() {
  const attempts = new Map();
  return (request, quizId, recordFailure = false) => {
    const key = `${quizId}:${getClientIp(request)}`;
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

async function serveStatic(request, response, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  let decoded;
  try {
    decoded = decodeURIComponent(requestedPath);
  } catch {
    throw new HttpError(400, "المسار غير صالح.", "INVALID_PATH");
  }
  const filePath = path.resolve(ROOT_DIR, `.${decoded}`);
  if (!filePath.startsWith(`${ROOT_DIR}${path.sep}`)) {
    throw new HttpError(403, "المسار غير مسموح.", "FORBIDDEN_PATH");
  }
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

export async function createBaynatServer({ dataFile = DEFAULT_DATA_FILE } = {}) {
  const store = new JsonStore(dataFile);
  await store.init();
  const recordAccessAttempt = createAccessLimiter();

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
      const pathname = url.pathname.replace(/\/+$/, "") || "/";

      if (pathname === "/api/health" && request.method === "GET") {
        json(response, 200, { ok: true, service: "baynat" }, securityHeaders());
        return;
      }

      if (pathname === "/api/quizzes" && request.method === "POST") {
        const body = await readJsonBody(request);
        const quizId = randomBytes(6).toString("base64url");
        const adminToken = randomBytes(32).toString("base64url");
        const question = sanitizeQuestion(body.question, quizId);
        const students = sanitizeStudents(body.students, store.data.secret, quizId);
        const quiz = {
          id: quizId,
          question,
          students,
          submissions: [],
          sessions: {},
          adminTokenHash: hashToken(adminToken),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await store.update((data) => {
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
          ...hashPin(validation.value.pin),
        };
        await store.update(() => {
          quiz.students.push(student);
          quiz.updatedAt = new Date().toISOString();
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
        await store.update(() => {
          quiz.students = quiz.students.filter((student) => student.id !== studentId);
          quiz.submissions = quiz.submissions.filter(
            (submission) => submission.studentId !== studentId
          );
          quiz.sessions = Object.fromEntries(
            Object.entries(quiz.sessions).filter(([, session]) => session.studentId !== studentId)
          );
          quiz.updatedAt = new Date().toISOString();
        });
        json(response, 200, { ok: true }, securityHeaders());
        return;
      }

      const accessMatch = pathname.match(/^\/api\/quizzes\/([A-Za-z0-9_-]+)\/access$/);
      if (accessMatch && request.method === "POST") {
        const quiz = requireQuiz(store, accessMatch[1]);
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
        await store.update(() => {
          quiz.sessions = Object.fromEntries(
            Object.entries(quiz.sessions).filter(([, session]) => session.studentId !== student.id)
          );
          quiz.sessions[hashToken(token)] = {
            tokenHash: hashToken(token),
            studentId: student.id,
            createdAt: new Date().toISOString(),
          };
          quiz.updatedAt = new Date().toISOString();
        });
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
        const quiz = requireQuiz(store, submissionMatch[1]);
        const student = requireStudent(request, quiz);
        const body = await readJsonBody(request);
        const answer = String(body.answer || "").trim();
        const elapsedMs = Math.round(Number(body.elapsedMs));
        if (!answer || answer.length > 500) {
          throw new HttpError(400, "اكتب إجابة صالحة قبل الإرسال.", "INVALID_ANSWER");
        }
        if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 60 * 60 * 1000) {
          throw new HttpError(400, "زمن الإجابة غير صالح.", "INVALID_ELAPSED_TIME");
        }

        let submission = quiz.submissions.find((item) => item.studentId === student.id);
        if (!submission) {
          submission = {
            id: `submission-${randomBytes(8).toString("base64url")}`,
            studentId: student.id,
            questionId: quiz.question.id,
            answer,
            isCorrect: isAnswerCorrect(quiz.question, answer),
            elapsedMs,
            submittedAt: new Date().toISOString(),
          };
          await store.update(() => {
            quiz.submissions.push(submission);
            quiz.updatedAt = new Date().toISOString();
          });
        }
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
              question: publicQuestion(quiz),
              participantCount: quiz.submissions.length,
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
      if (!(error instanceof HttpError)) console.error(error);
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

  return { server, store };
}

async function start() {
  const port = Number(process.env.PORT || 5173);
  const dataFile = process.env.BAYNAT_DATA_FILE || DEFAULT_DATA_FILE;
  const { server } = await createBaynatServer({ dataFile });
  server.listen(port, "0.0.0.0", () => {
    console.log(`Baynat is ready at http://0.0.0.0:${port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
