export const STORAGE_KEY = "baynat.daily-question.v2";
export const QUESTION_TYPES = Object.freeze({
  multiple: "اختيار متعدد",
  boolean: "صح أو خطأ",
  short: "مقالي قصير",
});

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const WESTERN_DIGITS = "0123456789";
const PLACE_BONUSES = [30, 20, 10];
const DEFAULT_OPTIONS = ["الزهرة", "المريخ", "المشتري", "عطارد"];

export function normalizeDigits(value = "") {
  return String(value)
    .replace(/[٠-٩]/g, (digit) => WESTERN_DIGITS[ARABIC_DIGITS.indexOf(digit)])
    .replace(/[۰-۹]/g, (digit) => WESTERN_DIGITS["۰۱۲۳۴۵۶۷۸۹".indexOf(digit)]);
}

export function toArabicDigits(value = "") {
  return String(value).replace(/[0-9]/g, (digit) => ARABIC_DIGITS[Number(digit)]);
}

export function formatNumber(value, options = {}) {
  return new Intl.NumberFormat("ar-SA", {
    maximumFractionDigits: 0,
    useGrouping: true,
    ...options,
  }).format(value);
}

export function normalizeAnswer(value = "") {
  return normalizeDigits(value)
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ar")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/[ـ]/g, "")
    .replace(/\s+/g, " ");
}

export function isAnswerCorrect(question, answer) {
  if (!question || answer === null || answer === undefined) return false;
  const normalizedAnswer = normalizeAnswer(answer);
  const acceptedAnswers =
    question.type === "short"
      ? String(question.correctAnswer || "").split("|")
      : [String(question.correctAnswer || "")];
  return acceptedAnswers
    .map(normalizeAnswer)
    .filter(Boolean)
    .some((acceptedAnswer) => normalizedAnswer === acceptedAnswer);
}

export function validateStudentInput(student, existingStudents = []) {
  const name = String(student?.name || "").trim();
  const className = String(student?.className || "").trim();
  const pin = normalizeDigits(student?.pin || "").trim();

  if (name.length < 2) {
    return { valid: false, error: "اكتب اسم الطالب كاملًا." };
  }
  if (!className) {
    return { valid: false, error: "اكتب صف الطالب." };
  }
  if (!/^\d{4}$/.test(pin)) {
    return { valid: false, error: "يجب أن يتكوّن رمز الدخول من ٤ أرقام." };
  }
  if (existingStudents.some((item) => normalizeDigits(item.pin || "") === pin)) {
    return { valid: false, error: "رمز الدخول مستخدم لطالب آخر. اختر رمزًا مختلفًا." };
  }

  return { valid: true, value: { name, className, pin } };
}

export function validateQuestion(question) {
  if (!question || String(question.prompt || "").trim().length < 5) {
    return { valid: false, error: "اكتب سؤالًا واضحًا لا يقل عن ٥ أحرف." };
  }

  if (!QUESTION_TYPES[question.type]) {
    return { valid: false, error: "اختر نوعًا صحيحًا للسؤال." };
  }

  if (question.type === "multiple") {
    const options = (question.options || []).map((option) => String(option).trim()).filter(Boolean);
    if (options.length < 2) {
      return { valid: false, error: "أضف خيارين على الأقل." };
    }
    if (new Set(options.map(normalizeAnswer)).size !== options.length) {
      return { valid: false, error: "لا يمكن تكرار الخيار نفسه أكثر من مرة." };
    }
    if (!options.some((option) => normalizeAnswer(option) === normalizeAnswer(question.correctAnswer))) {
      return { valid: false, error: "حدّد الإجابة الصحيحة من الخيارات." };
    }
  }

  if (
    !String(question.correctAnswer || "").trim() ||
    (question.type === "short" &&
      !String(question.correctAnswer)
        .split("|")
        .some((answer) => normalizeAnswer(answer)))
  ) {
    return { valid: false, error: "حدّد الإجابة الصحيحة قبل الحفظ." };
  }

  return { valid: true };
}

export function calculateScore({ isCorrect, elapsedMs = 0, speedPlace = 0 }) {
  if (!isCorrect) {
    return { accuracyPoints: 0, speedPoints: 0, placePoints: 0, total: 0 };
  }

  const safeElapsed = Math.max(0, Number(elapsedMs) || 0);
  const speedPoints = Math.max(0, 60 - Math.floor((safeElapsed / 1000) * 2));
  const placePoints = PLACE_BONUSES[speedPlace - 1] || 0;
  return {
    accuracyPoints: 100,
    speedPoints,
    placePoints,
    total: 100 + speedPoints + placePoints,
  };
}

export function buildLeaderboard(students = [], submissions = [], questionId) {
  const relevant = submissions.filter((submission) => submission.questionId === questionId);
  const firstByStudent = new Map();

  relevant
    .slice()
    .sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime())
    .forEach((submission) => {
      if (!firstByStudent.has(submission.studentId)) {
        firstByStudent.set(submission.studentId, submission);
      }
    });

  const unique = [...firstByStudent.values()];
  const correctBySpeed = unique
    .filter((submission) => submission.isCorrect)
    .slice()
    .sort(
      (a, b) =>
        a.elapsedMs - b.elapsedMs ||
        new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime()
    );
  const speedPlaces = new Map(correctBySpeed.map((submission, index) => [submission.id, index + 1]));

  return unique
    .map((submission) => {
      const student = students.find((item) => item.id === submission.studentId) || {
        id: submission.studentId,
        name: "طالب",
        className: "—",
      };
      const score = calculateScore({
        isCorrect: submission.isCorrect,
        elapsedMs: submission.elapsedMs,
        speedPlace: speedPlaces.get(submission.id) || 0,
      });
      return { ...submission, ...score, student };
    })
    .sort(
      (a, b) =>
        b.total - a.total ||
        Number(b.isCorrect) - Number(a.isCorrect) ||
        a.elapsedMs - b.elapsedMs ||
        new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime()
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export function hashPin(questionId, pin) {
  const input = `${questionId}:${normalizeDigits(pin)}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  if (typeof btoa === "function") return btoa(binary);
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(value) {
  const binary = typeof atob === "function" ? atob(value) : Buffer.from(value, "base64").toString("binary");
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function encodeSharePayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeSharePayload(encoded) {
  try {
    const normalized = String(encoded || "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const json = new TextDecoder().decode(base64ToBytes(padded));
    const payload = JSON.parse(json);
    const validQuestion =
      payload?.question?.id &&
      validateQuestion(payload.question).valid &&
      typeof payload.question.createdAt === "string";
    const validStudents =
      Array.isArray(payload?.students) &&
      payload.students.length > 0 &&
      payload.students.every(
        (student) =>
          typeof student.id === "string" &&
          typeof student.name === "string" &&
          typeof student.className === "string" &&
          typeof student.pinHash === "string"
      );
    const validSubmissions =
      Array.isArray(payload?.submissions) &&
      payload.submissions.every(
        (submission) =>
          typeof submission.id === "string" &&
          typeof submission.studentId === "string" &&
          submission.questionId === payload.question.id &&
          typeof submission.isCorrect === "boolean" &&
          Number.isFinite(submission.elapsedMs) &&
          submission.elapsedMs >= 0 &&
          Number.isFinite(new Date(submission.submittedAt).getTime())
      );

    if (payload?.version !== 1 || !validQuestion || !validStudents || !validSubmissions) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function createSharePayload(state) {
  return {
    version: 1,
    question: state.currentQuestion,
    students: state.students.map(({ id, name, className, pin, pinHash }) => ({
      id,
      name,
      className,
      pinHash: pinHash || hashPin(state.currentQuestion.id, pin),
    })),
    submissions: state.submissions
      .filter((submission) => submission.questionId === state.currentQuestion.id)
      .map(({ id, studentId, questionId, isCorrect, elapsedMs, submittedAt }) => ({
        id,
        studentId,
        questionId,
        isCorrect,
        elapsedMs,
        submittedAt,
      })),
  };
}

export function createInitialState(now = Date.now()) {
  const questionId = "question-red-planet";
  const students = [
    { id: "student-sarah", name: "سارة القحطاني", className: "٢ / أ", pin: "4821" },
    { id: "student-omar", name: "عمر الحربي", className: "٢ / أ", pin: "7350" },
    { id: "student-noura", name: "نورة الغامدي", className: "٢ / أ", pin: "1643" },
    { id: "student-yousef", name: "يوسف الدوسري", className: "٢ / ب", pin: "2904" },
    { id: "student-layan", name: "ليان الشهري", className: "٢ / ب", pin: "6185" },
    { id: "student-rakan", name: "راكان المطيري", className: "٢ / ب", pin: "9032" },
    { id: "student-joud", name: "جود العتيبي", className: "٢ / أ", pin: "4278" },
    { id: "student-salman", name: "سلمان الزهراني", className: "٢ / ب", pin: "5519" },
  ];
  const createSubmission = (id, studentId, elapsedMs, isCorrect, minutesAgo) => ({
    id,
    studentId,
    questionId,
    answer: isCorrect ? "المريخ" : "المشتري",
    isCorrect,
    elapsedMs,
    submittedAt: new Date(now - minutesAgo * 60_000).toISOString(),
  });

  return {
    version: 2,
    currentQuestion: {
      id: questionId,
      type: "multiple",
      prompt: "أيّ كوكب يُعرف بالكوكب الأحمر؟",
      options: DEFAULT_OPTIONS.slice(),
      correctAnswer: "المريخ",
      createdAt: new Date(now - 2 * 60 * 60_000).toISOString(),
      published: true,
    },
    students,
    submissions: [
      createSubmission("submission-omar", "student-omar", 8400, true, 22),
      createSubmission("submission-noura", "student-noura", 10_200, true, 18),
      createSubmission("submission-yousef", "student-yousef", 13_100, true, 14),
      createSubmission("submission-layan", "student-layan", 9400, false, 11),
      createSubmission("submission-rakan", "student-rakan", 16_700, true, 8),
      createSubmission("submission-joud", "student-joud", 21_100, true, 4),
    ],
  };
}

let state;
let refs = {};
let editorState;
let currentStudent = null;
let timerStartedAt = null;
let timerInterval = null;
let toastTimer = null;
let sharedMode = false;
let invalidSharedLink = false;
let sharedStorageKey = "";

function loadAdminState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (
      stored?.version === 2 &&
      stored.currentQuestion?.id &&
      Array.isArray(stored.students) &&
      Array.isArray(stored.submissions)
    ) {
      return stored;
    }
  } catch {
    // A corrupt local draft should never block the classroom dashboard.
  }
  return createInitialState();
}

function createStateFromSharedPayload(payload) {
  const imported = {
    version: 2,
    currentQuestion: payload.question,
    students: payload.students,
    submissions: payload.submissions,
  };
  sharedStorageKey = `baynat.shared-progress.${payload.question.id}`;

  try {
    const localProgress = JSON.parse(localStorage.getItem(sharedStorageKey));
    if (Array.isArray(localProgress)) {
      const knownIds = new Set(imported.submissions.map((submission) => submission.id));
      imported.submissions.push(...localProgress.filter((submission) => !knownIds.has(submission.id)));
    }
  } catch {
    // Continue with the results embedded in the shared link.
  }

  return imported;
}

function persistState() {
  try {
    if (sharedMode) {
      const localOnly = state.submissions.filter((submission) => submission.localSubmission);
      localStorage.setItem(sharedStorageKey, JSON.stringify(localOnly));
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    showToast("تعذّر الحفظ على هذا الجهاز. حاول مرة أخرى.", true);
  }
}

function cacheRefs() {
  refs = {
    adminApp: document.querySelector("#adminApp"),
    studentApp: document.querySelector("#studentApp"),
    navItems: [...document.querySelectorAll(".nav-item")],
    viewButtons: [...document.querySelectorAll("[data-view]")],
    viewPanels: [...document.querySelectorAll("[data-admin-view]")],
    pageTitle: document.querySelector("#pageTitle"),
    pageKicker: document.querySelector("#pageKicker"),
    todayLabel: document.querySelector("#todayLabel"),
    sideStudentCount: document.querySelector("#sideStudentCount"),
    studentMetric: document.querySelector("#studentMetric"),
    answeredMetric: document.querySelector("#answeredMetric"),
    answeredPercent: document.querySelector("#answeredPercent"),
    speedMetric: document.querySelector("#speedMetric"),
    correctMetric: document.querySelector("#correctMetric"),
    dashboardQuestionType: document.querySelector("#dashboardQuestionType"),
    dashboardQuestionPrompt: document.querySelector("#dashboardQuestionPrompt"),
    dashboardQuestionOptions: document.querySelector("#dashboardQuestionOptions"),
    dashboardLeaders: document.querySelector("#dashboardLeaders"),
    activityList: document.querySelector("#activityList"),
    questionForm: document.querySelector("#questionForm"),
    questionTypeSelector: document.querySelector("#questionTypeSelector"),
    questionPrompt: document.querySelector("#questionPrompt"),
    promptCount: document.querySelector("#promptCount"),
    answerEditor: document.querySelector("#answerEditor"),
    builderPreviewType: document.querySelector("#builderPreviewType"),
    builderPreviewPrompt: document.querySelector("#builderPreviewPrompt"),
    builderPreviewOptions: document.querySelector("#builderPreviewOptions"),
    questionFormError: document.querySelector("#questionFormError"),
    resetQuestionButton: document.querySelector("#resetQuestionButton"),
    openStudentModal: document.querySelector("#openStudentModal"),
    studentModal: document.querySelector("#studentModal"),
    studentForm: document.querySelector("#studentForm"),
    studentName: document.querySelector("#studentName"),
    studentClass: document.querySelector("#studentClass"),
    newStudentPin: document.querySelector("#newStudentPin"),
    studentFormError: document.querySelector("#studentFormError"),
    studentSearch: document.querySelector("#studentSearch"),
    studentListCount: document.querySelector("#studentListCount"),
    studentsTableBody: document.querySelector("#studentsTableBody"),
    studentEmptyState: document.querySelector("#studentEmptyState"),
    adminPodium: document.querySelector("#adminPodium"),
    adminLeaderboardRows: document.querySelector("#adminLeaderboardRows"),
    leaderboardEmptyState: document.querySelector("#leaderboardEmptyState"),
    shareModal: document.querySelector("#shareModal"),
    shareLinkInput: document.querySelector("#shareLinkInput"),
    copyShareLink: document.querySelector("#copyShareLink"),
    toast: document.querySelector("#toast"),
    toastMessage: document.querySelector("#toastMessage"),
    studentScreens: [...document.querySelectorAll(".student-screen")],
    studentAccessScreen: document.querySelector("#studentAccessScreen"),
    accessTitle: document.querySelector("#accessTitle"),
    accessDescription: document.querySelector("#accessDescription"),
    accessFeatures: document.querySelector("#accessFeatures"),
    studentQuizScreen: document.querySelector("#studentQuizScreen"),
    studentResultScreen: document.querySelector("#studentResultScreen"),
    studentAccessForm: document.querySelector("#studentAccessForm"),
    studentPin: document.querySelector("#studentPin"),
    pinHint: document.querySelector("#pinHint"),
    pinError: document.querySelector("#pinError"),
    exitStudentView: document.querySelector("#exitStudentView"),
    tryAnotherStudent: document.querySelector("#tryAnotherStudent"),
    resultBackToAdmin: document.querySelector("#resultBackToAdmin"),
    studentGreeting: document.querySelector("#studentGreeting"),
    studentClassLabel: document.querySelector("#studentClassLabel"),
    studentTimer: document.querySelector("#studentTimer"),
    studentAnswerForm: document.querySelector("#studentAnswerForm"),
    studentQuestionType: document.querySelector("#studentQuestionType"),
    studentQuestionPrompt: document.querySelector("#studentQuestionPrompt"),
    studentAnswerEditor: document.querySelector("#studentAnswerEditor"),
    studentAnswerError: document.querySelector("#studentAnswerError"),
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
    studentLeaderboard: document.querySelector("#studentLeaderboard"),
  };
}

function bindEvents() {
  refs.viewButtons.forEach((button) => {
    button.addEventListener("click", () => switchAdminView(button.dataset.view));
  });

  document.querySelectorAll(".preview-student-button").forEach((button) => {
    button.addEventListener("click", () => showStudentApp("access"));
  });
  document.querySelectorAll(".share-question-button").forEach((button) => {
    button.addEventListener("click", openShareModal);
  });
  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => document.querySelector(`#${button.dataset.closeDialog}`)?.close());
  });

  refs.questionTypeSelector.addEventListener("click", handleQuestionTypeChange);
  refs.questionPrompt.addEventListener("input", () => {
    editorState.prompt = refs.questionPrompt.value;
    renderQuestionEditorPreview();
  });
  refs.answerEditor.addEventListener("input", handleAnswerEditorChange);
  refs.answerEditor.addEventListener("change", handleAnswerEditorChange);
  refs.questionForm.addEventListener("submit", saveQuestion);
  refs.resetQuestionButton.addEventListener("click", resetQuestionEditor);

  refs.openStudentModal.addEventListener("click", () => {
    refs.studentForm.reset();
    refs.studentFormError.textContent = "";
    refs.studentModal.showModal();
    window.setTimeout(() => refs.studentName.focus(), 80);
  });
  refs.newStudentPin.addEventListener("input", () => {
    refs.newStudentPin.value = normalizeDigits(refs.newStudentPin.value).replace(/\D/g, "").slice(0, 4);
  });
  refs.studentForm.addEventListener("submit", addStudent);
  refs.studentSearch.addEventListener("input", renderStudents);
  refs.studentsTableBody.addEventListener("click", handleStudentTableAction);

  refs.copyShareLink.addEventListener("click", async () => {
    await copyText(refs.shareLinkInput.value);
    showToast("تم نسخ رابط الطلاب");
    refs.copyShareLink.textContent = "تم النسخ ✓";
    window.setTimeout(() => {
      refs.copyShareLink.replaceChildren(createIcon("icon-copy"), document.createTextNode("نسخ"));
    }, 1600);
  });

  refs.studentPin.addEventListener("input", () => {
    refs.studentPin.value = normalizeDigits(refs.studentPin.value).replace(/\D/g, "").slice(0, 4);
    refs.pinError.textContent = "";
  });
  refs.studentAccessForm.addEventListener("submit", accessStudentQuiz);
  refs.studentAnswerForm.addEventListener("submit", submitStudentAnswer);
  refs.exitStudentView.addEventListener("click", () => {
    if (sharedMode) {
      showStudentScreen("access");
      refs.studentPin.value = "";
      currentStudent = null;
      return;
    }
    showAdminApp();
  });
  refs.tryAnotherStudent.addEventListener("click", () => {
    currentStudent = null;
    refs.studentPin.value = "";
    refs.pinError.textContent = "";
    showStudentScreen("access");
  });
  refs.resultBackToAdmin.addEventListener("click", () => {
    showAdminApp();
    switchAdminView("leaderboard");
  });

  [refs.studentModal, refs.shareModal].forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
}

function createIcon(id) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  return svg;
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

function questionOptions(question) {
  if (question.type === "boolean") return ["صح", "خطأ"];
  if (question.type === "multiple") return question.options || [];
  return [];
}

function switchAdminView(viewName) {
  if (!viewName) return;
  showAdminApp();
  refs.viewPanels.forEach((panel) => panel.classList.toggle("active", panel.dataset.adminView === viewName));
  refs.navItems.forEach((item) => item.classList.toggle("active", item.dataset.view === viewName));

  const labels = {
    dashboard: ["لوحة المشرف", "أهلًا أستاذ محمد 👋"],
    question: ["سؤال اليوم", "أنشئ تحدّيًا جديدًا"],
    students: ["إدارة الفصل", "طلاب فصلك"],
    leaderboard: ["نتائج اليوم", "لوحة المتصدرين"],
  };
  const [kicker, title] = labels[viewName] || labels.dashboard;
  refs.pageKicker.textContent = kicker;
  refs.pageTitle.textContent = title;
  if (viewName === "question") hydrateQuestionEditor(state.currentQuestion);
  if (viewName === "students") renderStudents();
  if (viewName === "leaderboard") renderAdminLeaderboard();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showAdminApp() {
  stopTimer();
  refs.studentApp.hidden = true;
  refs.adminApp.hidden = false;
  document.body.classList.remove("student-mode");
}

function showStudentApp(screen = "access") {
  refs.adminApp.hidden = true;
  refs.studentApp.hidden = false;
  document.body.classList.add("student-mode");
  refs.exitStudentView.hidden = sharedMode;
  refs.resultBackToAdmin.hidden = sharedMode;
  refs.pinHint.hidden = sharedMode;
  refs.studentAccessForm.hidden = invalidSharedLink;
  refs.accessFeatures.hidden = invalidSharedLink;
  refs.accessTitle.textContent = invalidSharedLink ? "رابط السؤال غير صالح" : "جاهز لسؤال اليوم؟";
  refs.accessDescription.textContent = invalidSharedLink
    ? "اطلب من المشرف إرسال رابط جديد، ثم حاول مرة أخرى."
    : "أدخل رمزك المكوّن من ٤ أرقام، واستعدّ لجمع النقاط.";
  showStudentScreen(screen);
  if (screen === "access" && !invalidSharedLink) {
    window.setTimeout(() => refs.studentPin.focus(), 100);
  }
}

function showStudentScreen(screenName) {
  stopTimer();
  refs.studentScreens.forEach((screen) => {
    const matches =
      (screenName === "access" && screen === refs.studentAccessScreen) ||
      (screenName === "quiz" && screen === refs.studentQuizScreen) ||
      (screenName === "result" && screen === refs.studentResultScreen);
    screen.classList.toggle("active", matches);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderAll() {
  renderDate();
  renderDashboard();
  renderStudents();
  renderAdminLeaderboard();
}

function renderDate() {
  refs.todayLabel.textContent = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
}

function renderDashboard() {
  const question = state.currentQuestion;
  const submissions = state.submissions.filter((item) => item.questionId === question.id);
  const leaderboard = buildLeaderboard(state.students, state.submissions, question.id);
  const correct = submissions.filter((item) => item.isCorrect);
  const average = submissions.length
    ? submissions.reduce((sum, item) => sum + item.elapsedMs, 0) / submissions.length
    : 0;

  refs.sideStudentCount.textContent = formatNumber(state.students.length);
  refs.studentMetric.textContent = formatNumber(state.students.length);
  refs.answeredMetric.textContent = formatNumber(submissions.length);
  refs.answeredPercent.textContent = submissions.length
    ? `${formatNumber(Math.round((submissions.length / Math.max(1, state.students.length)) * 100))}٪ من الفصل`
    : "بانتظار الإجابات";
  refs.speedMetric.textContent = submissions.length ? formatSeconds(average) : "—";
  refs.correctMetric.textContent = submissions.length
    ? `${formatNumber(Math.round((correct.length / submissions.length) * 100))}٪`
    : "٠٪";

  refs.dashboardQuestionType.textContent = QUESTION_TYPES[question.type];
  refs.dashboardQuestionPrompt.textContent = question.prompt;
  renderDashboardOptions(question);
  renderDashboardLeaders(leaderboard);
  renderActivity(submissions);
}

function renderDashboardOptions(question) {
  const options = questionOptions(question);
  if (question.type === "short") {
    const item = createElement("div", "mini-option correct");
    item.append(createElement("span", "", "✓"), createElement("span", "", `الإجابة: ${question.correctAnswer}`));
    refs.dashboardQuestionOptions.replaceChildren(item);
    return;
  }

  refs.dashboardQuestionOptions.replaceChildren(
    ...options.map((option, index) => {
      const item = createElement(
        "div",
        `mini-option${isAnswerCorrect(question, option) ? " correct" : ""}`
      );
      item.append(
        createElement("span", "", isAnswerCorrect(question, option) ? "✓" : String.fromCharCode(65 + index)),
        createElement("span", "", option)
      );
      return item;
    })
  );
}

function renderDashboardLeaders(leaderboard) {
  if (!leaderboard.length) {
    refs.dashboardLeaders.replaceChildren(createElement("p", "empty-inline", "بانتظار أول إجابة..."));
    return;
  }

  refs.dashboardLeaders.replaceChildren(
    ...leaderboard.slice(0, 4).map((entry, index) => {
      const row = createElement("div", "leader-row");
      const position = createElement(
        "span",
        `leader-position${index < 3 ? " medal" : ""}`,
        ["🥇", "🥈", "🥉"][index] || formatNumber(entry.rank)
      );
      const details = createElement("div", "leader-details");
      details.append(
        createElement("strong", "", entry.student.name),
        createElement("span", "", `${entry.student.className} · ${formatSeconds(entry.elapsedMs)}`)
      );
      row.append(
        position,
        avatarFor(entry.student, index),
        details,
        createElement("span", "leader-score", `${formatNumber(entry.total)} نقطة`)
      );
      return row;
    })
  );
}

function renderActivity(submissions) {
  const recent = submissions
    .slice()
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())
    .slice(0, 4);

  if (!recent.length) {
    refs.activityList.replaceChildren(createElement("p", "empty-inline", "لا توجد إجابات بعد."));
    return;
  }

  refs.activityList.replaceChildren(
    ...recent.map((submission, index) => {
      const student = state.students.find((item) => item.id === submission.studentId) || { name: "طالب" };
      const row = createElement("div", "activity-row");
      const details = createElement("div", "activity-details");
      details.append(
        createElement("strong", "", student.name),
        createElement("span", "", `${submission.isCorrect ? "إجابة صحيحة" : "إجابة غير صحيحة"} · ${relativeTime(submission.submittedAt)}`)
      );
      row.append(
        avatarFor(student, index + 2),
        details,
        createElement("span", `activity-status ${submission.isCorrect ? "correct" : "wrong"}`, submission.isCorrect ? "✓" : "×")
      );
      return row;
    })
  );
}

function relativeTime(dateString) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(dateString).getTime()) / 60_000));
  if (minutes < 1) return "الآن";
  if (minutes < 60) return `قبل ${formatNumber(minutes)} د`;
  const hours = Math.round(minutes / 60);
  return `قبل ${formatNumber(hours)} س`;
}

function formatSeconds(elapsedMs) {
  return `${formatNumber(elapsedMs / 1000, {
    minimumFractionDigits: elapsedMs < 10_000 ? 1 : 0,
    maximumFractionDigits: 1,
  })} ث`;
}

function hydrateQuestionEditor(question) {
  editorState = {
    type: question.type,
    prompt: question.prompt,
    options:
      question.type === "multiple" && question.options?.length
        ? [...question.options]
        : DEFAULT_OPTIONS.slice(),
    correctIndex:
      question.type === "multiple"
        ? Math.max(
            0,
            (question.options || []).findIndex(
              (option) => normalizeAnswer(option) === normalizeAnswer(question.correctAnswer)
            )
          )
        : 0,
    correctAnswer: question.type === "multiple" ? "" : question.correctAnswer,
  };
  refs.questionPrompt.value = editorState.prompt;
  refs.questionFormError.textContent = "";
  updateTypeButtons();
  renderAnswerEditor();
  renderQuestionEditorPreview();
}

function resetQuestionEditor() {
  editorState = {
    type: "multiple",
    prompt: "",
    options: ["", "", "", ""],
    correctIndex: 0,
    correctAnswer: "",
  };
  refs.questionPrompt.value = "";
  refs.questionFormError.textContent = "";
  updateTypeButtons();
  renderAnswerEditor();
  renderQuestionEditorPreview();
  refs.questionPrompt.focus();
}

function handleQuestionTypeChange(event) {
  const button = event.target.closest("[data-question-type]");
  if (!button || button.dataset.questionType === editorState.type) return;

  editorState.type = button.dataset.questionType;
  if (editorState.type === "multiple") {
    editorState.options = editorState.options?.length === 4 ? editorState.options : ["", "", "", ""];
    editorState.correctIndex = 0;
  } else if (editorState.type === "boolean") {
    editorState.correctAnswer = "صح";
  } else {
    editorState.correctAnswer = "";
  }
  updateTypeButtons();
  renderAnswerEditor();
  renderQuestionEditorPreview();
}

function updateTypeButtons() {
  refs.questionTypeSelector.querySelectorAll("[data-question-type]").forEach((button) => {
    const active = button.dataset.questionType === editorState.type;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function renderAnswerEditor() {
  if (editorState.type === "multiple") {
    const wrapper = createElement("div", "answer-option-editor");
    const labels = ["A", "B", "C", "D"];
    editorState.options.forEach((option, index) => {
      const row = createElement("div", "editor-option");
      const input = document.createElement("input");
      input.type = "text";
      input.value = option;
      input.maxLength = 70;
      input.placeholder = `الخيار ${formatNumber(index + 1)}`;
      input.dataset.optionIndex = String(index);
      input.setAttribute("aria-label", `الخيار ${formatNumber(index + 1)}`);

      const picker = createElement("label", "correct-picker");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "correctOption";
      radio.value = String(index);
      radio.checked = editorState.correctIndex === index;
      radio.setAttribute("aria-label", "تعيين كإجابة صحيحة");
      picker.append(radio, createElement("span", "", "✓"));
      row.append(createElement("span", "option-letter", labels[index]), input, picker);
      wrapper.append(row);
    });
    refs.answerEditor.replaceChildren(wrapper);
    return;
  }

  if (editorState.type === "boolean") {
    const wrapper = createElement("div", "boolean-editor");
    ["صح", "خطأ"].forEach((value) => {
      const label = createElement("label", "boolean-choice");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "booleanAnswer";
      input.value = value;
      input.checked = editorState.correctAnswer === value;
      label.append(input, createElement("i", "", value === "صح" ? "✓" : "×"), createElement("span", "", value));
      wrapper.append(label);
    });
    refs.answerEditor.replaceChildren(wrapper);
    return;
  }

  const wrapper = createElement("div", "short-answer-wrap");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "short-answer-input";
  input.maxLength = 300;
  input.value = editorState.correctAnswer || "";
  input.placeholder = "اكتب الإجابة النموذجية القصيرة";
  input.dataset.shortAnswer = "true";
  wrapper.append(
    input,
    createElement(
      "p",
      "",
      "تُصحّح تلقائيًا بعد تجاهل المسافات والتشكيل. أضف صيغًا بديلة وافصل بينها بعلامة |."
    )
  );
  refs.answerEditor.replaceChildren(wrapper);
}

function handleAnswerEditorChange(event) {
  if (event.target.matches("[data-option-index]")) {
    editorState.options[Number(event.target.dataset.optionIndex)] = event.target.value;
  } else if (event.target.name === "correctOption") {
    editorState.correctIndex = Number(event.target.value);
  } else if (event.target.name === "booleanAnswer") {
    editorState.correctAnswer = event.target.value;
  } else if (event.target.matches("[data-short-answer]")) {
    editorState.correctAnswer = event.target.value;
  }
  renderQuestionEditorPreview();
}

function editorQuestion() {
  const prompt = editorState.prompt.trim();
  if (editorState.type === "multiple") {
    const options = editorState.options.map((option) => option.trim());
    return {
      type: "multiple",
      prompt,
      options,
      correctAnswer: options[editorState.correctIndex] || "",
    };
  }
  if (editorState.type === "boolean") {
    return { type: "boolean", prompt, options: ["صح", "خطأ"], correctAnswer: editorState.correctAnswer };
  }
  return { type: "short", prompt, options: [], correctAnswer: editorState.correctAnswer.trim() };
}

function renderQuestionEditorPreview() {
  const question = editorQuestion();
  refs.promptCount.textContent = formatNumber(editorState.prompt.length);
  refs.builderPreviewType.textContent = QUESTION_TYPES[question.type];
  refs.builderPreviewPrompt.textContent = question.prompt || "اكتب سؤال اليوم ليظهر هنا...";

  if (question.type === "short") {
    refs.builderPreviewOptions.replaceChildren(
      createElement("div", "preview-short-answer", "اكتب إجابتك هنا...")
    );
    return;
  }

  refs.builderPreviewOptions.replaceChildren(
    ...questionOptions(question)
      .filter((option) => option.trim())
      .map((option, index) => {
        const item = createElement("div", "preview-option");
        item.append(
          createElement("i", "", question.type === "boolean" ? (index === 0 ? "✓" : "×") : String.fromCharCode(65 + index)),
          createElement("span", "", option)
        );
        return item;
      })
  );
}

function hasSameQuestionContent(first, second) {
  return (
    first.type === second.type &&
    normalizeAnswer(first.prompt) === normalizeAnswer(second.prompt) &&
    normalizeAnswer(first.correctAnswer) === normalizeAnswer(second.correctAnswer) &&
    JSON.stringify((first.options || []).map(normalizeAnswer)) ===
      JSON.stringify((second.options || []).filter(Boolean).map(normalizeAnswer))
  );
}

function saveQuestion(event) {
  event.preventDefault();
  editorState.prompt = refs.questionPrompt.value;
  const question = editorQuestion();
  const validation = validateQuestion(question);
  if (!validation.valid) {
    refs.questionFormError.textContent = validation.error;
    return;
  }

  const currentSubmissions = state.submissions.filter(
    (submission) => submission.questionId === state.currentQuestion.id
  );
  const contentChanged = !hasSameQuestionContent(state.currentQuestion, question);
  if (
    contentChanged &&
    currentSubmissions.length > 0 &&
    !window.confirm(
      "نشر هذا السؤال سيبدأ تحدّيًا جديدًا ويصفّر نتائج السؤال الحالي على هذا الجهاز. هل تريد المتابعة؟"
    )
  ) {
    return;
  }

  if (!contentChanged) {
    state.currentQuestion.published = true;
    persistState();
    showToast("السؤال منشور بالفعل");
    window.setTimeout(openShareModal, 250);
    return;
  }

  state.currentQuestion = {
    ...question,
    options: question.type === "multiple" ? question.options.filter(Boolean) : question.options,
    id: `question-${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),
    published: true,
  };
  state.submissions = [];
  persistState();
  refs.questionFormError.textContent = "";
  hydrateQuestionEditor(state.currentQuestion);
  renderAll();
  showToast("تم حفظ سؤال اليوم ونشره");
  window.setTimeout(openShareModal, 350);
}

function addStudent(event) {
  event.preventDefault();
  const validation = validateStudentInput(
    {
      name: refs.studentName.value,
      className: refs.studentClass.value,
      pin: refs.newStudentPin.value,
    },
    state.students
  );
  if (!validation.valid) {
    refs.studentFormError.textContent = validation.error;
    return;
  }

  state.students.push({
    id: `student-${Date.now().toString(36)}`,
    ...validation.value,
  });
  persistState();
  refs.studentModal.close();
  refs.studentForm.reset();
  renderAll();
  showToast(`تمت إضافة ${validation.value.name}`);
}

function handleStudentTableAction(event) {
  const button = event.target.closest("[data-delete-student]");
  if (!button) return;
  const student = state.students.find((item) => item.id === button.dataset.deleteStudent);
  if (!student) return;
  if (!window.confirm(`هل تريد حذف ${student.name} من الفصل؟`)) return;

  state.students = state.students.filter((item) => item.id !== student.id);
  state.submissions = state.submissions.filter((submission) => submission.studentId !== student.id);
  persistState();
  renderAll();
  showToast("تم حذف الطالب من الفصل");
}

function renderStudents() {
  const query = normalizeAnswer(refs.studentSearch?.value || "");
  const filtered = state.students.filter((student) =>
    normalizeAnswer(`${student.name} ${student.className}`).includes(query)
  );
  const submittedIds = new Set(
    state.submissions
      .filter((submission) => submission.questionId === state.currentQuestion.id)
      .map((submission) => submission.studentId)
  );

  refs.studentListCount.textContent = formatNumber(filtered.length);
  refs.studentEmptyState.hidden = filtered.length > 0;
  refs.studentsTableBody.hidden = filtered.length === 0;
  refs.studentsTableBody.replaceChildren(
    ...filtered.map((student, index) => {
      const row = document.createElement("tr");
      const studentColumn = document.createElement("td");
      const studentCell = createElement("div", "student-cell");
      const details = createElement("div");
      details.append(createElement("strong", "", student.name), createElement("span", "", `طالب ${student.className}`));
      studentCell.append(avatarFor(student, index), details);
      studentColumn.append(studentCell);

      const classColumn = createElement("td", "", student.className);
      const pinColumn = document.createElement("td");
      const pin = createElement("span", "pin-code");
      const visiblePin = student.pin ? toArabicDigits(student.pin) : "••••";
      [...visiblePin].forEach((digit) => pin.append(createElement("i", "", digit)));
      pinColumn.append(pin);

      const statusColumn = document.createElement("td");
      const answered = submittedIds.has(student.id);
      const status = createElement(
        "span",
        `student-status ${answered ? "answered" : "waiting"}`
      );
      status.append(createElement("i"), document.createTextNode(answered ? "أجاب اليوم" : "بانتظار الإجابة"));
      statusColumn.append(status);

      const actionColumn = document.createElement("td");
      if (!sharedMode) {
        const deleteButton = createElement("button", "row-menu", "×");
        deleteButton.type = "button";
        deleteButton.dataset.deleteStudent = student.id;
        deleteButton.title = `حذف ${student.name}`;
        deleteButton.setAttribute("aria-label", `حذف ${student.name}`);
        actionColumn.append(deleteButton);
      }
      row.append(studentColumn, classColumn, pinColumn, statusColumn, actionColumn);
      return row;
    })
  );
}

function renderAdminLeaderboard() {
  const leaderboard = buildLeaderboard(
    state.students,
    state.submissions,
    state.currentQuestion.id
  );
  refs.adminPodium.hidden = leaderboard.length === 0;
  refs.leaderboardEmptyState.hidden = leaderboard.length > 0;
  refs.adminLeaderboardRows.closest(".table-wrap").hidden = leaderboard.length === 0;

  if (leaderboard.length) {
    const podiumEntries = [
      { entry: leaderboard[1], className: "second", rank: 2 },
      { entry: leaderboard[0], className: "first", rank: 1 },
      { entry: leaderboard[2], className: "third", rank: 3 },
    ].filter((item) => item.entry);
    refs.adminPodium.replaceChildren(
      ...podiumEntries.map(({ entry, className, rank }, index) => {
        const card = createElement("article", `podium-card ${className}`);
        if (rank === 1) card.append(createElement("span", "crown", "👑"));
        card.append(
          avatarFor(entry.student, index),
          createElement("span", "podium-rank", String(rank)),
          createElement("strong", "", entry.student.name),
          createElement("span", "", entry.student.className),
          createElement("div", "podium-points", `${formatNumber(entry.total)} نقطة`)
        );
        return card;
      })
    );
  } else {
    refs.adminPodium.replaceChildren();
  }

  refs.adminLeaderboardRows.replaceChildren(
    ...leaderboard.map((entry, index) => {
      const row = document.createElement("tr");
      const rankColumn = document.createElement("td");
      rankColumn.append(createElement("span", "rank-number", String(entry.rank)));
      const studentColumn = document.createElement("td");
      const studentCell = createElement("div", "student-cell");
      const details = createElement("div");
      details.append(createElement("strong", "", entry.student.name), createElement("span", "", entry.student.className));
      studentCell.append(avatarFor(entry.student, index), details);
      studentColumn.append(studentCell);
      row.append(
        rankColumn,
        studentColumn,
        createElement(
          "td",
          `answer-state ${entry.isCorrect ? "correct" : "wrong"}`,
          entry.isCorrect ? "صحيحة ✓" : "غير صحيحة ×"
        ),
        createElement("td", "", formatSeconds(entry.elapsedMs)),
        createElement("td", "score-cell", formatNumber(entry.total))
      );
      return row;
    })
  );
}

function buildShareUrl() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("quiz", encodeSharePayload(createSharePayload(state)));
  return url.toString();
}

function openShareModal() {
  refs.shareLinkInput.value = buildShareUrl();
  refs.shareModal.showModal();
  refs.shareLinkInput.select();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const temporary = document.createElement("textarea");
    temporary.value = text;
    temporary.style.position = "fixed";
    temporary.style.opacity = "0";
    document.body.append(temporary);
    temporary.select();
    document.execCommand("copy");
    temporary.remove();
  }
}

function showToast(message, isError = false) {
  if (!refs.toast) return;
  window.clearTimeout(toastTimer);
  refs.toastMessage.textContent = message;
  refs.toast.style.borderColor = isError ? "#f3ccd1" : "";
  refs.toast.querySelector(".toast-icon").style.color = isError ? "var(--red)" : "";
  refs.toast.classList.add("show");
  toastTimer = window.setTimeout(() => refs.toast.classList.remove("show"), 2600);
}

function findStudentByPin(pin) {
  const normalized = normalizeDigits(pin);
  if (sharedMode) {
    return state.students.find(
      (student) => student.pinHash === hashPin(state.currentQuestion.id, normalized)
    );
  }
  return state.students.find((student) => normalizeDigits(student.pin) === normalized);
}

function accessStudentQuiz(event) {
  event.preventDefault();
  const pin = normalizeDigits(refs.studentPin.value);
  if (!/^\d{4}$/.test(pin)) {
    refs.pinError.textContent = "أدخل رمزك المكوّن من ٤ أرقام.";
    return;
  }

  const student = findStudentByPin(pin);
  if (!student) {
    refs.pinError.textContent = "الرمز غير صحيح. تأكد منه أو اطلبه من المشرف.";
    refs.studentPin.select();
    return;
  }

  currentStudent = student;
  refs.pinError.textContent = "";
  const existing = state.submissions.find(
    (submission) =>
      submission.questionId === state.currentQuestion.id && submission.studentId === student.id
  );
  if (existing) {
    renderStudentResult(existing);
    showStudentScreen("result");
    return;
  }

  renderStudentQuiz();
  showStudentScreen("quiz");
  startTimer();
}

function renderStudentQuiz() {
  const question = state.currentQuestion;
  refs.studentGreeting.textContent = `أهلًا ${currentStudent.name.split(" ")[0]} 👋`;
  refs.studentClassLabel.textContent = `الصف ${currentStudent.className}`;
  refs.studentQuestionType.textContent = QUESTION_TYPES[question.type];
  refs.studentQuestionPrompt.textContent = question.prompt;
  refs.studentAnswerError.textContent = "";

  if (question.type === "short") {
    const input = document.createElement("textarea");
    input.className = "student-short-answer";
    input.name = "answer";
    input.rows = 4;
    input.maxLength = 500;
    input.placeholder = "اكتب إجابتك هنا...";
    input.setAttribute("aria-label", "إجابتك");
    refs.studentAnswerEditor.replaceChildren(input);
    return;
  }

  refs.studentAnswerEditor.replaceChildren(
    ...questionOptions(question).map((option, index) => {
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
        createElement("span", "choice-radio", ""),
        createElement("span", "sr-only", `اختر ${option}`)
      );
      label.insertBefore(createElement("span", "", option), label.children[2]);
      return label;
    })
  );
}

function startTimer() {
  stopTimer();
  timerStartedAt = performance.now();
  refs.studentTimer.textContent = formatTimer(0);
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

function submitStudentAnswer(event) {
  event.preventDefault();
  const formData = new FormData(refs.studentAnswerForm);
  const answer = String(formData.get("answer") || "").trim();
  if (!answer) {
    refs.studentAnswerError.textContent = "اختر إجابة أو اكتب إجابتك أولًا.";
    return;
  }

  const elapsedMs = Math.max(0, Math.round(performance.now() - timerStartedAt));
  stopTimer();
  const submission = {
    id: `submission-${Date.now().toString(36)}`,
    studentId: currentStudent.id,
    questionId: state.currentQuestion.id,
    answer,
    isCorrect: isAnswerCorrect(state.currentQuestion, answer),
    elapsedMs,
    submittedAt: new Date().toISOString(),
    localSubmission: sharedMode,
  };
  state.submissions.push(submission);
  persistState();
  renderAll();
  renderStudentResult(submission);
  showStudentScreen("result");
}

function renderStudentResult(submission) {
  const leaderboard = buildLeaderboard(
    state.students,
    state.submissions,
    state.currentQuestion.id
  );
  const entry = leaderboard.find((item) => item.id === submission.id);
  if (!entry) return;

  const firstName = entry.student.name.split(" ")[0];
  const iconUse = refs.resultIcon.querySelector("use");
  iconUse.setAttribute("href", submission.isCorrect ? "#icon-check" : "#icon-plus");
  refs.resultIcon.classList.toggle("wrong", !submission.isCorrect);
  refs.resultKicker.textContent = submission.isCorrect ? "إجابة صحيحة! 🎉" : "وصلت إجابتك";
  refs.resultTitle.textContent = submission.isCorrect
    ? `أبدعت يا ${firstName}!`
    : `محاولة جميلة يا ${firstName}`;
  refs.resultMessage.textContent = submission.isCorrect
    ? "الدقّة والسرعة رفعتاك في لوحة المتصدرين."
    : `إجابة مقترحة: «${state.currentQuestion.correctAnswer.split("|")[0].trim()}». حاول في تحدّي الغد!`;
  refs.studentRank.textContent = `#${toArabicDigits(entry.rank)}`;
  refs.participantCount.textContent = formatNumber(leaderboard.length);
  refs.studentPoints.textContent = formatNumber(entry.total);
  refs.accuracyPoints.textContent = `+${formatNumber(entry.accuracyPoints)}`;
  refs.speedPoints.textContent = `+${formatNumber(entry.speedPoints)}`;
  refs.placePoints.textContent = `+${formatNumber(entry.placePoints)}`;
  renderStudentLeaderboard(leaderboard, entry.student.id);
}

function renderStudentLeaderboard(leaderboard, currentStudentId) {
  let visible = leaderboard.slice(0, 5);
  const currentEntry = leaderboard.find((entry) => entry.student.id === currentStudentId);
  if (currentEntry && !visible.some((entry) => entry.id === currentEntry.id)) {
    visible = [...visible, currentEntry];
  }

  refs.studentLeaderboard.replaceChildren(
    ...visible.map((entry, index) => {
      const row = createElement(
        "div",
        `student-leader-row${entry.student.id === currentStudentId ? " current" : ""}`
      );
      const details = createElement("div");
      details.append(
        createElement(
          "strong",
          "",
          entry.student.id === currentStudentId ? `${entry.student.name} (أنت)` : entry.student.name
        ),
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

function initApp() {
  cacheRefs();
  const currentUrl = new URL(window.location.href);
  const hasQuizParameter = currentUrl.searchParams.has("quiz");
  const quizPayload = currentUrl.searchParams.get("quiz");
  const sharedPayload = quizPayload ? decodeSharePayload(quizPayload) : null;
  invalidSharedLink = hasQuizParameter && !sharedPayload;
  sharedMode = hasQuizParameter;
  state = sharedPayload
    ? createStateFromSharedPayload(sharedPayload)
    : invalidSharedLink
      ? createInitialState()
      : loadAdminState();
  bindEvents();
  hydrateQuestionEditor(state.currentQuestion);
  renderAll();

  if (sharedMode) {
    showStudentApp("access");
  } else {
    showAdminApp();
    switchAdminView("dashboard");
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.addEventListener("DOMContentLoaded", initApp);
}
