const QUESTION_TYPES = {
  multiple: "اختيار متعدد",
  boolean: "صح أو خطأ",
  short: "مقالي قصير",
  essay: "مقالي",
};
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const WESTERN_DIGITS = "0123456789";
const SESSION_STORAGE_KEY = "zakaa.weekly.student-session.v1";
const SESSION_POLL_INTERVAL_MS = 4_000;
const STALE_SESSION_CODES = new Set([
  "STUDENT_UNAUTHORIZED",
  "QUIZ_RESET_RETRY",
  "STUDENT_CHANGED_RETRY",
]);
const TERMINAL_QUIZ_CODES = new Set([
  "QUIZ_NOT_FOUND",
  "QUIZ_EXPIRED",
  "QUIZ_SUPERSEDED",
]);

let refs = {};
let quizId = "";
let quizMetadata = null;
let currentQuestion = null;
let queuedQuestion = null;
let currentStudent = null;
let studentToken = "";
let currentLeaderboard = [];
let currentSubmissions = [];
let answeredQuestionIds = new Set();
let currentProgress = {
  answeredCount: 0,
  totalQuestions: 0,
  remainingCount: 0,
  pendingCount: 0,
};
let currentCompleted = false;
let currentPending = false;
let currentStatus = "in_progress";
let participantCount = 0;
let answerLocked = false;
let resultView = "summary";
let lastSubmissionId = "";
let lastSubmissionWasPending = false;
let timerStartedAt = null;
let timerInterval = null;
let sessionPollInterval = null;
let sessionRequestInFlight = false;
let toastTimer = null;

function normalizeDigits(value = "") {
  return String(value)
    .replace(/[٠-٩]/g, (digit) => WESTERN_DIGITS[ARABIC_DIGITS.indexOf(digit)])
    .replace(/[۰-۹]/g, (digit) => WESTERN_DIGITS["۰۱۲۳۴۵۶۷۸۹".indexOf(digit)]);
}

function toArabicDigits(value = "") {
  return String(value).replace(/[0-9]/g, (digit) => ARABIC_DIGITS[Number(digit)]);
}

function formatNumber(value, options = {}) {
  const numericValue = Number(value);
  return new Intl.NumberFormat("ar-SA", {
    maximumFractionDigits: 0,
    useGrouping: true,
    ...options,
  }).format(Number.isFinite(numericValue) ? numericValue : 0);
}

function formatPoints(value) {
  return `+${formatNumber(Math.max(0, Number(value) || 0))}`;
}

function formatSeconds(elapsedMs) {
  return `${formatNumber((Number(elapsedMs) || 0) / 1000, {
    minimumFractionDigits: Number(elapsedMs) < 10_000 ? 1 : 0,
    maximumFractionDigits: 1,
  })} ث`;
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonNegativeInteger(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue >= 0
    ? numericValue
    : fallback;
}

function firstName(student = currentStudent) {
  return String(student?.name || "طالب").trim().split(/\s+/)[0] || "طالب";
}

function getInitials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "ط";
  return `${parts[0][0] || ""}${parts[1]?.[0] || ""}`;
}

function avatarFor(student, index = 0) {
  return createElement(
    "span",
    `avatar avatar-tone-${index % 5}`,
    getInitials(student?.name)
  );
}

function cacheRefs() {
  refs = {
    screens: [...document.querySelectorAll(".student-screen")],
    loadingScreen: document.querySelector("#loadingScreen"),
    errorScreen: document.querySelector("#errorScreen"),
    accessScreen: document.querySelector("#studentAccessScreen"),
    quizScreen: document.querySelector("#studentQuizScreen"),
    resultScreen: document.querySelector("#studentResultScreen"),
    errorTitle: document.querySelector("#errorTitle"),
    errorMessage: document.querySelector("#errorMessage"),
    retryButton: document.querySelector("#retryButton"),
    forgetStudentButton: document.querySelector("#forgetStudentButton"),
    accessQuestionType: document.querySelector("#accessQuestionType"),
    accessForm: document.querySelector("#studentAccessForm"),
    studentPin: document.querySelector("#studentPin"),
    pinError: document.querySelector("#pinError"),
    startChallengeButton: document.querySelector("#startChallengeButton"),
    studentGreeting: document.querySelector("#studentGreeting"),
    studentClassLabel: document.querySelector("#studentClassLabel"),
    studentTimer: document.querySelector("#studentTimer"),
    quizProgress: document.querySelector("#quizProgress"),
    quizProgressBar: document.querySelector("#quizProgressBar"),
    quizProgressText: document.querySelector("#quizProgressText"),
    answerForm: document.querySelector("#studentAnswerForm"),
    questionType: document.querySelector("#studentQuestionType"),
    questionPosition: document.querySelector("#studentQuestionPosition"),
    questionPrompt: document.querySelector("#studentQuestionPrompt"),
    answerEditor: document.querySelector("#studentAnswerEditor"),
    answerError: document.querySelector("#studentAnswerError"),
    submitAnswerButton: document.querySelector("#submitAnswerButton"),
    resultConfetti: document.querySelector("#resultConfetti"),
    resultIcon: document.querySelector("#resultIcon"),
    resultKicker: document.querySelector("#resultKicker"),
    resultTitle: document.querySelector("#resultTitle"),
    resultMessage: document.querySelector("#resultMessage"),
    studentRank: document.querySelector("#studentRank"),
    participantCount: document.querySelector("#participantCount"),
    studentPoints: document.querySelector("#studentPoints"),
    accuracyPoints: document.querySelector("#accuracyPoints"),
    speedPoints: document.querySelector("#speedPoints"),
    placePoints: document.querySelector("#placePoints"),
    resultProgress: document.querySelector("#resultProgress"),
    pendingCount: document.querySelector("#pendingCount"),
    leaderboard: document.querySelector("#studentLeaderboard"),
    nextQuestionButton: document.querySelector("#nextQuestionButton"),
    refreshLeaderboard: document.querySelector("#refreshLeaderboard"),
    toast: document.querySelector("#toast"),
    toastMessage: document.querySelector("#toastMessage"),
  };
  refs.resultTitle.tabIndex = -1;
}

function bindEvents() {
  refs.retryButton.addEventListener("click", loadQuiz);
  refs.forgetStudentButton.addEventListener("click", forgetStudent);
  refs.studentPin.addEventListener("input", () => {
    refs.studentPin.value = normalizeDigits(refs.studentPin.value)
      .replace(/\D/g, "")
      .slice(0, 4);
    refs.pinError.textContent = "";
  });
  refs.accessForm.addEventListener("submit", accessQuiz);
  refs.answerForm.addEventListener("submit", submitAnswer);
  refs.nextQuestionButton.addEventListener("click", showNextQuestion);
  refs.refreshLeaderboard.addEventListener("click", () => refreshSession(true));
  document.addEventListener("visibilitychange", () => {
    if (
      document.visibilityState === "visible" &&
      studentToken &&
      refs.resultScreen.classList.contains("active")
    ) {
      refreshSession(false);
    }
  });
}

function showScreen(screen, focusTarget = null) {
  if (screen !== refs.quizScreen) stopTimer();
  if (screen !== refs.resultScreen) stopSessionPolling();
  refs.screens.forEach((item) => {
    const active = item === screen;
    item.classList.toggle("active", active);
    item.setAttribute("aria-hidden", String(!active));
  });
  refs.forgetStudentButton.hidden = !studentToken;
  window.scrollTo({ top: 0, behavior: "auto" });
  if (focusTarget) {
    window.setTimeout(() => {
      if (screen.classList.contains("active")) focusTarget.focus();
    }, 0);
  }
}

function showError(title, message) {
  refs.errorTitle.textContent = title;
  refs.errorMessage.textContent = message;
  showScreen(refs.errorScreen, refs.retryButton);
}

function friendlyErrorMessage(error) {
  const messages = {
    QUIZ_NOT_FOUND: "رابط السؤال الأسبوعي غير صالح أو لم يعد متاحًا.",
    QUIZ_EXPIRED: "انتهت صلاحية السؤال الأسبوعي. اطلب رابطًا جديدًا من المشرف.",
    QUIZ_SUPERSEDED: "استُبدل هذا الرابط. اطلب رابط السؤال الأسبوعي النشط من المشرف.",
    STUDENT_UNAUTHORIZED: "انتهت جلسة الطالب. أدخل رمزك للمتابعة.",
  };
  return messages[error?.code] || error?.message || "تعذّر إكمال الطلب. حاول مرة أخرى.";
}

function isStaleSessionError(error) {
  return error?.status === 401 || STALE_SESSION_CODES.has(error?.code);
}

function isTerminalQuizError(error) {
  return TERMINAL_QUIZ_CODES.has(error?.code);
}

async function requestJson(path, options = {}) {
  let response;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("انتهت مهلة الاتصال. تحقق من الإنترنت وحاول مرة أخرى.");
    }
    throw new Error("تعذّر الاتصال بالتطبيق. تحقق من الإنترنت وحاول مرة أخرى.");
  } finally {
    window.clearTimeout(timeout);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    const error = new Error(
      "هذا النشر لا يعيد استجابة API صالحة. اطلب من المشرف إعادة نشر مجلد المصدر مع Build وFunctions وDatabase في Netlify."
    );
    error.code = "INVALID_API_RESPONSE";
    error.status = response.status;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "تعذّر إكمال الطلب.");
    error.code = payload?.error?.code;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function solveAccessChallenge(token, difficultyBits) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./pow-worker.js?v=1", import.meta.url));
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error("استغرق تأمين الدخول وقتًا طويلًا. حاول مرة أخرى."));
    }, 110_000);
    const finish = (callback) => {
      window.clearTimeout(timeout);
      worker.terminate();
      callback();
    };
    worker.addEventListener("message", (event) => {
      if (Number.isSafeInteger(event.data?.counter)) {
        finish(() => resolve(event.data.counter));
      } else {
        finish(() => reject(new Error("تعذّر تأمين محاولة الدخول.")));
      }
    });
    worker.addEventListener("error", () => {
      finish(() => reject(new Error("تعذّر تشغيل التحقق الآمن على هذا الجهاز.")));
    });
    worker.postMessage({ token, difficultyBits });
  });
}

function readRememberedStudent() {
  try {
    const serialized = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!serialized) return null;
    const remembered = JSON.parse(serialized);
    if (
      isObject(remembered) &&
      /^[A-Za-z0-9_-]{6,80}$/.test(remembered.quizId || "") &&
      typeof remembered.token === "string" &&
      remembered.token.length >= 20
    ) {
      return { quizId: remembered.quizId, token: remembered.token };
    }
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private or restricted browsing modes.
  }
  return null;
}

function rememberStudent() {
  if (!quizId || !studentToken) return;
  try {
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ quizId, token: studentToken })
    );
  } catch {
    // A working session must not depend on persistent browser storage.
  }
}

function removeRememberedStudent() {
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Clearing in-memory credentials is sufficient when storage is unavailable.
  }
}

function clearAuthenticatedState({ forgetStored = true } = {}) {
  stopTimer();
  stopSessionPolling();
  if (forgetStored) removeRememberedStudent();
  currentQuestion = null;
  queuedQuestion = null;
  currentStudent = null;
  studentToken = "";
  currentLeaderboard = [];
  currentSubmissions = [];
  answeredQuestionIds = new Set();
  currentProgress = {
    answeredCount: 0,
    totalQuestions: nonNegativeInteger(quizMetadata?.questionCount),
    remainingCount: nonNegativeInteger(quizMetadata?.questionCount),
    pendingCount: 0,
  };
  currentCompleted = false;
  currentPending = false;
  currentStatus = "in_progress";
  participantCount = 0;
  answerLocked = false;
  resultView = "summary";
  lastSubmissionId = "";
  lastSubmissionWasPending = false;
  if (refs.forgetStudentButton) refs.forgetStudentButton.hidden = true;
}

function nextQuestionFrom(payload) {
  if (!isObject(payload)) return null;
  if (Object.prototype.hasOwnProperty.call(payload, "nextQuestion")) {
    return isObject(payload.nextQuestion) ? payload.nextQuestion : null;
  }
  return isObject(payload.question) ? payload.question : null;
}

function normalizeProgress(progress) {
  const fallbackTotal = nonNegativeInteger(
    quizMetadata?.questionCount,
    currentProgress.totalQuestions
  );
  const totalQuestions = nonNegativeInteger(
    progress?.totalQuestions,
    fallbackTotal
  );
  const answeredCount = nonNegativeInteger(
    progress?.answeredCount,
    currentProgress.answeredCount
  );
  const pendingCount = nonNegativeInteger(
    progress?.pendingCount,
    currentProgress.pendingCount
  );
  const remainingCount = nonNegativeInteger(
    progress?.remainingCount,
    Math.max(0, totalQuestions - answeredCount)
  );
  return { answeredCount, totalQuestions, remainingCount, pendingCount };
}

function applyAuthenticatedPayload(payload) {
  if (!isObject(payload)) {
    throw new Error("تعذّر قراءة بيانات جلسة الطالب.");
  }
  if (isObject(payload.student)) currentStudent = payload.student;
  if (isObject(payload.quiz)) quizMetadata = payload.quiz;
  if (Array.isArray(payload.leaderboard)) {
    currentLeaderboard = payload.leaderboard;
  }
  if (Array.isArray(payload.submissions)) {
    currentSubmissions = payload.submissions.filter(isObject);
    answeredQuestionIds = new Set(
      currentSubmissions
        .map((submission) => submission.questionId)
        .filter((questionId) => typeof questionId === "string")
    );
  }
  if (isObject(payload.submission)) {
    const incoming = payload.submission;
    const existingIndex = currentSubmissions.findIndex(
      (submission) => submission.id === incoming.id
    );
    if (existingIndex === -1) currentSubmissions.push(incoming);
    else currentSubmissions[existingIndex] = incoming;
    if (typeof incoming.questionId === "string") {
      answeredQuestionIds.add(incoming.questionId);
    }
  }

  currentProgress = normalizeProgress(payload.progress);
  currentCompleted =
    typeof payload.completed === "boolean"
      ? payload.completed
      : currentProgress.remainingCount === 0;
  currentPending =
    typeof payload.pending === "boolean"
      ? payload.pending
      : currentProgress.pendingCount > 0;
  currentStatus =
    typeof payload.status === "string"
      ? payload.status
      : !currentCompleted
        ? "in_progress"
        : currentPending
          ? "pending"
          : "complete";
  participantCount = Math.max(
    participantCount,
    nonNegativeInteger(payload.participantCount),
    nonNegativeInteger(payload.quiz?.participantCount),
    currentLeaderboard.length
  );
  return nextQuestionFrom(payload);
}

function renderAccessMetadata() {
  const questionCount = nonNegativeInteger(
    quizMetadata?.questionCount,
    Array.isArray(quizMetadata?.questions) ? quizMetadata.questions.length : 0
  );
  refs.accessQuestionType.textContent =
    questionCount === 1
      ? "سؤال أسبوعي واحد متاح"
      : `${formatNumber(questionCount)} أسئلة أسبوعية متاحة`;
}

async function requestStudentSession({ startQuestion = false } = {}) {
  return requestJson(`/api/quizzes/${encodeURIComponent(quizId)}/session`, {
    headers: {
      Authorization: `Bearer ${studentToken}`,
      ...(startQuestion ? { "X-Start-Question": "1" } : {}),
    },
  });
}

async function loadQuiz() {
  stopSessionPolling();
  showScreen(refs.loadingScreen);
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(quizId)) {
    clearAuthenticatedState();
    showError(
      "رابط السؤال الأسبوعي غير صالح",
      "اطلب من المشرف إرسال الرابط الصحيح، ثم حاول مرة أخرى."
    );
    return;
  }

  const remembered = readRememberedStudent();
  if (remembered?.quizId === quizId) {
    studentToken = remembered.token;
    refs.forgetStudentButton.hidden = false;
    try {
      const payload = await requestStudentSession({ startQuestion: true });
      enterAuthenticatedSession(payload);
      return;
    } catch (error) {
      if (isStaleSessionError(error)) {
        await returnToPin(
          "انتهت الجلسة المحفوظة أو أُعيد ضبط النتائج. أدخل رمزك للمتابعة."
        );
        return;
      }
      if (isTerminalQuizError(error)) {
        clearAuthenticatedState();
        showError("تعذّر فتح السؤال الأسبوعي", friendlyErrorMessage(error));
        return;
      }
      showError("تعذّر استعادة جلسة الطالب", friendlyErrorMessage(error));
      return;
    }
  }

  clearAuthenticatedState({ forgetStored: false });
  await loadPublicQuizAndShowPin();
}

async function loadPublicQuizAndShowPin(message = "") {
  try {
    const payload = await requestJson(`/api/quizzes/${encodeURIComponent(quizId)}`);
    if (!isObject(payload?.quiz)) {
      throw new Error("تعذّر قراءة بيانات السؤال الأسبوعي.");
    }
    quizMetadata = payload.quiz;
    currentProgress = normalizeProgress({
      answeredCount: 0,
      totalQuestions: quizMetadata.questionCount,
      remainingCount: quizMetadata.questionCount,
      pendingCount: 0,
    });
    renderAccessMetadata();
    refs.studentPin.value = "";
    refs.pinError.textContent = message;
    showScreen(refs.accessScreen, refs.studentPin);
    return true;
  } catch (error) {
    if (isTerminalQuizError(error)) clearAuthenticatedState();
    showError(
      error?.code === "QUIZ_NOT_FOUND"
        ? "رابط السؤال الأسبوعي غير صالح"
        : "تعذّر فتح السؤال الأسبوعي",
      friendlyErrorMessage(error)
    );
    return false;
  }
}

async function accessQuiz(event) {
  event.preventDefault();
  const pin = normalizeDigits(refs.studentPin.value);
  if (!/^\d{4}$/.test(pin)) {
    refs.pinError.textContent = "أدخل رمزك المكوّن من ٤ أرقام.";
    refs.studentPin.focus();
    return;
  }

  setButtonLoading(
    refs.startChallengeButton,
    true,
    "جاري التحقق...",
    "الدخول إلى الأسئلة"
  );
  refs.pinError.textContent = "";
  try {
    const challenge = await requestJson(
      `/api/quizzes/${encodeURIComponent(quizId)}/access/challenge`,
      {
        method: "POST",
        body: JSON.stringify({ pin }),
      }
    );
    const challengeCounter = await solveAccessChallenge(
      challenge.token,
      challenge.difficultyBits
    );
    const payload = await requestJson(
      `/api/quizzes/${encodeURIComponent(quizId)}/access`,
      {
        method: "POST",
        body: JSON.stringify({
          pin,
          challengeToken: challenge.token,
          challengeCounter,
        }),
      }
    );
    if (typeof payload?.token !== "string" || payload.token.length < 20) {
      throw new Error("تعذّر إنشاء جلسة الطالب. حاول مرة أخرى.");
    }
    studentToken = payload.token;
    rememberStudent();
    refs.studentPin.value = "";
    enterAuthenticatedSession(payload);
  } catch (error) {
    if (isTerminalQuizError(error)) {
      clearAuthenticatedState();
      showError("تعذّر فتح السؤال الأسبوعي", friendlyErrorMessage(error));
      return;
    }
    refs.pinError.textContent = friendlyErrorMessage(error);
    refs.studentPin.select();
  } finally {
    setButtonLoading(
      refs.startChallengeButton,
      false,
      "جاري التحقق...",
      "الدخول إلى الأسئلة"
    );
  }
}

function enterAuthenticatedSession(payload) {
  const nextQuestion = applyAuthenticatedPayload(payload);
  if (!isObject(currentStudent) || !isObject(quizMetadata)) {
    throw new Error("تعذّر قراءة بيانات جلسة الطالب.");
  }
  refs.forgetStudentButton.hidden = false;
  if (nextQuestion) {
    displayQuestion(nextQuestion);
    return;
  }
  queuedQuestion = null;
  renderSessionSummary();
  showScreen(refs.resultScreen, refs.resultTitle);
  startSessionPolling();
}

function questionOptions(question) {
  if (question.type === "boolean") return ["صح", "خطأ"];
  if (question.type === "multiple" && Array.isArray(question.options)) {
    return question.options.map(String);
  }
  return [];
}

function isTextQuestion(question) {
  return question?.type === "short" || question?.type === "essay";
}

function renderQuizProgress() {
  const answered = currentProgress.answeredCount;
  const total = currentProgress.totalQuestions;
  const percentage = total > 0 ? Math.min(100, (answered / total) * 100) : 0;
  refs.quizProgressBar.style.width = `${percentage}%`;
  refs.quizProgressText.textContent = `أجبت عن ${formatNumber(answered)} من ${formatNumber(total)}`;
  refs.quizProgress.setAttribute("aria-valuemax", String(Math.max(1, total)));
  refs.quizProgress.setAttribute("aria-valuenow", String(Math.min(answered, total)));
}

function questionPosition(question) {
  const summaries = Array.isArray(quizMetadata?.questions)
    ? quizMetadata.questions
    : [];
  const index = summaries.findIndex((item) => item?.id === question.id);
  return index >= 0 ? index + 1 : currentProgress.answeredCount + 1;
}

function displayQuestion(question) {
  if (!isObject(question) || typeof question.id !== "string") {
    showError(
      "تعذّر عرض السؤال",
      "بيانات السؤال غير مكتملة. حدّث الصفحة أو راجع المشرف."
    );
    return;
  }
  if (answeredQuestionIds.has(question.id)) {
    refreshSession(false);
    return;
  }

  currentQuestion = question;
  queuedQuestion = null;
  answerLocked = false;
  refs.studentGreeting.textContent = `أهلًا ${firstName()} 👋`;
  refs.studentClassLabel.textContent = currentStudent?.className || "—";
  refs.questionType.textContent = QUESTION_TYPES[question.type] || "سؤال";
  refs.questionPrompt.textContent = question.prompt || "—";
  refs.answerError.textContent = "";
  const position = questionPosition(question);
  const total = Math.max(currentProgress.totalQuestions, position);
  refs.questionPosition.textContent = `السؤال ${formatNumber(position)} من ${formatNumber(total)}`;
  renderQuizProgress();

  if (isTextQuestion(question)) {
    const input = document.createElement("textarea");
    input.className = "student-short-answer";
    input.name = "answer";
    input.rows = 4;
    input.maxLength = 500;
    input.placeholder = "اكتب إجابتك هنا...";
    input.setAttribute("aria-label", "إجابتك");
    input.setAttribute("required", "");
    refs.answerEditor.replaceChildren(input);
  } else {
    refs.answerEditor.replaceChildren(
      ...questionOptions(question).map((option, index) => {
        const label = createElement("label", "student-choice");
        const input = document.createElement("input");
        input.type = "radio";
        input.name = "answer";
        input.value = option;
        input.required = true;
        const letter =
          question.type === "boolean"
            ? index === 0
              ? "✓"
              : "×"
            : String.fromCharCode(65 + index);
        label.append(
          input,
          createElement("span", "choice-letter", letter),
          createElement("span", "", option),
          createElement("span", "choice-radio", ""),
          createElement("span", "sr-only", `اختر ${option}`)
        );
        return label;
      })
    );
  }

  setButtonLoading(
    refs.submitAnswerButton,
    false,
    "جاري إرسال الإجابة...",
    "إرسال الإجابة"
  );
  showScreen(refs.quizScreen);
  startTimer();
  const firstInput = refs.answerEditor.querySelector("input, textarea");
  if (firstInput) window.setTimeout(() => firstInput.focus(), 0);
}

function startTimer() {
  stopTimer();
  timerStartedAt = performance.now();
  refs.studentTimer.textContent = formatTimer(0);
  resumeTimer();
}

function resumeTimer() {
  stopTimer();
  if (!Number.isFinite(timerStartedAt)) timerStartedAt = performance.now();
  refs.studentTimer.textContent = formatTimer(performance.now() - timerStartedAt);
  timerInterval = window.setInterval(() => {
    refs.studentTimer.textContent = formatTimer(performance.now() - timerStartedAt);
  }, 100);
}

function stopTimer() {
  if (timerInterval) window.clearInterval(timerInterval);
  timerInterval = null;
}

function formatTimer(elapsedMs) {
  const totalTenths = Math.floor(Math.max(0, elapsedMs) / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return toArabicDigits(
    `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`
  ).replace(".", "٫");
}

async function submitAnswer(event) {
  event.preventDefault();
  if (answerLocked || !currentQuestion) return;
  if (answeredQuestionIds.has(currentQuestion.id)) {
    refs.answerError.textContent = "تم إرسال إجابة هذا السؤال مسبقًا.";
    await refreshSession(false);
    return;
  }

  const formData = new FormData(refs.answerForm);
  const answer = String(formData.get("answer") || "").trim();
  if (!answer) {
    refs.answerError.textContent = "اختر إجابة أو اكتب إجابتك أولًا.";
    refs.answerEditor.querySelector("input, textarea")?.focus();
    return;
  }

  const submittedQuestionId = currentQuestion.id;
  const answeredBefore = currentProgress.answeredCount;
  answerLocked = true;
  stopTimer();
  setButtonLoading(
    refs.submitAnswerButton,
    true,
    "جاري إرسال الإجابة...",
    "إرسال الإجابة"
  );
  refs.answerError.textContent = "";
  try {
    const payload = await requestJson(
      `/api/quizzes/${encodeURIComponent(quizId)}/submissions`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${studentToken}` },
        body: JSON.stringify({
          questionId: submittedQuestionId,
          answer,
        }),
      }
    );
    if (!isObject(payload?.result) || !isObject(payload.result.submission)) {
      throw new Error("تعذّر قراءة نتيجة الإجابة.");
    }
    applyAuthenticatedPayload(payload.result);
    answeredQuestionIds.add(submittedQuestionId);
    renderSubmissionResult(payload.result);
    showScreen(refs.resultScreen, refs.resultTitle);
    startSessionPolling();
  } catch (error) {
    if (isStaleSessionError(error)) {
      await returnToPin(
        "أُعيد ضبط النتائج أو انتهت جلستك. أدخل رمزك للبدء من جديد."
      );
      return;
    }
    if (isTerminalQuizError(error)) {
      clearAuthenticatedState();
      showError("تعذّر فتح السؤال الأسبوعي", friendlyErrorMessage(error));
      return;
    }
    const reconciled = await reconcileSubmission(
      submittedQuestionId,
      answeredBefore
    );
    if (reconciled) return;
    answerLocked = false;
    refs.answerError.textContent = friendlyErrorMessage(error);
    resumeTimer();
  } finally {
    if (refs.quizScreen.classList.contains("active") && !answerLocked) {
      setButtonLoading(
        refs.submitAnswerButton,
        false,
        "جاري إرسال الإجابة...",
        "إرسال الإجابة"
      );
    }
  }
}

async function reconcileSubmission(questionId, answeredBefore) {
  if (!studentToken) return false;
  try {
    const payload = await requestStudentSession();
    const nextQuestion = nextQuestionFrom(payload);
    const progress = normalizeProgress(payload.progress);
    const confirmedBySubmission = Array.isArray(payload.submissions)
      ? payload.submissions.some(
          (submission) => submission?.questionId === questionId
        )
      : false;
    const confirmed =
      confirmedBySubmission ||
      progress.answeredCount > answeredBefore ||
      payload.completed === true ||
      (nextQuestion && nextQuestion.id !== questionId);
    if (!confirmed) return false;

    applyAuthenticatedPayload(payload);
    answeredQuestionIds.add(questionId);
    queuedQuestion = nextQuestion;
    renderRecoveredSubmission();
    showScreen(refs.resultScreen, refs.resultTitle);
    startSessionPolling();
    return true;
  } catch (error) {
    if (isStaleSessionError(error)) {
      await returnToPin(
        "أُعيد ضبط النتائج أو انتهت جلستك. أدخل رمزك للبدء من جديد."
      );
      return true;
    }
    return false;
  }
}

function setResultIcon(iconId, { wrong = false } = {}) {
  refs.resultIcon.querySelector("use").setAttribute("href", `#${iconId}`);
  refs.resultIcon.classList.toggle("wrong", wrong);
}

function renderSubmissionResult(result) {
  const submission = result.submission;
  const pending = submission.gradingStatus === "pending";
  const correct = submission.isCorrect === true;
  queuedQuestion = nextQuestionFrom(result);
  resultView = "submission";
  lastSubmissionId = submission.id || "";
  lastSubmissionWasPending = pending;

  if (pending) {
    setResultIcon("icon-clock");
    refs.resultConfetti.hidden = true;
    refs.resultKicker.textContent = "بانتظار تصحيح المشرف";
    refs.resultTitle.textContent = `وصلت إجابتك يا ${firstName()}`;
    refs.resultMessage.textContent = queuedQuestion
      ? "حُفظت إجابتك. يمكنك الانتقال إلى السؤال التالي."
      : "حُفظت إجابتك، وستتحدّث نقاطك تلقائيًا بعد التصحيح.";
  } else {
    setResultIcon(correct ? "icon-check" : "icon-plus", { wrong: !correct });
    refs.resultConfetti.hidden = !correct;
    refs.resultKicker.textContent = correct ? "إجابة صحيحة! 🎉" : "إجابة غير صحيحة";
    refs.resultTitle.textContent = correct
      ? `أبدعت يا ${firstName()}!`
      : `تم تسجيل إجابتك يا ${firstName()}`;
    refs.resultMessage.textContent = queuedQuestion
      ? "تم احتساب مجموع نقاطك. انتقل إلى السؤال التالي."
      : "أكملت الأسئلة المتاحة، وهذا مجموع نقاطك حتى الآن.";
  }
  renderScoreboard(result.entry);
  renderLeaderboard(currentLeaderboard);
  updateNextQuestionButton();
}

function renderRecoveredSubmission() {
  resultView = "summary";
  lastSubmissionId = "";
  lastSubmissionWasPending = false;
  setResultIcon(currentPending ? "icon-clock" : "icon-check");
  refs.resultConfetti.hidden = currentPending;
  refs.resultKicker.textContent = currentPending
    ? "بانتظار تصحيح المشرف"
    : "تم استلام الإجابة";
  refs.resultTitle.textContent = `تم حفظ إجابتك يا ${firstName()}`;
  refs.resultMessage.textContent = queuedQuestion
    ? "تحققنا من وصولها. يمكنك الانتقال إلى السؤال التالي."
    : "تحققنا من وصولها، وتم تحديث تقدّمك.";
  renderScoreboard();
  renderLeaderboard(currentLeaderboard);
  updateNextQuestionButton();
}

function renderSessionSummary({ newQuestion = false } = {}) {
  resultView = "summary";
  lastSubmissionId = "";
  lastSubmissionWasPending = false;
  const hasNextQuestion = Boolean(queuedQuestion);

  if (newQuestion || hasNextQuestion) {
    setResultIcon("icon-plus");
    refs.resultConfetti.hidden = true;
    refs.resultKicker.textContent = "سؤال جديد متاح";
    refs.resultTitle.textContent = `هناك سؤال جديد يا ${firstName()}`;
    refs.resultMessage.textContent = `أجبت عن ${formatNumber(currentProgress.answeredCount)} من ${formatNumber(currentProgress.totalQuestions)}. تابع عندما تكون مستعدًا.`;
  } else if (currentPending || currentStatus === "pending") {
    setResultIcon("icon-clock");
    refs.resultConfetti.hidden = true;
    refs.resultKicker.textContent = "بانتظار تصحيح المشرف";
    refs.resultTitle.textContent = `أكملت جميع الأسئلة يا ${firstName()}`;
    refs.resultMessage.textContent = `لديك ${formatNumber(currentProgress.pendingCount)} إجابة بانتظار التصحيح، وستتحدّث نقاطك تلقائيًا.`;
  } else {
    setResultIcon("icon-check");
    refs.resultConfetti.hidden = false;
    refs.resultKicker.textContent = "اكتمل السؤال الأسبوعي 🎉";
    refs.resultTitle.textContent = `أحسنت يا ${firstName()}!`;
    refs.resultMessage.textContent = `أجبت عن ${formatNumber(currentProgress.answeredCount)} من ${formatNumber(currentProgress.totalQuestions)}، وهذا مجموع نقاطك النهائي.`;
  }
  renderScoreboard();
  renderLeaderboard(currentLeaderboard);
  updateNextQuestionButton();
}

function currentLeaderboardEntry() {
  return (
    currentLeaderboard.find(
      (entry) => entry?.student?.id === currentStudent?.id
    ) || null
  );
}

function renderScoreboard(entryOverride = null) {
  const entry = entryOverride || currentLeaderboardEntry();
  refs.studentRank.textContent = entry?.rank
    ? `#${toArabicDigits(entry.rank)}`
    : "—";
  refs.participantCount.textContent = formatNumber(
    Math.max(participantCount, currentLeaderboard.length)
  );
  refs.studentPoints.textContent = formatNumber(entry?.total || 0);
  refs.accuracyPoints.textContent = formatPoints(entry?.accuracyPoints);
  refs.speedPoints.textContent = formatPoints(entry?.speedPoints);
  refs.placePoints.textContent = formatPoints(entry?.placePoints);
  refs.resultProgress.textContent = `${formatNumber(currentProgress.answeredCount)} من ${formatNumber(currentProgress.totalQuestions)}`;
  refs.pendingCount.textContent = formatNumber(currentProgress.pendingCount);
}

function renderLeaderboard(leaderboard) {
  if (!Array.isArray(leaderboard) || leaderboard.length === 0) {
    refs.leaderboard.replaceChildren(
      createElement("p", "single-attempt-note", "لا توجد نتائج لعرضها بعد.")
    );
    return;
  }

  let visible = leaderboard.slice(0, 5);
  const currentEntry = leaderboard.find(
    (entry) => entry?.student?.id === currentStudent?.id
  );
  if (
    currentEntry &&
    !visible.some((entry) => entry?.student?.id === currentStudent?.id)
  ) {
    visible = [...visible, currentEntry];
  }

  refs.leaderboard.replaceChildren(
    ...visible.map((entry, index) => {
      const student = entry.student || {};
      const current = student.id === currentStudent?.id;
      const row = createElement(
        "div",
        `student-leader-row${current ? " current" : ""}`
      );
      const details = createElement("div");
      details.append(
        createElement(
          "strong",
          "",
          current ? `${student.name || "طالب"} (أنت)` : student.name || "طالب"
        ),
        createElement(
          "span",
          "",
          `${student.className || "—"} · ${formatSeconds(entry.elapsedMs)}`
        )
      );
      row.append(
        createElement("span", "rank", `#${toArabicDigits(entry.rank || index + 1)}`),
        avatarFor(student, index),
        details,
        createElement("b", "", formatNumber(entry.total))
      );
      return row;
    })
  );
}

function updateNextQuestionButton() {
  refs.nextQuestionButton.hidden = !queuedQuestion;
  refs.nextQuestionButton.disabled = false;
}

async function showNextQuestion() {
  if (!studentToken) return;
  setButtonLoading(
    refs.nextQuestionButton,
    true,
    "جاري التحقق...",
    "السؤال التالي"
  );
  try {
    const payload = await requestStudentSession({ startQuestion: true });
    queuedQuestion = applyAuthenticatedPayload(payload);
  } catch (error) {
    if (isStaleSessionError(error)) {
      await returnToPin(
        "انتهت الجلسة أو أُعيد ضبط النتائج. أدخل رمزك للمتابعة."
      );
      return;
    }
    if (isTerminalQuizError(error)) {
      clearAuthenticatedState();
      showError("تعذّر فتح السؤال الأسبوعي", friendlyErrorMessage(error));
      return;
    }
    showToast(friendlyErrorMessage(error), true);
    return;
  } finally {
    setButtonLoading(
      refs.nextQuestionButton,
      false,
      "جاري التحقق...",
      "السؤال التالي"
    );
  }
  if (!queuedQuestion) {
    showToast("لا يوجد سؤال جديد حاليًا.", true);
    return;
  }
  const nextQuestion = queuedQuestion;
  displayQuestion(nextQuestion);
}

async function refreshSession(showConfirmation) {
  if (!studentToken || sessionRequestInFlight) return null;
  sessionRequestInFlight = true;
  const previousCompleted = currentCompleted;
  const previousPendingCount = currentProgress.pendingCount;
  const previousTotal = currentLeaderboardEntry()?.total || 0;
  try {
    const payload = await requestStudentSession();
    const nextQuestion = applyAuthenticatedPayload(payload);
    const newTotal = currentLeaderboardEntry()?.total || 0;
    const gradeUpdated =
      currentProgress.pendingCount < previousPendingCount ||
      newTotal !== previousTotal;
    if (nextQuestion) queuedQuestion = nextQuestion;

    if (refs.resultScreen.classList.contains("active")) {
      if (nextQuestion && previousCompleted) {
        renderSessionSummary({ newQuestion: true });
      } else if (
        currentCompleted &&
        previousPendingCount > 0 &&
        currentProgress.pendingCount === 0
      ) {
        queuedQuestion = null;
        renderSessionSummary();
      } else {
        renderScoreboard();
        renderLeaderboard(currentLeaderboard);
        updateNextQuestionButton();
        if (gradeUpdated && lastSubmissionWasPending) {
          refs.resultKicker.textContent = "تم تحديث التصحيح";
          refs.resultMessage.textContent = queuedQuestion
            ? "تم تحديث نقاطك. يمكنك الانتقال إلى السؤال التالي."
            : "تم تحديث نقاطك وترتيبك تلقائيًا.";
          lastSubmissionWasPending = false;
        }
      }
    }
    if (showConfirmation) {
      showToast("تم تحديث النتائج والتقدّم.");
    } else if (gradeUpdated) {
      showToast("تم تحديث التصحيح والنقاط.");
    }
    return payload;
  } catch (error) {
    if (isStaleSessionError(error)) {
      await returnToPin(
        "انتهت الجلسة أو أُعيد ضبط النتائج. أدخل رمزك للمتابعة."
      );
      return null;
    }
    if (isTerminalQuizError(error)) {
      clearAuthenticatedState();
      showError("تعذّر فتح السؤال الأسبوعي", friendlyErrorMessage(error));
      return null;
    }
    if (showConfirmation) showToast(friendlyErrorMessage(error), true);
    return null;
  } finally {
    sessionRequestInFlight = false;
  }
}

function startSessionPolling() {
  stopSessionPolling();
  sessionPollInterval = window.setInterval(
    () => refreshSession(false),
    SESSION_POLL_INTERVAL_MS
  );
}

function stopSessionPolling() {
  if (sessionPollInterval) window.clearInterval(sessionPollInterval);
  sessionPollInterval = null;
}

async function returnToPin(message) {
  clearAuthenticatedState();
  showScreen(refs.loadingScreen);
  await loadPublicQuizAndShowPin(message);
}

async function forgetStudent() {
  clearAuthenticatedState();
  showScreen(refs.loadingScreen);
  await loadPublicQuizAndShowPin(
    "تم نسيان هذا الجهاز. أدخل رمز الطالب للمتابعة."
  );
}

function setButtonLoading(button, loading, loadingText, idleText) {
  button.disabled = loading;
  button.setAttribute("aria-busy", String(loading));
  button.replaceChildren(
    document.createTextNode(loading ? loadingText : idleText)
  );
  if (!loading) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#icon-arrow");
    svg.append(use);
    button.append(svg);
  }
}

function showToast(message, isError = false) {
  window.clearTimeout(toastTimer);
  refs.toastMessage.textContent = message;
  refs.toast.style.borderColor = isError ? "#f3ccd1" : "";
  refs.toast.querySelector(".toast-icon").style.color = isError
    ? "var(--red)"
    : "";
  refs.toast.classList.add("show");
  toastTimer = window.setTimeout(
    () => refs.toast.classList.remove("show"),
    2_600
  );
}

function init() {
  cacheRefs();
  bindEvents();
  quizId = new URL(window.location.href).searchParams.get("q") || "";
  loadQuiz();
}

window.addEventListener("DOMContentLoaded", init);
