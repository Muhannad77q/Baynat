const QUESTION_TYPES = {
  multiple: "اختيار متعدد",
  boolean: "صح أو خطأ",
  short: "مقالي قصير",
};
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const WESTERN_DIGITS = "0123456789";

let refs = {};
let quizId = "";
let question = null;
let currentStudent = null;
let studentToken = "";
let timerStartedAt = null;
let timerInterval = null;
let leaderboardInterval = null;
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
  return new Intl.NumberFormat("ar-SA", {
    maximumFractionDigits: 0,
    useGrouping: true,
    ...options,
  }).format(value);
}

function formatSeconds(elapsedMs) {
  return `${formatNumber(elapsedMs / 1000, {
    minimumFractionDigits: elapsedMs < 10_000 ? 1 : 0,
    maximumFractionDigits: 1,
  })} ث`;
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function getInitials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "ط";
  return `${parts[0][0] || ""}${parts[1]?.[0] || ""}`;
}

function avatarFor(student, index = 0) {
  return createElement("span", `avatar avatar-tone-${index % 5}`, getInitials(student.name));
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
    accessQuestionType: document.querySelector("#accessQuestionType"),
    accessForm: document.querySelector("#studentAccessForm"),
    studentName: document.querySelector("#studentFullName"),
    studentClassName: document.querySelector("#studentClassName"),
    studentPin: document.querySelector("#studentPin"),
    pinError: document.querySelector("#pinError"),
    startChallengeButton: document.querySelector("#startChallengeButton"),
    studentGreeting: document.querySelector("#studentGreeting"),
    studentClassLabel: document.querySelector("#studentClassLabel"),
    studentTimer: document.querySelector("#studentTimer"),
    answerForm: document.querySelector("#studentAnswerForm"),
    questionType: document.querySelector("#studentQuestionType"),
    questionPrompt: document.querySelector("#studentQuestionPrompt"),
    answerEditor: document.querySelector("#studentAnswerEditor"),
    answerError: document.querySelector("#studentAnswerError"),
    submitAnswerButton: document.querySelector("#submitAnswerButton"),
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
    leaderboard: document.querySelector("#studentLeaderboard"),
    refreshLeaderboard: document.querySelector("#refreshLeaderboard"),
    toast: document.querySelector("#toast"),
    toastMessage: document.querySelector("#toastMessage"),
  };
}

function bindEvents() {
  refs.retryButton.addEventListener("click", loadQuiz);
  [refs.studentName, refs.studentClassName].forEach((input) =>
    input.addEventListener("input", () => {
      refs.pinError.textContent = "";
    })
  );
  refs.studentPin.addEventListener("input", () => {
    refs.studentPin.value = normalizeDigits(refs.studentPin.value).replace(/\D/g, "").slice(0, 4);
    refs.pinError.textContent = "";
  });
  refs.accessForm.addEventListener("submit", accessQuiz);
  refs.answerForm.addEventListener("submit", submitAnswer);
  refs.refreshLeaderboard.addEventListener("click", () => refreshLeaderboard(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && refs.resultScreen.classList.contains("active")) {
      refreshLeaderboard(false);
    }
  });
}

function showScreen(screen) {
  stopTimer();
  refs.screens.forEach((item) => item.classList.toggle("active", item === screen));
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (screen !== refs.resultScreen) stopLeaderboardPolling();
}

function showError(title, message) {
  refs.errorTitle.textContent = title;
  refs.errorMessage.textContent = message;
  showScreen(refs.errorScreen);
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
  } catch {
    throw new Error("تعذّر الاتصال بالتطبيق. تحقق من الإنترنت وحاول مرة أخرى.");
  } finally {
    window.clearTimeout(timeout);
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // A readable fallback is more useful than exposing a parsing error.
  }
  if (!response.ok) {
    const error = new Error(payload.error?.message || "تعذّر إكمال الطلب.");
    error.code = payload.error?.code;
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
    }, 80_000);
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

async function loadQuiz() {
  showScreen(refs.loadingScreen);
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(quizId)) {
    showError("رابط السؤال غير صالح", "اطلب من المشرف إرسال رابط جديد، ثم حاول مرة أخرى.");
    return;
  }

  try {
    const payload = await requestJson(`/api/quizzes/${encodeURIComponent(quizId)}`);
    question = payload.quiz.question;
    refs.accessQuestionType.textContent = `${QUESTION_TYPES[question.type]} · سؤال واحد`;
    showScreen(refs.accessScreen);
    window.setTimeout(() => refs.studentPin.focus(), 100);
  } catch (error) {
    showError(
      error.code === "QUIZ_NOT_FOUND" ? "رابط السؤال غير صالح" : "تعذّر فتح السؤال",
      error.message
    );
  }
}

async function accessQuiz(event) {
  event.preventDefault();
  const name = refs.studentName.value.trim();
  const className = refs.studentClassName.value.trim();
  const pin = normalizeDigits(refs.studentPin.value);
  if (name.length < 2) {
    refs.pinError.textContent = "اكتب اسمك كما سجّله المشرف.";
    refs.studentName.focus();
    return;
  }
  if (!className) {
    refs.pinError.textContent = "اكتب صفك كما سجّله المشرف.";
    refs.studentClassName.focus();
    return;
  }
  if (!/^\d{4}$/.test(pin)) {
    refs.pinError.textContent = "أدخل رمزك المكوّن من ٤ أرقام.";
    return;
  }

  setButtonLoading(refs.startChallengeButton, true, "جاري التحقق...");
  refs.pinError.textContent = "";
  try {
    const credentials = { name, className, pin };
    const challenge = await requestJson(
      `/api/quizzes/${encodeURIComponent(quizId)}/access/challenge`,
      {
        method: "POST",
        body: JSON.stringify(credentials),
      }
    );
    const challengeCounter = await solveAccessChallenge(
      challenge.token,
      challenge.difficultyBits
    );
    const payload = await requestJson(`/api/quizzes/${encodeURIComponent(quizId)}/access`, {
      method: "POST",
      body: JSON.stringify({
        ...credentials,
        challengeToken: challenge.token,
        challengeCounter,
      }),
    });
    studentToken = payload.token;
    currentStudent = payload.student;
    question = payload.question;
    if (payload.result) {
      renderResult(payload.result);
      showScreen(refs.resultScreen);
      startLeaderboardPolling();
      return;
    }
    renderQuiz();
    showScreen(refs.quizScreen);
    startTimer();
  } catch (error) {
    refs.pinError.textContent = error.message;
    refs.studentPin.select();
  } finally {
    setButtonLoading(refs.startChallengeButton, false, "ابدأ التحدّي");
  }
}

function questionOptions() {
  if (question.type === "boolean") return ["صح", "خطأ"];
  if (question.type === "multiple") return question.options || [];
  return [];
}

function renderQuiz() {
  refs.studentGreeting.textContent = `أهلًا ${currentStudent.name.split(" ")[0]} 👋`;
  refs.studentClassLabel.textContent = `الصف ${currentStudent.className}`;
  refs.questionType.textContent = QUESTION_TYPES[question.type];
  refs.questionPrompt.textContent = question.prompt;
  refs.answerError.textContent = "";

  if (question.type === "short") {
    const input = document.createElement("textarea");
    input.className = "student-short-answer";
    input.name = "answer";
    input.rows = 4;
    input.maxLength = 500;
    input.placeholder = "اكتب إجابتك هنا...";
    input.setAttribute("aria-label", "إجابتك");
    refs.answerEditor.replaceChildren(input);
    return;
  }

  refs.answerEditor.replaceChildren(
    ...questionOptions().map((option, index) => {
      const label = createElement("label", "student-choice");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "answer";
      input.value = option;
      const letter =
        question.type === "boolean" ? (index === 0 ? "✓" : "×") : String.fromCharCode(65 + index);
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

function startTimer() {
  stopTimer();
  timerStartedAt = performance.now();
  refs.studentTimer.textContent = formatTimer(0);
  resumeTimer();
}

function resumeTimer() {
  stopTimer();
  timerInterval = window.setInterval(() => {
    refs.studentTimer.textContent = formatTimer(performance.now() - timerStartedAt);
  }, 100);
}

function stopTimer() {
  if (timerInterval) window.clearInterval(timerInterval);
  timerInterval = null;
}

function formatTimer(elapsedMs) {
  const totalTenths = Math.floor(elapsedMs / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return toArabicDigits(
    `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`
  ).replace(".", "٫");
}

async function submitAnswer(event) {
  event.preventDefault();
  const formData = new FormData(refs.answerForm);
  const answer = String(formData.get("answer") || "").trim();
  if (!answer) {
    refs.answerError.textContent = "اختر إجابة أو اكتب إجابتك أولًا.";
    return;
  }

  stopTimer();
  setButtonLoading(refs.submitAnswerButton, true, "جاري إرسال الإجابة...");
  refs.answerError.textContent = "";
  try {
    const payload = await requestJson(
      `/api/quizzes/${encodeURIComponent(quizId)}/submissions`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${studentToken}` },
        body: JSON.stringify({ answer }),
      }
    );
    renderResult(payload.result);
    showScreen(refs.resultScreen);
    startLeaderboardPolling();
  } catch (error) {
    refs.answerError.textContent = error.message;
    resumeTimer();
  } finally {
    setButtonLoading(refs.submitAnswerButton, false, "إرسال الإجابة");
  }
}

function renderResult(result) {
  const entry =
    result.entry || result.leaderboard.find((item) => item.student.id === currentStudent?.id);
  if (!entry) return;

  const firstName = entry.student.name.split(" ")[0];
  const iconUse = refs.resultIcon.querySelector("use");
  iconUse.setAttribute("href", entry.isCorrect ? "#icon-check" : "#icon-plus");
  refs.resultIcon.classList.toggle("wrong", !entry.isCorrect);
  refs.resultKicker.textContent = entry.isCorrect ? "إجابة صحيحة! 🎉" : "وصلت إجابتك";
  refs.resultTitle.textContent = entry.isCorrect
    ? `أبدعت يا ${firstName}!`
    : `محاولة جميلة يا ${firstName}`;
  refs.resultMessage.textContent = entry.isCorrect
    ? "الدقّة والسرعة رفعتاك في لوحة المتصدرين."
    : `إجابة مقترحة: «${result.suggestedAnswer || "راجع المشرف"}». حاول في تحدّي الغد!`;
  refs.studentRank.textContent = `#${toArabicDigits(entry.rank)}`;
  refs.participantCount.textContent = formatNumber(result.leaderboard.length);
  refs.studentPoints.textContent = formatNumber(entry.total);
  refs.accuracyPoints.textContent = `+${formatNumber(entry.accuracyPoints)}`;
  refs.speedPoints.textContent = `+${formatNumber(entry.speedPoints)}`;
  refs.placePoints.textContent = `+${formatNumber(entry.placePoints)}`;
  renderLeaderboard(result.leaderboard);
}

function renderLeaderboard(leaderboard) {
  let visible = leaderboard.slice(0, 5);
  const currentEntry = leaderboard.find((entry) => entry.student.id === currentStudent?.id);
  if (currentEntry && !visible.some((entry) => entry.id === currentEntry.id)) {
    visible = [...visible, currentEntry];
  }

  refs.leaderboard.replaceChildren(
    ...visible.map((entry, index) => {
      const current = entry.student.id === currentStudent?.id;
      const row = createElement("div", `student-leader-row${current ? " current" : ""}`);
      const details = createElement("div");
      details.append(
        createElement("strong", "", current ? `${entry.student.name} (أنت)` : entry.student.name),
        createElement("span", "", `${entry.student.className} · ${formatSeconds(entry.elapsedMs)}`)
      );
      row.append(
        createElement("span", "rank", `#${entry.rank}`),
        avatarFor(entry.student, index),
        details,
        createElement("b", "", formatNumber(entry.total))
      );
      return row;
    })
  );
}

async function refreshLeaderboard(showConfirmation) {
  try {
    const payload = await requestJson(
      `/api/quizzes/${encodeURIComponent(quizId)}/leaderboard`,
      { headers: { Authorization: `Bearer ${studentToken}` } }
    );
    renderLeaderboard(payload.leaderboard);
    const currentEntry = payload.leaderboard.find(
      (entry) => entry.student.id === currentStudent?.id
    );
    if (currentEntry) {
      refs.studentRank.textContent = `#${toArabicDigits(currentEntry.rank)}`;
      refs.participantCount.textContent = formatNumber(payload.leaderboard.length);
      refs.studentPoints.textContent = formatNumber(currentEntry.total);
      refs.speedPoints.textContent = `+${formatNumber(currentEntry.speedPoints)}`;
      refs.placePoints.textContent = `+${formatNumber(currentEntry.placePoints)}`;
    }
    if (showConfirmation) showToast("تم تحديث ترتيب جميع الطلاب");
  } catch (error) {
    if (showConfirmation) showToast(error.message, true);
  }
}

function startLeaderboardPolling() {
  stopLeaderboardPolling();
  leaderboardInterval = window.setInterval(() => refreshLeaderboard(false), 3_000);
}

function stopLeaderboardPolling() {
  if (leaderboardInterval) window.clearInterval(leaderboardInterval);
  leaderboardInterval = null;
}

function setButtonLoading(button, loading, text) {
  button.disabled = loading;
  button.replaceChildren(document.createTextNode(text));
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
  refs.toast.querySelector(".toast-icon").style.color = isError ? "var(--red)" : "";
  refs.toast.classList.add("show");
  toastTimer = window.setTimeout(() => refs.toast.classList.remove("show"), 2600);
}

function init() {
  cacheRefs();
  bindEvents();
  quizId = new URL(window.location.href).searchParams.get("q") || "";
  loadQuiz();
}

window.addEventListener("DOMContentLoaded", init);
