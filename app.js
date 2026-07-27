const STORAGE_KEY = "bayanat-session-v1";

export const attendanceMeta = {
  present: { label: "حاضر", className: "present" },
  late: { label: "متأخر", className: "late" },
  absent: { label: "غائب", className: "absent" },
};

export const initialStudents = [
  {
    id: "abdullah-alshammari",
    name: "عبدالله الشمري",
    level: "المستوى المتوسط",
    attendance: "present",
    memorization: "النبأ 1–12",
    memorizationPages: 2,
    recitation: 5,
    review: "جزء عمّ",
    reinforcement: "الغنة في المواضع المحددة",
    tafsirRead: true,
    notes: "تلاوة متقنة، بارك الله فيه.",
    avatarColor: "#e8f3ed",
    avatarText: "#1e7453",
  },
  {
    id: "sultan-alharbi",
    name: "سلطان الحربي",
    level: "المستوى المتوسط",
    attendance: "present",
    memorization: "النبأ 13–24",
    memorizationPages: 2,
    recitation: 4.5,
    review: "سورة النازعات",
    reinforcement: "مدّ البدل",
    tafsirRead: true,
    notes: "",
    avatarColor: "#eff0fc",
    avatarText: "#5963a5",
  },
  {
    id: "yousef-alqahtani",
    name: "يوسف القحطاني",
    level: "المستوى المتوسط",
    attendance: "present",
    memorization: "النازعات 1–11",
    memorizationPages: 1.5,
    recitation: 4,
    review: "النبأ كاملة",
    reinforcement: "همز الوصل",
    tafsirRead: true,
    notes: "",
    avatarColor: "#fcf0e3",
    avatarText: "#b47532",
  },
  {
    id: "amer-alotaibi",
    name: "عامر العتيبي",
    level: "المستوى المتوسط",
    attendance: "present",
    memorization: "النازعات 12–23",
    memorizationPages: 2,
    recitation: 4.5,
    review: "النبأ 1–20",
    reinforcement: "ترقيق الراء",
    tafsirRead: true,
    notes: "",
    avatarColor: "#eaf3f6",
    avatarText: "#477d8a",
  },
  {
    id: "badr-aldosari",
    name: "بدر الدوسري",
    level: "المستوى المتوسط",
    attendance: "absent",
    memorization: "",
    memorizationPages: 0,
    recitation: 0,
    review: "",
    reinforcement: "التواصل مع ولي الأمر",
    tafsirRead: false,
    notes: "غياب دون إشعار.",
    avatarColor: "#f9e9e8",
    avatarText: "#b95f57",
  },
  {
    id: "fahad-almutairi",
    name: "فهد المطيري",
    level: "المستوى المتوسط",
    attendance: "present",
    memorization: "عبس 1–16",
    memorizationPages: 2.5,
    recitation: 5,
    review: "النازعات 1–26",
    reinforcement: "وصل الآيات",
    tafsirRead: true,
    notes: "",
    avatarColor: "#e8f4ee",
    avatarText: "#28734f",
  },
  {
    id: "ibrahim-alghamdi",
    name: "إبراهيم الغامدي",
    level: "المستوى المتوسط",
    attendance: "present",
    memorization: "عبس 17–27",
    memorizationPages: 1.5,
    recitation: 4,
    review: "النازعات كاملة",
    reinforcement: "الوقف على رؤوس الآي",
    tafsirRead: true,
    notes: "",
    avatarColor: "#f4efe4",
    avatarText: "#9a7042",
  },
  {
    id: "salman-alenezi",
    name: "سلمان العنزي",
    level: "المستوى المتوسط",
    attendance: "present",
    memorization: "عبس 28–42",
    memorizationPages: 2.5,
    recitation: 4.5,
    review: "النبأ والنازعات",
    reinforcement: "تطبيق أحكام النون",
    tafsirRead: true,
    notes: "",
    avatarColor: "#edf0fc",
    avatarText: "#5963a5",
  },
  {
    id: "tariq-alsubaie",
    name: "طارق السبيعي",
    level: "المستوى المتوسط",
    attendance: "present",
    memorization: "التكوير 1–9",
    memorizationPages: 1,
    recitation: 4.5,
    review: "عبس 1–20",
    reinforcement: "مخارج الحروف",
    tafsirRead: false,
    notes: "يحتاج تثبيت موضعين.",
    avatarColor: "#e9f4f6",
    avatarText: "#3c7682",
  },
  {
    id: "ziad-mohammed",
    name: "زياد محمد",
    level: "المستوى المتوسط",
    attendance: "late",
    memorization: "التكوير 10–29",
    memorizationPages: 3,
    recitation: 3.5,
    review: "عبس كاملة",
    reinforcement: "المدود الفرعية",
    tafsirRead: false,
    notes: "حضر متأخرًا، يحتاج مراجعة الحفظ قبل الغد.",
    avatarColor: "#fcf0e3",
    avatarText: "#b47532",
  },
];

let refs = {};
let state = createInitialState();
let toastTimer;

export function normalizeArabic(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/ـ/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .trim();
}

export function filterStudents(students, query = "", attendance = "all") {
  const normalizedQuery = normalizeArabic(query);

  return students.filter((student) => {
    const matchesQuery = !normalizedQuery || normalizeArabic(student.name).includes(normalizedQuery);
    const matchesAttendance = attendance === "all" || student.attendance === attendance;
    return matchesQuery && matchesAttendance;
  });
}

export function calculateSessionSummary(students) {
  const total = students.length;
  const present = students.filter((student) => student.attendance === "present").length;
  const late = students.filter((student) => student.attendance === "late").length;
  const absent = students.filter((student) => student.attendance === "absent").length;
  const activeStudents = students.filter((student) => student.attendance !== "absent" && Number(student.recitation) > 0);
  const memorizationPages = students.reduce((totalPages, student) => totalPages + Number(student.memorizationPages || 0), 0);
  const recitationAverage =
    activeStudents.length === 0
      ? 0
      : Number((activeStudents.reduce((totalScore, student) => totalScore + Number(student.recitation), 0) / activeStudents.length).toFixed(1));
  const tafsirRead = students.filter((student) => student.tafsirRead).length;
  const attendanceRate = total === 0 ? 0 : Math.round((present / total) * 100);

  return {
    total,
    present,
    late,
    absent,
    memorizationPages,
    recitationAverage,
    tafsirRead,
    attendanceRate,
  };
}

export function getFollowupStudents(students, limit = 3) {
  return students
    .filter((student) => student.attendance === "absent" || student.attendance === "late" || !student.tafsirRead)
    .sort((first, second) => {
      const priority = { absent: 0, late: 1, present: 2 };
      return priority[first.attendance] - priority[second.attendance];
    })
    .slice(0, limit);
}

export function createInitialState() {
  return {
    students: initialStudents.map((student) => ({ ...student })),
    selectedId: initialStudents[0].id,
    search: "",
    filter: "all",
  };
}

function loadState() {
  if (typeof window === "undefined") return createInitialState();

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return createInitialState();

    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed.students) || parsed.students.length === 0) return createInitialState();

    return {
      ...createInitialState(),
      ...parsed,
      selectedId: parsed.students.some((student) => student.id === parsed.selectedId) ? parsed.selectedId : parsed.students[0].id,
      search: "",
      filter: "all",
    };
  } catch {
    return createInitialState();
  }
}

function persistState() {
  if (typeof window === "undefined") return;

  try {
    const { students, selectedId } = state;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ students, selectedId }));
  } catch {
    // The interface remains usable when storage is unavailable.
  }
}

function getStudentById(id = state.selectedId) {
  return state.students.find((student) => student.id === id) || state.students[0];
}

function formatNumber(value, options = {}) {
  return new Intl.NumberFormat("ar-SA", {
    maximumFractionDigits: 1,
    ...options,
  }).format(value);
}

function formatScore(score) {
  if (!score) return "—";
  return Number.isInteger(score) ? String(score) : Number(score).toFixed(1);
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getInitials(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("");
}

function studentAvatarStyle(student) {
  return `style="--avatar-color:${student.avatarColor};--avatar-text:${student.avatarText}"`;
}

function getFollowupLabel(student) {
  if (student.attendance === "absent") return "غياب اليوم";
  if (student.attendance === "late") return "حضور متأخر";
  if (!student.tafsirRead) return "لم يقرأ التفسير";
  return "متابعة مطلوبة";
}

function updateTodayDate() {
  const today = new Date();
  const gregorian = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(today);
  const hijri = new Intl.DateTimeFormat("ar-SA-u-ca-islamic", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(today);

  refs.todayDate.textContent = gregorian;
  refs.todayDate.nextElementSibling.nextElementSibling.textContent = hijri;
}

function renderSummary() {
  const summary = calculateSessionSummary(state.students);
  refs.presentValue.innerHTML = `${formatNumber(summary.present)} <small>/ ${formatNumber(summary.total)}</small>`;
  refs.memorizationValue.innerHTML = `${formatNumber(summary.memorizationPages)} <small>وجهًا</small>`;
  refs.recitationValue.innerHTML = `${formatScore(summary.recitationAverage)} <small>/ 5</small>`;
  refs.tafsirValue.innerHTML = `${formatNumber(summary.tafsirRead)} <small>طلاب</small>`;
  refs.tafsirNote.textContent = `${formatNumber(summary.total - summary.tafsirRead)} طلاب بانتظار القراءة`;
  refs.attendanceProgress.style.width = `${summary.attendanceRate}%`;
  refs.todayChartBar.style.height = `${Math.max(12, summary.attendanceRate)}%`;
  refs.chartCaption.textContent = `${formatNumber(summary.attendanceRate)}% في جلسة اليوم`;

  refs.allCount.textContent = formatNumber(summary.total);
  refs.presentCount.textContent = formatNumber(summary.present);
  refs.lateCount.textContent = formatNumber(summary.late);
  refs.absentCount.textContent = formatNumber(summary.absent);
}

function renderFollowupList() {
  const followups = getFollowupStudents(state.students);
  refs.followupCount.textContent = formatNumber(followups.length);
  refs.followupList.replaceChildren();

  followups.forEach((student) => {
    const item = document.createElement("div");
    item.className = "followup-item";
    item.innerHTML = `
      <span class="followup-item__avatar" ${studentAvatarStyle(student)}>${escapeHtml(getInitials(student.name))}</span>
      <div class="followup-item__copy">
        <strong>${escapeHtml(student.name)}</strong>
        <span>${escapeHtml(student.reinforcement || "سجّل ملاحظة المتابعة")}</span>
      </div>
      <span class="followup-item__status">${getFollowupLabel(student)}</span>
    `;
    refs.followupList.append(item);
  });
}

function renderStudentTable() {
  const students = filterStudents(state.students, state.search, state.filter);
  refs.studentsTable.replaceChildren();
  refs.emptyStudents.hidden = students.length > 0;

  students.forEach((student) => {
    const attendance = attendanceMeta[student.attendance] || attendanceMeta.present;
    const row = document.createElement("tr");
    row.className = student.id === state.selectedId ? "is-selected" : "";
    row.innerHTML = `
      <td>
        <div class="student-name">
          <span class="student-avatar" ${studentAvatarStyle(student)}>${escapeHtml(getInitials(student.name))}</span>
          <div class="student-name__copy">
            <strong>${escapeHtml(student.name)}</strong>
            <small>${escapeHtml(student.level)}</small>
          </div>
        </div>
      </td>
      <td><span class="attendance-pill attendance-pill--${attendance.className}">${attendance.label}</span></td>
      <td class="memorization-cell">${escapeHtml(student.memorization || "لم يُسجّل")}</td>
      <td><span class="recitation-score">${formatScore(student.recitation)}${student.recitation ? "<i></i>" : ""}</span></td>
      <td>
        <button class="student-select-button" type="button" data-student-id="${student.id}" aria-label="تحديث سجل ${escapeHtml(student.name)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
        </button>
      </td>
    `;
    refs.studentsTable.append(row);
  });
}

function updateRangeUI() {
  const value = Number(refs.recitationInput.value);
  const percentage = ((value - 1) / 4) * 100;
  refs.recitationInput.style.setProperty("--range-value", `${percentage}%`);
  refs.recitationOutput.textContent = `${formatScore(value)} / 5`;
}

function renderRecordForm() {
  const student = getStudentById();
  if (!student) return;

  refs.selectedStudentSummary.innerHTML = `
    <span class="student-avatar" ${studentAvatarStyle(student)}>${escapeHtml(getInitials(student.name))}</span>
    <span class="selected-student__text">
      <strong>${escapeHtml(student.name)}</strong>
      <span>${escapeHtml(student.level)} · سجل جلسة اليوم</span>
    </span>
  `;

  refs.memorizationInput.value = student.memorization || "";
  refs.memorizationPagesInput.value = student.memorizationPages || 0;
  refs.reviewInput.value = student.review || "";
  refs.reinforcementInput.value = student.reinforcement || "";
  refs.recitationInput.value = student.recitation || 1;
  refs.tafsirInput.checked = Boolean(student.tafsirRead);
  refs.notesInput.value = student.notes || "";

  refs.attendanceChoices.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.attendance === student.attendance);
  });

  updateRangeUI();
}

function renderReports() {
  const summary = calculateSessionSummary(state.students);
  refs.reportAttendanceRate.textContent = `${formatNumber(summary.attendanceRate)}%`;
  refs.reportDonut.style.setProperty("--progress", `${summary.attendanceRate}%`);

  const tafsirRate = summary.total === 0 ? 0 : Math.round((summary.tafsirRead / summary.total) * 100);
  refs.reportTafsirRate.textContent = `${formatNumber(tafsirRate)}%`;
  refs.tafsirSegments.replaceChildren(
    ...Array.from({ length: Math.max(summary.total, 1) }, (_, index) => {
      const segment = document.createElement("i");
      segment.classList.toggle("is-filled", index < summary.tafsirRead);
      return segment;
    })
  );

  refs.reportStudentList.replaceChildren();
  [...state.students]
    .sort((first, second) => Number(second.memorizationPages) - Number(first.memorizationPages))
    .slice(0, 7)
    .forEach((student) => {
      const row = document.createElement("div");
      row.className = "report-row";
      const progress = Math.min(100, Math.round((Number(student.memorizationPages || 0) / 3) * 100));
      row.innerHTML = `
        <div class="report-row__student">
          <span ${studentAvatarStyle(student)}>${escapeHtml(getInitials(student.name))}</span>
          <strong>${escapeHtml(student.name)}</strong>
        </div>
        <span class="report-row__bar"><i style="--width:${progress}%"></i></span>
        <span class="report-row__detail">${formatNumber(student.memorizationPages || 0)} وجه</span>
      `;
      refs.reportStudentList.append(row);
    });
}

function renderAll() {
  updateTodayDate();
  renderSummary();
  renderFollowupList();
  renderStudentTable();
  renderRecordForm();
  renderReports();
}

function showToast(message) {
  refs.toast.textContent = message;
  refs.toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => refs.toast.classList.remove("is-visible"), 3200);
}

function selectStudent(id) {
  if (!state.students.some((student) => student.id === id)) return;

  state.selectedId = id;
  persistState();
  renderStudentTable();
  renderRecordForm();
  refs.recordCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function saveCurrentRecord() {
  const student = getStudentById();
  if (!student) return;

  student.memorization = refs.memorizationInput.value.trim();
  student.memorizationPages = Math.min(20, Math.max(0, Number(refs.memorizationPagesInput.value) || 0));
  student.review = refs.reviewInput.value.trim();
  student.reinforcement = refs.reinforcementInput.value.trim();
  student.recitation = Number(refs.recitationInput.value);
  student.tafsirRead = refs.tafsirInput.checked;
  student.notes = refs.notesInput.value.trim();

  persistState();
  renderAll();
  showToast(`تم حفظ سجل ${student.name} بنجاح.`);
}

function setAttendance(attendance) {
  const student = getStudentById();
  if (!student || !attendanceMeta[attendance]) return;

  student.attendance = attendance;
  persistState();
  renderAll();
  showToast(`تم تسجيل ${student.name} ${attendanceMeta[attendance].label}.`);
}

function getViewLabel(view) {
  return {
    overview: "لوحة اليوم",
    attendance: "الحضور",
    reports: "التقارير",
    students: "الطلاب",
  }[view] || "لوحة اليوم";
}

function setActiveView(view, shouldScroll = true) {
  const isReport = view === "reports";
  document.querySelectorAll("[data-view-section]").forEach((section) => {
    section.classList.toggle("active", section.dataset.viewSection === (isReport ? "reports" : "overview"));
  });
  document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === view);
  });
  refs.breadcrumbCurrent.textContent = getViewLabel(view);

  if (!isReport && shouldScroll && (view === "attendance" || view === "students")) {
    const target = view === "students" ? refs.studentSearch : refs.attendanceWorkspace;
    window.setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "start" }), 10);
  }

  if (isReport && shouldScroll) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  document.body.classList.remove("sidebar-open");
}

function addStudent(event) {
  event.preventDefault();
  const name = refs.newStudentName.value.trim();
  if (!name) {
    refs.newStudentName.focus();
    return;
  }

  const student = {
    id: `student-${Date.now()}`,
    name,
    level: refs.newStudentLevel.value,
    attendance: "present",
    memorization: "",
    memorizationPages: 0,
    recitation: 4,
    review: "",
    reinforcement: "",
    tafsirRead: false,
    notes: "",
    avatarColor: "#e8f3ed",
    avatarText: "#1e7453",
  };

  state.students.push(student);
  state.selectedId = student.id;
  state.search = "";
  state.filter = "all";
  refs.studentSearch.value = "";
  persistState();
  renderAll();
  refs.addStudentDialog.close();
  refs.addStudentForm.reset();
  setActiveView("students");
  showToast(`تمت إضافة ${student.name} إلى حلقة الفجر.`);
}

function initApp() {
  state = loadState();
  refs = {
    todayDate: document.querySelector("#todayDate"),
    breadcrumbCurrent: document.querySelector("#breadcrumbCurrent"),
    presentValue: document.querySelector("#presentValue"),
    memorizationValue: document.querySelector("#memorizationValue"),
    recitationValue: document.querySelector("#recitationValue"),
    tafsirValue: document.querySelector("#tafsirValue"),
    tafsirNote: document.querySelector("#tafsirNote"),
    attendanceProgress: document.querySelector("#attendanceProgress"),
    todayChartBar: document.querySelector("#todayChartBar"),
    chartCaption: document.querySelector("#chartCaption"),
    allCount: document.querySelector("#allCount"),
    presentCount: document.querySelector("#presentCount"),
    lateCount: document.querySelector("#lateCount"),
    absentCount: document.querySelector("#absentCount"),
    followupCount: document.querySelector("#followupCount"),
    followupList: document.querySelector("#followupList"),
    studentSearch: document.querySelector("#studentSearch"),
    filterRow: document.querySelector("#filterRow"),
    studentsTable: document.querySelector("#studentsTable"),
    emptyStudents: document.querySelector("#emptyStudents"),
    recordCard: document.querySelector("#recordCard"),
    recordForm: document.querySelector("#recordForm"),
    selectedStudentSummary: document.querySelector("#selectedStudentSummary"),
    attendanceChoices: document.querySelector("#attendanceChoices"),
    memorizationInput: document.querySelector("#memorizationInput"),
    memorizationPagesInput: document.querySelector("#memorizationPagesInput"),
    reviewInput: document.querySelector("#reviewInput"),
    reinforcementInput: document.querySelector("#reinforcementInput"),
    recitationInput: document.querySelector("#recitationInput"),
    recitationOutput: document.querySelector("#recitationOutput"),
    tafsirInput: document.querySelector("#tafsirInput"),
    notesInput: document.querySelector("#notesInput"),
    reportAttendanceRate: document.querySelector("#reportAttendanceRate"),
    reportDonut: document.querySelector("#reportDonut"),
    reportTafsirRate: document.querySelector("#reportTafsirRate"),
    tafsirSegments: document.querySelector("#tafsirSegments"),
    reportStudentList: document.querySelector("#reportStudentList"),
    attendanceWorkspace: document.querySelector("#attendanceWorkspace"),
    toast: document.querySelector("#toast"),
    addStudentDialog: document.querySelector("#addStudentDialog"),
    addStudentForm: document.querySelector("#addStudentForm"),
    newStudentName: document.querySelector("#newStudentName"),
    newStudentLevel: document.querySelector("#newStudentLevel"),
  };

  refs.studentSearch.addEventListener("input", (event) => {
    state.search = event.target.value;
    renderStudentTable();
  });

  refs.filterRow.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    state.filter = button.dataset.filter;
    refs.filterRow.querySelectorAll("[data-filter]").forEach((chip) => {
      chip.classList.toggle("active", chip === button);
    });
    renderStudentTable();
  });

  refs.studentsTable.addEventListener("click", (event) => {
    const button = event.target.closest("[data-student-id]");
    if (button) selectStudent(button.dataset.studentId);
  });

  refs.attendanceChoices.addEventListener("click", (event) => {
    const button = event.target.closest("[data-attendance]");
    if (button) setAttendance(button.dataset.attendance);
  });

  refs.recordForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveCurrentRecord();
  });

  refs.recitationInput.addEventListener("input", updateRangeUI);

  document.querySelector("#saveAllButton").addEventListener("click", () => {
    persistState();
    showToast("تم حفظ جميع تحديثات جلسة اليوم.");
  });

  document.querySelector("#filterButton").addEventListener("click", () => {
    refs.filterRow.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
    refs.filterRow.querySelector(".filter-chip.active").focus();
  });

  document.querySelector("#jumpToToday").addEventListener("click", () => {
    setActiveView("overview", false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  document.querySelectorAll("[data-view], [data-view-trigger]").forEach((button) => {
    button.addEventListener("click", () => setActiveView(button.dataset.view || button.dataset.viewTrigger));
  });

  document.querySelector("#sidebarToggle").addEventListener("click", () => document.body.classList.add("sidebar-open"));
  document.querySelector("#sidebarClose").addEventListener("click", () => document.body.classList.remove("sidebar-open"));
  document.querySelector("#sidebarOverlay").addEventListener("click", () => document.body.classList.remove("sidebar-open"));

  document.querySelector("#addStudentButton").addEventListener("click", () => refs.addStudentDialog.showModal());
  document.querySelector("#cancelAddStudent").addEventListener("click", () => refs.addStudentDialog.close());
  refs.addStudentForm.addEventListener("submit", addStudent);

  renderAll();
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", initApp);
}
