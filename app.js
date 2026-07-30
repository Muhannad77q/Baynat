const STORAGE_KEY = "bayanat-portal-v2";
const AUTH_KEY = "bayanat-auth-v2";
const THEME_KEY = "bayanat-theme-v2";

export const roleMeta = {
  teacher: { label: "معلّم الحلقة", shortLabel: "معلّم", avatar: "ع", color: "#e8f3ed", ink: "#187052" },
  parent: { label: "ولي الأمر", shortLabel: "ولي أمر", avatar: "و", color: "#fbf0e0", ink: "#bc7a32" },
  student: { label: "طالب الحلقة", shortLabel: "طالب", avatar: "ط", color: "#e9f2f8", ink: "#467da9" },
  supervisor: { label: "مشرف المنصة", shortLabel: "مشرف", avatar: "م", color: "#eeecf9", ink: "#7061ab" },
};

export const demoAccounts = [
  {
    id: "teacher-abdulrahman",
    role: "teacher",
    name: "عبد الرحمن العتيبي",
    username: "teacher",
    password: "123456",
    subtitle: "معلّم حلقة الفجر",
    avatarColor: "#e8f3ed",
    avatarText: "#187052",
  },
  {
    id: "parent-khaled",
    role: "parent",
    name: "خالد الشمري",
    username: "parent",
    password: "123456",
    subtitle: "ولي أمر عبدالله",
    childId: "abdullah-alshammari",
    avatarColor: "#fbf0e0",
    avatarText: "#bc7a32",
  },
  {
    id: "student-abdullah",
    role: "student",
    name: "عبدالله الشمري",
    username: "student",
    password: "123456",
    subtitle: "طالب · المستوى المتوسط",
    childId: "abdullah-alshammari",
    avatarColor: "#e9f2f8",
    avatarText: "#467da9",
  },
  {
    id: "supervisor-sarah",
    role: "supervisor",
    name: "سارة القحطاني",
    username: "supervisor",
    password: "123456",
    subtitle: "مشرفة برامج الحلقات",
    avatarColor: "#eeecf9",
    avatarText: "#7061ab",
  },
];

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
    avatarText: "#187052",
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

export const initialStaff = [
  {
    id: "supervisor-sarah",
    name: "سارة القحطاني",
    role: "supervisor",
    subtitle: "مشرفة برامج الحلقات",
    username: "supervisor",
    avatarColor: "#eeecf9",
    avatarText: "#7061ab",
  },
  {
    id: "teacher-abdulrahman",
    name: "عبد الرحمن العتيبي",
    role: "teacher",
    subtitle: "معلّم حلقة الفجر",
    username: "teacher",
    avatarColor: "#e8f3ed",
    avatarText: "#187052",
  },
  {
    id: "teacher-mohammed",
    name: "محمد الزهراني",
    role: "teacher",
    subtitle: "معلّم حلقة العصر",
    username: "mohammed",
    avatarColor: "#e9f2f8",
    avatarText: "#467da9",
  },
];

export const initialTasks = [
  {
    id: "abdullah-listen-naba",
    studentId: "abdullah-alshammari",
    type: "listen",
    title: "تسميع سورة النبأ ١–١٢",
    detail: "غدًا قبل بداية الحلقة · تسميع فردي",
    complete: false,
  },
  {
    id: "abdullah-review-amma",
    studentId: "abdullah-alshammari",
    type: "review",
    title: "مراجعة جزء عمّ",
    detail: "ثلاث مرات بهدوء مع ضبط الوقف",
    complete: true,
  },
  {
    id: "abdullah-tafsir-naba",
    studentId: "abdullah-alshammari",
    type: "tafsir",
    title: "قراءة التفسير المختصر",
    detail: "آيات الحفظ الجديدة · ٨ دقائق",
    complete: false,
  },
  {
    id: "abdullah-audio",
    studentId: "abdullah-alshammari",
    type: "listen",
    title: "استمع لتلاوة الشيخ المعلّم",
    detail: "المقطع الصوتي: سورة النبأ",
    complete: false,
  },
];

export const logoOptions = [
  { id: "gate", name: "بوابة البيان", detail: "قوس الحِلَق" },
  { id: "quran", name: "صفحات النور", detail: "مصحف مبسّط" },
  { id: "beads", name: "مدار التلاوة", detail: "حلقة تسبيح" },
  { id: "starbook", name: "نجم المعرفة", detail: "كتاب ونجم" },
  { id: "nodes", name: "صلة", detail: "تعلم مترابط" },
  { id: "arabesque", name: "أثر", detail: "هندسة إسلامية" },
  { id: "crescent", name: "علامة ورد", detail: "هلال وفاصل" },
  { id: "steps", name: "نماء", detail: "درجات التقدم" },
  { id: "circle", name: "حلقة", detail: "معلّم وطلاب" },
  { id: "dome", name: "سَكِينة", detail: "قبة هادئة" },
];

const attendanceMeta = {
  present: { label: "حاضر", className: "present" },
  late: { label: "متأخر", className: "late" },
  absent: { label: "غائب", className: "absent" },
};

let refs = {};
let state = createInitialState();
let activeUser = null;
let selectedAuthRole = "teacher";
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

export function authenticateDemoAccount(username, password, role) {
  const normalizedUsername = normalizeArabic(username);
  return (
    demoAccounts.find(
      (account) =>
        normalizeArabic(account.username) === normalizedUsername &&
        account.password === password &&
        account.role === role
    ) || null
  );
}

export function filterStudents(students, query = "", attendance = "all") {
  const normalizedQuery = normalizeArabic(query);
  return students.filter((student) => {
    const matchesName = !normalizedQuery || normalizeArabic(student.name).includes(normalizedQuery);
    const matchesAttendance = attendance === "all" || student.attendance === attendance;
    return matchesName && matchesAttendance;
  });
}

export function calculateSessionSummary(students) {
  const total = students.length;
  const present = students.filter((student) => student.attendance === "present").length;
  const late = students.filter((student) => student.attendance === "late").length;
  const absent = students.filter((student) => student.attendance === "absent").length;
  const activeStudents = students.filter((student) => student.attendance !== "absent" && Number(student.recitation) > 0);
  const memorizationPages = students.reduce((pages, student) => pages + Number(student.memorizationPages || 0), 0);
  const recitationAverage =
    activeStudents.length === 0
      ? 0
      : Number(
          (activeStudents.reduce((score, student) => score + Number(student.recitation || 0), 0) / activeStudents.length).toFixed(1)
        );
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

export function calculateTaskProgress(tasks) {
  if (!tasks.length) return { total: 0, complete: 0, percentage: 0 };
  const complete = tasks.filter((task) => task.complete).length;
  return {
    total: tasks.length,
    complete,
    percentage: Math.round((complete / tasks.length) * 100),
  };
}

export function getRoleNavigation(role) {
  const navigation = {
    teacher: [
      { id: "overview", label: "لوحة اليوم", icon: "grid" },
      { id: "attendance", label: "الحضور والتسميع", icon: "calendar" },
      { id: "reports", label: "تقارير الحلقة", icon: "chart" },
      { id: "brand", label: "هوية بينات", icon: "sparkle" },
    ],
    parent: [
      { id: "overview", label: "متابعة ابني", icon: "heart" },
      { id: "progress", label: "سجل التقدم", icon: "chart" },
      { id: "tasks", label: "واجبات الأسبوع", icon: "check" },
      { id: "brand", label: "هوية بينات", icon: "sparkle" },
    ],
    student: [
      { id: "overview", label: "رحلتي اليوم", icon: "sparkle" },
      { id: "plan", label: "خطة التسميع", icon: "book" },
      { id: "progress", label: "إنجازاتي", icon: "chart" },
      { id: "brand", label: "هوية بينات", icon: "palette" },
    ],
    supervisor: [
      { id: "overview", label: "ملخص المنصة", icon: "grid" },
      { id: "management", label: "إدارة الأعضاء", icon: "users" },
      { id: "reports", label: "تقارير مركزية", icon: "chart" },
      { id: "brand", label: "هوية بينات", icon: "sparkle" },
    ],
  };

  return navigation[role] || navigation.teacher;
}

export function createInitialState() {
  return {
    students: initialStudents.map((student) => ({ ...student })),
    staff: initialStaff.map((member) => ({ ...member })),
    tasks: initialTasks.map((task) => ({ ...task })),
    selectedStudentId: initialStudents[0].id,
    search: "",
    attendanceFilter: "all",
    currentView: "overview",
    brandId: "gate",
  };
}

export function createManagedPerson(kind, { name, subtitle, username }, seed = Date.now()) {
  if (kind === "student") {
    const alternatePalette = Number(seed) % 2 === 0;
    return {
      id: `student-${seed}`,
      name,
      level: subtitle,
      attendance: "present",
      memorization: "",
      memorizationPages: 0,
      recitation: 4,
      review: "",
      reinforcement: "",
      tafsirRead: false,
      notes: "",
      avatarColor: alternatePalette ? "#e8f3ed" : "#e9f2f8",
      avatarText: alternatePalette ? "#187052" : "#467da9",
    };
  }

  const role = kind === "supervisor" ? "supervisor" : "teacher";
  return {
    id: `${role}-${seed}`,
    name,
    role,
    subtitle,
    username,
    avatarColor: role === "supervisor" ? "#eeecf9" : "#e8f3ed",
    avatarText: role === "supervisor" ? "#7061ab" : "#187052",
  };
}

function loadState() {
  if (typeof window === "undefined") return createInitialState();

  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved || !Array.isArray(saved.students) || !Array.isArray(saved.staff) || !Array.isArray(saved.tasks)) {
      return createInitialState();
    }

    const initial = createInitialState();
    return {
      ...initial,
      ...saved,
      selectedStudentId: saved.students.some((student) => student.id === saved.selectedStudentId)
        ? saved.selectedStudentId
        : saved.students[0].id,
      search: "",
      attendanceFilter: "all",
      currentView: "overview",
      brandId: logoOptions.some((logo) => logo.id === saved.brandId) ? saved.brandId : "gate",
    };
  } catch {
    return createInitialState();
  }
}

function persistState() {
  if (typeof window === "undefined") return;
  try {
    const { students, staff, tasks, selectedStudentId, brandId } = state;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ students, staff, tasks, selectedStudentId, brandId }));
  } catch {
    // The portal remains usable when browser storage is unavailable.
  }
}

function loadActiveUser() {
  if (typeof window === "undefined") return null;
  try {
    const saved = JSON.parse(window.localStorage.getItem(AUTH_KEY) || "null");
    if (!saved?.id) return null;
    return demoAccounts.find((account) => account.id === saved.id) || null;
  } catch {
    return null;
  }
}

function persistActiveUser() {
  if (typeof window === "undefined") return;
  if (!activeUser) {
    window.localStorage.removeItem(AUTH_KEY);
    return;
  }
  window.localStorage.setItem(AUTH_KEY, JSON.stringify({ id: activeUser.id }));
}

function formatNumber(value, options = {}) {
  return new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 1, ...options }).format(value);
}

function formatScore(score) {
  if (!score) return "—";
  return Number.isInteger(score) ? String(score) : Number(score).toFixed(1);
}

function givenName(name = "") {
  const parts = name.split(/\s+/);
  return parts[0] === "عبد" && parts[1] ? `${parts[0]} ${parts[1]}` : parts[0];
}

function getInitials(name = "") {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("");
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function avatarStyle(person) {
  return `style="--avatar-bg:${person.avatarColor || "#e8f3ed"};--avatar-ink:${person.avatarText || "#187052"}"`;
}

function avatarMarkup(person, className = "avatar") {
  return `<span class="${className}" ${avatarStyle(person)}>${escapeHtml(getInitials(person.name))}</span>`;
}

function getSelectedStudent() {
  return state.students.find((student) => student.id === state.selectedStudentId) || state.students[0];
}

function getLinkedStudent() {
  const childId = activeUser?.childId;
  return state.students.find((student) => student.id === childId) || getSelectedStudent();
}

function getStudentTasks(studentId) {
  return state.tasks.filter((task) => task.studentId === studentId);
}

function getFollowups() {
  const priority = { absent: 0, late: 1, present: 2 };
  return state.students
    .filter((student) => student.attendance === "absent" || student.attendance === "late" || !student.tafsirRead)
    .sort((first, second) => priority[first.attendance] - priority[second.attendance])
    .slice(0, 3);
}

function statusLabel(student) {
  if (student.attendance === "absent") return "غياب اليوم";
  if (student.attendance === "late") return "حضور متأخر";
  if (!student.tafsirRead) return "لم يقرأ التفسير";
  return "متابعة مطلوبة";
}

function icon(name) {
  const icons = {
    grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z" /></svg>',
    calendar:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3m10-3v3M4.5 9.5h15M6.8 5h10.4A2.3 2.3 0 0 1 19.5 7.3v10.9a2.3 2.3 0 0 1-2.3 2.3H6.8a2.3 2.3 0 0 1-2.3-2.3V7.3A2.3 2.3 0 0 1 6.8 5Z" /><path d="m8 14 2.2 2.1L16 10.7" /></svg>',
    chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V10m7 10V4m7 16v-7" /></svg>',
    sparkle:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3ZM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" /></svg>',
    heart:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 20.5-1.45-1.32C5.4 14.5 2 11.42 2 7.65 2 4.57 4.42 2.5 7.5 2.5c1.74 0 3.41.81 4.5 2.08A6.08 6.08 0 0 1 16.5 2.5C19.58 2.5 22 4.57 22 7.65c0 3.77-3.4 6.85-8.55 11.54L12 20.5Z" /></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7.2" /></svg>',
    book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16ZM4 5.5V21.5M8 7h8m-8 4h7" /></svg>',
    palette:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1.1a1.9 1.9 0 0 0 1.74-2.66l-.3-.67A1.9 1.9 0 0 1 16.27 15H18a3 3 0 0 0 3-3 9 9 0 0 0-9-9Z" /><circle cx="7.5" cy="11" r=".7" fill="currentColor" /><circle cx="10" cy="7.5" r=".7" fill="currentColor" /><circle cx="14.5" cy="7.5" r=".7" fill="currentColor" /></svg>',
    users:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20m14-9a3 3 0 1 0 0-6m3.1 9.1A4 4 0 0 1 22 17.5V20M9.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" /></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>',
    document:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 16.5h8M8 12h8M8 7.5h4M5.5 3.5h13A1.5 1.5 0 0 1 20 5v14a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19V5a1.5 1.5 0 0 1 1.5-1.5Z" /></svg>',
    bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9A6 6 0 0 0 6 9c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>',
    message:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-8 7.48A8.8 8.8 0 0 1 7.4 17.6L4 19l1.3-3.4A7.4 7.4 0 0 1 4 11.5 7.5 7.5 0 0 1 12 4a7.5 7.5 0 0 1 8 7.5Z" /></svg>',
  };
  return icons[name] || icons.grid;
}

function logoSvg(id) {
  const marks = {
    gate: '<path d="M5 23 16 7l11 16H5Z" /><path d="M10 22v-6a6 6 0 0 1 12 0v6M16 7v15" />',
    quran: '<path d="M5 8.5C8.7 7.1 12 7.7 16 10v13c-4-2.3-7.3-2.9-11-1.5v-13Z" /><path d="M27 8.5C23.3 7.1 20 7.7 16 10v13c4-2.3 7.3-2.9 11-1.5v-13Z" /><path d="M16 10v13" />',
    beads: '<circle cx="16" cy="16" r="9.5" /><circle cx="16" cy="5" r="2" /><circle cx="25.5" cy="10" r="2" /><circle cx="25.5" cy="22" r="2" /><circle cx="16" cy="27" r="2" /><circle cx="6.5" cy="22" r="2" /><path d="m16 11 1.6 3.2 3.4.5-2.5 2.4.6 3.4-3.1-1.6-3.1 1.6.6-3.4-2.5-2.4 3.4-.5L16 11Z" />',
    starbook: '<path d="M5 9.5c3.8-1.8 7.3-1.1 11 1.4v11.2c-3.7-2.5-7.2-3.2-11-1.4V9.5Zm22 0c-3.8-1.8-7.3-1.1-11 1.4v11.2c3.7-2.5 7.2-3.2 11-1.4V9.5Z" /><path d="m16 3 1.4 3.2L21 7.4l-2.7 2.2.8 3.5-3.1-1.8-3.1 1.8.8-3.5-2.7-2.2 3.6-1.2L16 3Z" />',
    nodes: '<circle cx="8" cy="8" r="3" /><circle cx="24" cy="8" r="3" /><circle cx="16" cy="24" r="3" /><path d="m10.5 9.7 3.9 11.1M21.5 9.7l-3.9 11.1M11 8h10" />',
    arabesque: '<path d="M16 3c2.2 4.1 5.4 5.2 10 4-1.2 4.7.1 7.7 4 10-3.9 2.3-5.2 5.3-4 10-4.6-1.2-7.8-.1-10 4-2.2-4.1-5.4-5.2-10-4 1.2-4.7-.1-7.7-4-10 3.9-2.3 5.2-5.3 4-10 4.6 1.2 7.8.1 10-4Z" /><circle cx="16" cy="17" r="3.2" />',
    crescent: '<path d="M23 6.4A11.2 11.2 0 1 0 26.5 25 10.8 10.8 0 0 1 23 6.4Z" /><path d="M8 25h15M12 22v3M18 20v5" />',
    steps: '<path d="M5 26V19h7v7H5Zm7 0V12h7v14h-7Zm7 0V6h7v20h-7Z" /><path d="m7 15 5-4 4 2 7-7" />',
    circle: '<circle cx="16" cy="16" r="12" /><circle cx="16" cy="11" r="3" /><path d="M10 22c.8-3 2.8-4.5 6-4.5s5.2 1.5 6 4.5M6 10l2-1m16 1-2-1" />',
    dome: '<path d="M5 26h22M8 26V16h16v10M10 16a6 6 0 0 1 12 0M16 4v4m-2-2h4" /><path d="M13 26v-5h6v5" />',
  };

  return `<svg viewBox="0 0 32 32" aria-hidden="true">${marks[id] || marks.gate}</svg>`;
}

function renderBrandMarks() {
  const markup = logoSvg(state.brandId);
  refs.authBrandMark.innerHTML = markup;
  refs.portalBrandMark.innerHTML = markup;
}

function renderShell() {
  renderBrandMarks();
  renderSessionUser();
  renderNavigation();
  renderHeader();
  renderMain();
}

function renderSessionUser() {
  refs.sessionUser.innerHTML = `
    ${avatarMarkup(activeUser)}
    <div class="session-user__copy">
      <strong>${escapeHtml(activeUser.name)}</strong>
      <span>${roleMeta[activeUser.role].label}</span>
    </div>
  `;
}

function renderNavigation() {
  const items = getRoleNavigation(activeUser.role);
  refs.mainNav.innerHTML = `
    <p class="nav-caption">مساحة المتابعة</p>
    ${items
      .map(
        (item) => `
          <button class="nav-button${state.currentView === item.id ? " is-active" : ""}" type="button" data-view="${item.id}">
            ${icon(item.icon)}
            <span>${item.label}</span>
            ${item.id === "tasks" && activeUser.role !== "teacher" ? `<b class="nav-button__count">${formatNumber(calculateTaskProgress(getStudentTasks(getLinkedStudent().id)).total)}</b>` : ""}
          </button>
        `
      )
      .join("")}
  `;
}

function renderHeader() {
  const item = getRoleNavigation(activeUser.role).find((entry) => entry.id === state.currentView);
  const label = item?.label || "لوحة اليوم";
  refs.breadcrumb.innerHTML = `<span>بينات</span>${icon("arrow")}<span>${label}</span>`;
  refs.roleBadge.innerHTML = `<i></i>${roleMeta[activeUser.role].shortLabel}`;
}

function renderMain() {
  const view = state.currentView;
  if (view === "brand") {
    refs.mainContent.innerHTML = renderBrandStudio();
    return;
  }

  const renderers = {
    teacher: () => (view === "reports" ? renderReportsPage("teacher") : renderTeacherPage(view)),
    parent: () => renderParentPage(view),
    student: () => renderStudentPage(view),
    supervisor: () => (view === "reports" ? renderReportsPage("supervisor") : renderSupervisorPage(view)),
  };
  refs.mainContent.innerHTML = renderers[activeUser.role]();
  hydrateRange();
}

function pageHeading(title, description, options = {}) {
  const actions = options.actions || "";
  const meta = options.meta || "حلقة الفجر";
  return `
    <section class="page-heading">
      <div>
        <div class="page-heading__meta"><span>${meta}</span><i></i><span>${formatToday()}</span></div>
        <h1>${title}</h1>
        <p>${description}</p>
      </div>
      <div class="page-heading__actions">${actions}</div>
    </section>
  `;
}

function formatToday() {
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
}

function renderTeacherPage(view) {
  const summary = calculateSessionSummary(state.students);
  const heading = pageHeading(
    view === "attendance" ? "الحضور والتسميع" : `أهلًا بك، شيخ ${givenName(activeUser.name)}`,
    view === "attendance" ? "حدّث حضور الطالب وإنجازه في جلسة اليوم." : "موجز هادئ لكل ما تحتاجه قبل بدء الحلقة.",
    {
      actions:
        view === "attendance"
          ? `<span class="today-chip"><i></i> جلسة اليوم</span>`
          : `<span class="today-chip"><i></i> ${formatNumber(summary.present)} طلاب حاضرون</span>`,
    }
  );

  const workspace = renderTeacherWorkspace();
  if (view === "attendance") {
    return `<div class="page">${heading}${workspace}</div>`;
  }

  return `
    <div class="page">
      ${heading}
      <section class="hero-grid">
        <article class="greeting-card">
          <div class="greeting-card__content">
            <div class="greeting-card__person">
              ${avatarMarkup(activeUser)}
              <div><b>حلقة الفجر</b><span>مسجد الهدى · المستوى المتوسط</span></div>
            </div>
            <h2>جلسة متوازنة تبدأ بمتابعة واعية.</h2>
            <p>${formatNumber(summary.present)} طلاب حاضرون الآن، و${formatNumber(summary.tafsirRead)} أتموا قراءة التفسير المختصر.</p>
          </div>
        </article>
        <article class="session-pulse">
          <div class="session-pulse__ring" style="--progress:${summary.attendanceRate}%"><b>${formatNumber(summary.attendanceRate)}٪</b><span>الحضور</span></div>
          <p>اتساق الحلقة هذا الأسبوع</p>
        </article>
      </section>
      ${renderMetricCards(summary)}
      <section class="analytics-grid">
        ${renderWeekCard(summary)}
        ${renderFollowupCard()}
      </section>
      ${workspace}
    </div>
  `;
}

function renderMetricCards(summary) {
  return `
    <section class="metrics-grid" aria-label="ملخص جلسة اليوم">
      <article class="metric-card">
        <div class="metric-card__top"><span class="metric-icon">${icon("users")}</span><span class="metric-tag">الحصة الآن</span></div>
        <strong>${formatNumber(summary.present)} <small>/ ${formatNumber(summary.total)}</small></strong>
        <span>الطلاب الحاضرون</span>
        <div class="metric-track"><i style="--value:${summary.attendanceRate}%"></i></div>
      </article>
      <article class="metric-card">
        <div class="metric-card__top"><span class="metric-icon metric-icon--gold">⌁</span><span class="metric-tag">ورد اليوم</span></div>
        <strong>${formatNumber(summary.memorizationPages)} <small>وجهًا</small></strong>
        <span>مقدار الحفظ اليوم</span>
        <p>تقدّم هادئ ومستمر في الحلقة.</p>
      </article>
      <article class="metric-card">
        <div class="metric-card__top"><span class="metric-icon metric-icon--blue">${icon("document")}</span><span class="metric-tag">متوسط الحلقة</span></div>
        <strong>${formatScore(summary.recitationAverage)} <small>/ 5</small></strong>
        <span>تقييم التلاوة</span>
        <p>ضبط أفضل في المدود ومخارج الحروف.</p>
      </article>
      <article class="metric-card">
        <div class="metric-card__top"><span class="metric-icon metric-icon--purple">ت</span><span class="metric-tag">متابعة</span></div>
        <strong>${formatNumber(summary.tafsirRead)} <small>طلاب</small></strong>
        <span>قرأوا التفسير المختصر</span>
        <p>${formatNumber(summary.total - summary.tafsirRead)} طلاب بانتظار القراءة.</p>
      </article>
    </section>
  `;
}

function renderWeekCard(summary) {
  const weeks = [
    ["س", 66],
    ["ح", 82],
    ["ن", 74],
    ["ث", 92],
    ["ر", 78],
    ["خ", summary.attendanceRate, true],
    ["ج", 16],
  ];
  return `
    <article class="card weekly-card">
      <div class="card-head">
        <div><span class="section-kicker">نبض الحلقة</span><h2>حضور هذا الأسبوع</h2></div>
        <button class="text-link" type="button" data-view="reports">التقرير الكامل</button>
      </div>
      <div class="week-chart">
        ${weeks
          .map(
            ([label, height, today]) =>
              `<div class="week-chart__bar${today ? " is-today" : ""}"><i style="height:${height}%"></i><span>${label}</span></div>`
          )
          .join("")}
      </div>
      <div class="chart-footer"><span><i></i> نسبة الحضور</span><b>${formatNumber(summary.attendanceRate)}٪ في جلسة اليوم</b></div>
    </article>
  `;
}

function renderFollowupCard() {
  const followups = getFollowups();
  return `
    <article class="card followup-card">
      <div class="card-head">
        <div><span class="section-kicker">رعاية مركزة</span><h2>يحتاجون إلى متابعة</h2></div>
        <span class="metric-tag">${formatNumber(followups.length)}</span>
      </div>
      <div class="followup-list">
        ${followups
          .map(
            (student) => `
              <div class="followup-item">
                <span class="followup-item__avatar" ${avatarStyle(student)}>${escapeHtml(getInitials(student.name))}</span>
                <div class="followup-item__copy"><b>${escapeHtml(student.name)}</b><span>${escapeHtml(student.reinforcement || "سجّل ملاحظة المتابعة")}</span></div>
                <span class="followup-status">${statusLabel(student)}</span>
              </div>
            `
          )
          .join("")}
      </div>
      <button class="soft-action" type="button" data-view="attendance">فتح سجل الحضور ${icon("arrow")}</button>
    </article>
  `;
}

function renderTeacherWorkspace() {
  const selected = getSelectedStudent();
  const summary = calculateSessionSummary(state.students);
  return `
    <section class="teacher-workspace" id="teacherWorkspace">
      <article class="card student-table-card">
        <div class="card-head">
          <div><span class="section-kicker">جلسة اليوم</span><h2>سجل طلاب الحلقة</h2><p>اختر الطالب لتحديث حضوره وإنجازه.</p></div>
          <div class="student-table-actions">
            <label class="search-box">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.2" /><path d="m16 16 4.1 4.1" /></svg>
              <input id="studentSearch" type="search" value="${escapeHtml(state.search)}" placeholder="ابحث باسم الطالب" autocomplete="off" />
            </label>
          </div>
        </div>
        <div class="filter-tabs">
          ${filterTab("all", "الكل", summary.total)}
          ${filterTab("present", "حاضر", summary.present)}
          ${filterTab("late", "متأخر", summary.late)}
          ${filterTab("absent", "غائب", summary.absent)}
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>الطالب</th><th>الحضور</th><th>الحفظ الجديد</th><th>التلاوة</th><th aria-label="تحديث الطالب"></th></tr></thead>
            <tbody id="studentsTable">${renderStudentRows()}</tbody>
          </table>
          <div class="empty-table" id="studentEmpty" hidden><b>لا توجد نتائج مطابقة</b><span>جرّب اسمًا آخر أو أزل التصفية.</span></div>
        </div>
      </article>
      ${renderRecordCard(selected)}
    </section>
  `;
}

function filterTab(id, label, count) {
  return `<button class="filter-tab${state.attendanceFilter === id ? " is-active" : ""}" type="button" data-filter="${id}">${label} <b>${formatNumber(count)}</b></button>`;
}

function renderStudentRows() {
  const students = filterStudents(state.students, state.search, state.attendanceFilter);
  return students
    .map((student) => {
      const attendance = attendanceMeta[student.attendance];
      return `
        <tr class="${student.id === state.selectedStudentId ? "is-selected" : ""}">
          <td>
            <div class="table-student">
              ${avatarMarkup(student)}
              <div class="table-student__copy"><b>${escapeHtml(student.name)}</b><small>${escapeHtml(student.level)}</small></div>
            </div>
          </td>
          <td><span class="status-pill status-pill--${attendance.className}">${attendance.label}</span></td>
          <td>${escapeHtml(student.memorization || "لم يُسجّل")}</td>
          <td><span class="rating">${formatScore(student.recitation)}${student.recitation ? "<i></i>" : ""}</span></td>
          <td><button class="table-action" type="button" data-action="select-student" data-id="${student.id}" aria-label="تحديث سجل ${escapeHtml(student.name)}">${icon("arrow")}</button></td>
        </tr>
      `;
    })
    .join("");
}

function renderRecordCard(student) {
  const attendanceButtons = ["present", "late", "absent"]
    .map(
      (status) =>
        `<button class="${student.attendance === status ? `is-${status}` : ""}" type="button" data-action="set-attendance" data-attendance="${status}">${attendanceMeta[status].label}</button>`
    )
    .join("");
  const rangePercent = Math.round(((Number(student.recitation || 1) - 1) / 4) * 100);

  return `
    <aside class="card record-card" id="teacherRecord">
      <form id="teacherRecordForm">
        <div class="record-user">
          ${avatarMarkup(student)}
          <div class="record-user__copy"><b>${escapeHtml(student.name)}</b><span>${escapeHtml(student.level)} · سجل جلسة اليوم</span></div>
        </div>
        <div class="form-label-row"><label>حالة الحضور</label><span>تُحفظ تلقائيًا</span></div>
        <div class="attendance-selector">${attendanceButtons}</div>
        <div class="record-fields">
          <label class="compact-field"><span>مقدار الحفظ</span><input name="memorization" value="${escapeHtml(student.memorization || "")}" placeholder="النبأ ١–١٢" /></label>
          <label class="compact-field"><span>عدد الأوجه</span><input name="memorizationPages" type="number" min="0" max="20" step="0.5" value="${student.memorizationPages || 0}" /></label>
          <label class="compact-field compact-field--wide"><span>المراجعة</span><input name="review" value="${escapeHtml(student.review || "")}" placeholder="جزء عمّ" /></label>
          <label class="compact-field compact-field--wide"><span>التثبيت</span><input name="reinforcement" value="${escapeHtml(student.reinforcement || "")}" placeholder="مواضع تحتاج ضبطًا" /></label>
        </div>
        <div class="form-label-row"><label for="recitationInput">تقييم التلاوة</label><span id="recitationOutput">${formatScore(student.recitation)} / 5</span></div>
        <div class="range-row">
          <small>ضعيف</small>
          <input id="recitationInput" name="recitation" type="range" min="1" max="5" step="0.5" value="${student.recitation || 1}" style="--range:${rangePercent}%" />
          <small>متقن</small>
        </div>
        <label class="tafsir-toggle">
          <input name="tafsirRead" type="checkbox" ${student.tafsirRead ? "checked" : ""} />
          <span class="checkbox-mark">${icon("check")}</span>
          <span class="tafsir-toggle__copy"><b>قرأ التفسير المختصر</b><span>قراءة آيات الحفظ الجديدة</span></span>
        </label>
        <label class="compact-field" style="margin-top:13px"><span>ملاحظة المعلّم</span><textarea name="notes" placeholder="دوّن ملاحظة مفيدة للمتابعة…">${escapeHtml(student.notes || "")}</textarea></label>
        <button class="primary-action" type="submit">حفظ سجل الطالب ${icon("check")}</button>
      </form>
    </aside>
  `;
}

function renderParentPage(view) {
  const child = getLinkedStudent();
  const childTasks = getStudentTasks(child.id);
  const taskProgress = calculateTaskProgress(childTasks);
  if (view === "tasks") return renderTaskCenter(child, childTasks, "واجبات عبدالله هذا الأسبوع", "كل مهمة مكتملة تقرّبه من تسميع أكثر ثقة.");
  if (view === "progress") return renderParentProgress(child, childTasks);

  return `
    <div class="page">
      ${pageHeading(`أهلًا بك، ${givenName(activeUser.name)}`, "تتابع رحلة عبدالله من الحفظ حتى التثبيت.", {
        actions: `<button class="secondary-action" type="button" data-toast="تم إرسال رسالة تشجيع لعبدالله.">${icon("message")} رسالة تشجيع</button>`,
      })}
      ${renderChildHero(child, taskProgress, "عبدالله يقترب من إتمام ورد هذا الأسبوع.")}
      <section class="role-layout">
        <article class="card child-hero">
          <div class="card-head"><div><span class="section-kicker">ملف عبدالله</span><h2>تقدّم مطمئن وواضح</h2></div><span class="status-pill status-pill--${attendanceMeta[child.attendance].className}">${attendanceMeta[child.attendance].label}</span></div>
          ${renderChildProgressLines(child, taskProgress)}
          <button class="soft-action" type="button" data-view="progress">عرض سجل التقدم ${icon("arrow")}</button>
        </article>
        <article class="card assignments-card">
          <div class="card-head"><div><span class="section-kicker">في المنزل</span><h2>خطة هذا اليوم</h2></div><span class="metric-tag">${formatNumber(taskProgress.complete)}/${formatNumber(taskProgress.total)}</span></div>
          <div class="task-list">${renderTaskItems(childTasks, false)}</div>
          <button class="soft-action" type="button" data-view="tasks">متابعة الواجبات ${icon("arrow")}</button>
        </article>
      </section>
      <section class="analytics-grid">
        ${renderJourneyCard(child)}
        ${renderMessagesCard()}
      </section>
    </div>
  `;
}

function renderChildHero(child, taskProgress, message) {
  const levelProgress = Math.min(100, Math.round((child.memorizationPages / 3) * 100));
  return `
    <section class="card role-hero">
      <div class="role-hero__copy">
        <span class="section-kicker">رحلة الطالب</span>
        <h2>${escapeHtml(child.name)} يثبت اليوم ${escapeHtml(child.memorization || "وردًا جديدًا")}.</h2>
        <p>${message}</p>
      </div>
      <div class="role-hero__progress">
        <strong>${formatNumber(Math.max(taskProgress.percentage, levelProgress))}٪</strong><span>إنجاز ورد الأسبوع</span>
      </div>
    </section>
  `;
}

function renderChildProgressLines(child, taskProgress) {
  return `
    <div class="child-progress-list">
      <div class="progress-line"><span>الحضور</span><div class="progress-line__track"><i style="--value:${child.attendance === "present" ? 95 : child.attendance === "late" ? 70 : 35}%"></i></div><b>${child.attendance === "present" ? "ممتاز" : attendanceMeta[child.attendance].label}</b></div>
      <div class="progress-line"><span>التلاوة</span><div class="progress-line__track"><i style="--value:${(child.recitation / 5) * 100}%"></i></div><b>${formatScore(child.recitation)}/٥</b></div>
      <div class="progress-line"><span>الواجبات</span><div class="progress-line__track"><i style="--value:${taskProgress.percentage}%"></i></div><b>${formatNumber(taskProgress.percentage)}٪</b></div>
      <div class="progress-line"><span>التفسير</span><div class="progress-line__track"><i style="--value:${child.tafsirRead ? 100 : 35}%"></i></div><b>${child.tafsirRead ? "مقروء" : "بانتظار"}</b></div>
    </div>
  `;
}

function renderTaskCenter(student, tasks, title, description) {
  const progress = calculateTaskProgress(tasks);
  return `
    <div class="page">
      ${pageHeading(title, description, { actions: `<span class="today-chip"><i></i> ${formatNumber(progress.complete)}/${formatNumber(progress.total)} مكتمل</span>` })}
      ${renderChildHero(student, progress, "قسّم المهمة إلى دقائق صغيرة، ثم استمع إلى تلاوتك مرة واحدة قبل التسميع.")}
      <section class="role-layout">
        <article class="card assignments-card">
          <div class="card-head"><div><span class="section-kicker">قائمة التنفيذ</span><h2>ما يجب أن يُسمَّع</h2></div><span class="metric-tag">${formatNumber(progress.percentage)}٪</span></div>
          <div class="task-list">${renderTaskItems(tasks, activeUser.role === "student")}</div>
        </article>
        <article class="card journey-card">
          <div class="card-head"><div><span class="section-kicker">نصيحة المعلّم</span><h2>كيف تستعد للتسميع؟</h2></div></div>
          <div class="timeline-list">
            <div class="timeline-item"><div class="timeline-item__copy"><b>استمع بتركيز</b><span>مرّة واحدة مع متابعة المصحف</span></div><span class="timeline-item__date">٥ د</span></div>
            <div class="timeline-item"><div class="timeline-item__copy"><b>ردّد الآيات</b><span>ثلاث مرات مع ضبط المدود</span></div><span class="timeline-item__date">١٠ د</span></div>
            <div class="timeline-item timeline-item--next"><div class="timeline-item__copy"><b>اسمع بدون مصحف</b><span>سجّل مواضع التردد وارجع لها</span></div><span class="timeline-item__date">٥ د</span></div>
          </div>
        </article>
      </section>
    </div>
  `;
}

function taskTypeMeta(type) {
  return {
    listen: { label: "تسميع", className: "" },
    review: { label: "مراجعة", className: "task-type--review" },
    tafsir: { label: "تفسير", className: "task-type--tafsir" },
  }[type];
}

function renderTaskItems(tasks, actionable) {
  return tasks
    .map((task) => {
      const type = taskTypeMeta(task.type);
      return `
        <div class="task-item${task.complete ? " is-complete" : ""}">
          ${
            actionable
              ? `<button class="task-check${task.complete ? " is-complete" : ""}" type="button" data-action="toggle-task" data-id="${task.id}" aria-label="تبديل حالة ${escapeHtml(task.title)}">${icon("check")}</button>`
              : `<span class="task-check${task.complete ? " is-complete" : ""}">${icon("check")}</span>`
          }
          <div class="task-item__copy"><b>${escapeHtml(task.title)}</b><span>${escapeHtml(task.detail)}</span></div>
          <span class="task-type ${type.className}">${type.label}</span>
        </div>
      `;
    })
    .join("");
}

function renderParentProgress(child, tasks) {
  const taskProgress = calculateTaskProgress(tasks);
  return `
    <div class="page">
      ${pageHeading("سجل تقدم عبدالله", "تفاصيل قصيرة تساعدك على دعم ابنك دون إرهاقه.")}
      ${renderChildHero(child, taskProgress, "الاستمرارية اليومية أهم من طول الجلسة، وعبدالله يسير بصورة جميلة.")}
      <section class="role-layout">
        ${renderJourneyCard(child)}
        <article class="card child-hero">
          <div class="card-head"><div><span class="section-kicker">ملخص المعلّم</span><h2>ملاحظات هذا الأسبوع</h2></div></div>
          <div class="message-list">
            <div class="message-item"><span class="message-icon">${icon("document")}</span><div class="message-item__copy"><b>تحسّن في تلاوة المدود</b><span>واصلوا الاستماع للنموذج الصوتي قبل التسميع.</span></div><span class="message-time">اليوم</span></div>
            <div class="message-item"><span class="message-icon">${icon("heart")}</span><div class="message-item__copy"><b>مبادرة طيبة</b><span>أنجز مراجعة جزء عمّ من غير تذكير.</span></div><span class="message-time">أمس</span></div>
            <div class="message-item"><span class="message-icon">${icon("book")}</span><div class="message-item__copy"><b>التفسير المختصر</b><span>${child.tafsirRead ? "أتم القراءة وفهم المعنى العام." : "بانتظار قراءة آيات الحفظ الجديدة."}</span></div><span class="message-time">هذا الأسبوع</span></div>
          </div>
        </article>
      </section>
    </div>
  `;
}

function renderStudentPage(view) {
  const student = getLinkedStudent();
  const tasks = getStudentTasks(student.id);
  const taskProgress = calculateTaskProgress(tasks);
  if (view === "plan") return renderTaskCenter(student, tasks, "خطة التسميع", "رتّب وردك اليومي، وأكمل المهمة عند الانتهاء.");
  if (view === "progress") return renderStudentProgress(student, tasks);

  return `
    <div class="page">
      ${pageHeading(`أهلًا يا ${givenName(student.name)}`, "أنت قريب من تسميع جديد ومميّز.", {
        actions: `<span class="today-chip"><i></i> ${formatNumber(taskProgress.percentage)}٪ مكتمل</span>`,
      })}
      ${renderChildHero(student, taskProgress, "ابدأ بالمهمة الأصغر، ثم احتفل بإنجازك بعد كل تسميع.")}
      <section class="role-layout">
        <article class="card assignments-card">
          <div class="card-head"><div><span class="section-kicker">ورد اليوم</span><h2>ما عليك اليوم</h2><p>اضغط على المهمة عند إتمامها.</p></div><span class="metric-tag">${formatNumber(taskProgress.complete)}/${formatNumber(taskProgress.total)}</span></div>
          <div class="task-list">${renderTaskItems(tasks, true)}</div>
        </article>
        <article class="card journey-card">
          <div class="card-head"><div><span class="section-kicker">وجهتك التالية</span><h2>تسميع سورة النبأ</h2></div></div>
          <div class="timeline-list">
            <div class="timeline-item"><div class="timeline-item__copy"><b>تلاوة نموذجية</b><span>اسمع المقطع الصوتي أولًا</span></div><span class="timeline-item__date">مكتمل</span></div>
            <div class="timeline-item"><div class="timeline-item__copy"><b>الحفظ الجديد</b><span>${escapeHtml(student.memorization)}</span></div><span class="timeline-item__date">الآن</span></div>
            <div class="timeline-item timeline-item--next"><div class="timeline-item__copy"><b>تسميع للمعلّم</b><span>غدًا في بداية الحلقة</span></div><span class="timeline-item__date">قادم</span></div>
          </div>
        </article>
      </section>
    </div>
  `;
}

function renderStudentProgress(student, tasks) {
  const taskProgress = calculateTaskProgress(tasks);
  return `
    <div class="page">
      ${pageHeading("إنجازاتي", "تابع تقدمك بهدوء، فكل خطوة صغيرة تُبنى عليها خطوة أكبر.")}
      <section class="metrics-grid">
        <article class="metric-card"><div class="metric-card__top"><span class="metric-icon">✦</span><span class="metric-tag">ورد اليوم</span></div><strong>${formatNumber(student.memorizationPages)} <small>وجه</small></strong><span>محفوظ اليوم</span><p>${escapeHtml(student.memorization)}</p></article>
        <article class="metric-card"><div class="metric-card__top"><span class="metric-icon metric-icon--blue">${icon("document")}</span><span class="metric-tag">تقييم</span></div><strong>${formatScore(student.recitation)} <small>/ 5</small></strong><span>تلاوتي</span><p>استمر في ضبط المدود.</p></article>
        <article class="metric-card"><div class="metric-card__top"><span class="metric-icon metric-icon--gold">${icon("check")}</span><span class="metric-tag">إنجاز</span></div><strong>${formatNumber(taskProgress.complete)} <small>/ ${formatNumber(taskProgress.total)}</small></strong><span>واجبات مكتملة</span><p>اقترب من إتمام الخطة.</p></article>
        <article class="metric-card"><div class="metric-card__top"><span class="metric-icon metric-icon--purple">ت</span><span class="metric-tag">فهم</span></div><strong>${student.tafsirRead ? "✓" : "…"}</strong><span>التفسير المختصر</span><p>${student.tafsirRead ? "أتممت القراءة اليوم." : "خصّص له ٨ دقائق."}</p></article>
      </section>
      ${renderChildHero(student, taskProgress, "الطالب المتقن يعرف أين يتوقف، ثم يعود للمراجعة بثقة.")}
    </div>
  `;
}

function renderJourneyCard(student) {
  return `
    <article class="card journey-card">
      <div class="card-head"><div><span class="section-kicker">آخر التحديثات</span><h2>رحلة الحفظ</h2></div></div>
      <div class="timeline-list">
        <div class="timeline-item"><div class="timeline-item__copy"><b>حفظ جديد: ${escapeHtml(student.memorization || "لم يسجّل بعد")}</b><span>${formatNumber(student.memorizationPages || 0)} وجهًا · تقييم تلاوة ${formatScore(student.recitation)}/٥</span></div><span class="timeline-item__date">اليوم</span></div>
        <div class="timeline-item"><div class="timeline-item__copy"><b>مراجعة: ${escapeHtml(student.review || "جزء عمّ")}</b><span>${escapeHtml(student.reinforcement || "مع تثبيت المواضع المهمة")}</span></div><span class="timeline-item__date">أمس</span></div>
        <div class="timeline-item timeline-item--next"><div class="timeline-item__copy"><b>التسميع القادم</b><span>مراجعة هادئة ثم تسميع فردي للمعلّم.</span></div><span class="timeline-item__date">غدًا</span></div>
      </div>
    </article>
  `;
}

function renderMessagesCard() {
  return `
    <article class="card journey-card">
      <div class="card-head"><div><span class="section-kicker">تواصل مريح</span><h2>رسائل المعلّم</h2></div><button class="text-link" type="button" data-toast="تم فتح رسالة جديدة للمعلّم.">مراسلة</button></div>
      <div class="message-list">
        <div class="message-item"><span class="message-icon">${icon("heart")}</span><div class="message-item__copy"><b>أداء جميل اليوم</b><span>عبدالله متقن للحفظ الجديد، استمروا على نفس النسق.</span></div><span class="message-time">١٠:٣٠</span></div>
        <div class="message-item"><span class="message-icon">${icon("book")}</span><div class="message-item__copy"><b>تنبيه المراجعة</b><span>نوصي بمراجعة جزء عمّ قبل جلسة الغد.</span></div><span class="message-time">أمس</span></div>
      </div>
    </article>
  `;
}

function renderSupervisorPage(view) {
  const summary = calculateSessionSummary(state.students);
  if (view === "management") return renderManagementPage();
  return `
    <div class="page">
      ${pageHeading("ملخص المنصة", "نظرة مهنية على الحلقة وفريق العمل وأولويات اليوم.", {
        actions: `<button class="primary-action" type="button" data-action="open-person-dialog" data-kind="student">${icon("plus")} إضافة طالب</button>`,
      })}
      <section class="metrics-grid">
        <article class="metric-card"><div class="metric-card__top"><span class="metric-icon">${icon("users")}</span><span class="metric-tag">نشط الآن</span></div><strong>${formatNumber(summary.total)} <small>طلاب</small></strong><span>إجمالي طلاب حلقة الفجر</span><p>توزيع متوازن على المستوى المتوسط.</p></article>
        <article class="metric-card"><div class="metric-card__top"><span class="metric-icon metric-icon--purple">${icon("users")}</span><span class="metric-tag">فريق العمل</span></div><strong>${formatNumber(state.staff.length)} <small>أعضاء</small></strong><span>معلّمون ومشرفون</span><p>صلاحيات إدارة ومتابعة متكاملة.</p></article>
        <article class="metric-card"><div class="metric-card__top"><span class="metric-icon metric-icon--gold">⌁</span><span class="metric-tag">اليوم</span></div><strong>${formatNumber(summary.memorizationPages)} <small>وجهًا</small></strong><span>إجمالي الحفظ</span><p>مؤشر جيد لتقدم الجلسة.</p></article>
        <article class="metric-card"><div class="metric-card__top"><span class="metric-icon metric-icon--blue">${icon("chart")}</span><span class="metric-tag">انتظام</span></div><strong>${formatNumber(summary.attendanceRate)}<small>٪</small></strong><span>معدل الحضور</span><p>تحديث مباشر من سجل المعلّم.</p></article>
      </section>
      <section class="supervisor-hero">
        <article class="card operations-card">
          <span class="section-kicker">تشغيل اليوم</span><h2>الحلقة تسير بنبض هادئ.</h2><p>جميع سجلات اليوم جاهزة للمراجعة. ركّز على الغياب، والطلاب الذين لم يقرؤوا التفسير المختصر.</p>
          <div class="operations-card__stats"><span><b>${formatNumber(summary.absent)}</b><small>غياب</small></span><span><b>${formatNumber(summary.late)}</b><small>متأخر</small></span><span><b>${formatNumber(summary.total - summary.tafsirRead)}</b><small>تفسير بانتظار</small></span></div>
        </article>
        ${renderFollowupCard()}
      </section>
      <section class="supervisor-layout">
        ${renderManagementPreview()}
        ${renderPeoplePreview()}
      </section>
    </div>
  `;
}

function renderManagementPreview() {
  return `
    <article class="card management-card">
      <div class="card-head"><div><span class="section-kicker">صلاحيات وإدارة</span><h2>الأعضاء والطلاب</h2><p>إضافة وتحديث عناصر المنصة من مكان واحد.</p></div></div>
      <div class="management-card__actions">
        <button class="soft-action" type="button" data-action="open-person-dialog" data-kind="student">${icon("plus")} طالب</button>
        <button class="soft-action" type="button" data-action="open-person-dialog" data-kind="supervisor">${icon("plus")} مشرف</button>
      </div>
      <div class="person-list">
        ${state.staff
          .slice(0, 3)
          .map(
            (member) => `
              <div class="person-row">${avatarMarkup(member)}<div class="person-row__copy"><b>${escapeHtml(member.name)}</b><span>${escapeHtml(member.subtitle)}</span></div><span class="person-role">${roleMeta[member.role].shortLabel}</span></div>
            `
          )
          .join("")}
      </div>
      <button class="soft-action" type="button" style="width:100%;margin-top:12px" data-view="management">فتح إدارة المنصة ${icon("arrow")}</button>
    </article>
  `;
}

function renderPeoplePreview() {
  return `
    <article class="card people-card">
      <div class="card-head"><div><span class="section-kicker">أداء مختصر</span><h2>أعلى تقدم اليوم</h2></div></div>
      <div class="person-list">
        ${[...state.students]
          .sort((first, second) => Number(second.memorizationPages) - Number(first.memorizationPages))
          .slice(0, 4)
          .map(
            (student) => `
              <div class="person-row">${avatarMarkup(student)}<div class="person-row__copy"><b>${escapeHtml(student.name)}</b><span>${escapeHtml(student.memorization || "لم يسجّل بعد")}</span></div><span class="person-role">${formatNumber(student.memorizationPages)} وجه</span></div>
            `
          )
          .join("")}
      </div>
    </article>
  `;
}

function renderManagementPage() {
  return `
    <div class="page">
      ${pageHeading("إدارة الأعضاء", "أضف الطلاب والمشرفين، وراجع من يملك صلاحية الوصول.", {
        actions: `<button class="primary-action" type="button" data-action="open-person-dialog" data-kind="student">${icon("plus")} إضافة طالب</button>`,
      })}
      <section class="supervisor-layout">
        <article class="card management-card">
          <div class="card-head"><div><span class="section-kicker">الفريق</span><h2>المشرفون والمعلّمون</h2><p>لكل عضو دور واضح وصلاحية مناسبة.</p></div><button class="secondary-action" type="button" data-action="open-person-dialog" data-kind="supervisor">${icon("plus")} مشرف</button></div>
          <div class="person-list">
            ${state.staff
              .map(
                (member) => `
                  <div class="person-row">${avatarMarkup(member)}<div class="person-row__copy"><b>${escapeHtml(member.name)}</b><span>${escapeHtml(member.subtitle)} · @${escapeHtml(member.username)}</span></div><span class="person-role">${roleMeta[member.role].shortLabel}</span></div>
                `
              )
              .join("")}
          </div>
        </article>
        <article class="card people-card">
          <div class="card-head"><div><span class="section-kicker">صلاحيات</span><h2>ماذا يفعل كل دور؟</h2></div></div>
          <div class="message-list">
            <div class="message-item"><span class="message-icon">${icon("users")}</span><div class="message-item__copy"><b>المشرف</b><span>يضيف الطلاب والمشرفين، ويطّلع على التقارير.</span></div></div>
            <div class="message-item"><span class="message-icon">${icon("document")}</span><div class="message-item__copy"><b>المعلّم</b><span>يسجّل الحضور والحفظ والتلاوة والتفسير.</span></div></div>
            <div class="message-item"><span class="message-icon">${icon("heart")}</span><div class="message-item__copy"><b>ولي الأمر والطالب</b><span>يراجعان التقدم والواجبات دون تعديل السجل.</span></div></div>
          </div>
        </article>
      </section>
      <section class="card people-card" style="margin-top:14px;padding:18px 0 0;overflow:hidden">
        <div class="card-head" style="padding:0 18px"><div><span class="section-kicker">قاعدة الطلاب</span><h2>طلاب حلقة الفجر</h2></div><button class="secondary-action" type="button" data-action="open-person-dialog" data-kind="student">${icon("plus")} طالب جديد</button></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>الطالب</th><th>المستوى</th><th>الحضور</th><th>الحفظ اليوم</th></tr></thead>
            <tbody>
              ${state.students
                .map(
                  (student) => `
                    <tr><td><div class="table-student">${avatarMarkup(student)}<div class="table-student__copy"><b>${escapeHtml(student.name)}</b><small>@${escapeHtml(student.id.split("-")[0])}</small></div></div></td><td>${escapeHtml(student.level)}</td><td><span class="status-pill status-pill--${attendanceMeta[student.attendance].className}">${attendanceMeta[student.attendance].label}</span></td><td>${escapeHtml(student.memorization || "—")}</td></tr>
                  `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

function renderReportsPage(role) {
  const summary = calculateSessionSummary(state.students);
  const tafsirRate = summary.total ? Math.round((summary.tafsirRead / summary.total) * 100) : 0;
  const title = role === "supervisor" ? "التقارير المركزية" : "تقارير الحلقة";
  const description = role === "supervisor" ? "قراءة سريعة لمؤشرات الحلقة وفريق المتابعة." : "كل ما تحتاجه لمراجعة جلسة اليوم بهدوء.";
  return `
    <div class="page">
      ${pageHeading(title, description, { actions: `<span class="today-chip"><i></i> جلسة اليوم</span>` })}
      <section class="report-grid">
        <article class="card radial-summary">
          <span class="section-kicker">انتظام الحلقة</span>
          <div class="radial-progress" style="--progress:${summary.attendanceRate}%"><b>${formatNumber(summary.attendanceRate)}٪</b><span>الحضور</span></div>
          <p>نسبة الحضور مقارنة بعدد طلاب حلقة الفجر المسجلين.</p>
        </article>
        <article class="card reports-card">
          <div class="card-head"><div><span class="section-kicker">تقدم الطلاب</span><h2>مقدار الحفظ اليوم</h2></div><span class="metric-tag">${formatNumber(summary.memorizationPages)} وجهًا</span></div>
          <div class="student-report-list">
            ${[...state.students]
              .sort((first, second) => Number(second.memorizationPages) - Number(first.memorizationPages))
              .slice(0, 7)
              .map((student) => {
                const progress = Math.min(100, Math.round((Number(student.memorizationPages || 0) / 3) * 100));
                return `<div class="student-report-row"><div class="student-report-row__name">${avatarMarkup(student)}<b>${escapeHtml(student.name)}</b></div><span class="student-report-row__bar"><i style="--value:${progress}%"></i></span><small>${formatNumber(student.memorizationPages || 0)} وجه</small></div>`;
              })
              .join("")}
          </div>
        </article>
        <article class="card interpret-card">
          <div class="interpret-card__top"><span class="interpret-icon">ت</span><strong>${formatNumber(tafsirRate)}٪</strong></div>
          <h2>التفسير المختصر</h2>
          <div class="segment-progress">${Array.from({ length: Math.max(summary.total, 1) }, (_, index) => `<i class="${index < summary.tafsirRead ? "is-filled" : ""}"></i>`).join("")}</div>
          <p>${formatNumber(summary.tafsirRead)} طلاب أتموا القراءة خلال جلسة اليوم.</p>
        </article>
      </section>
    </div>
  `;
}

function renderBrandStudio() {
  return `
    <div class="page">
      ${pageHeading("هوية بينات", "اختر الرمز الذي يعبر عن الحلقات؛ التغيير يظهر فورًا في كامل المنصة.", {
        actions: `<span class="today-chip"><i></i> ${logoOptions.length} خيارات</span>`,
      })}
      <section class="logo-studio">
        <article class="card logo-studio-card">
          <div class="logo-studio-card__copy"><span class="section-kicker">استوديو الهوية</span><h2>عشرة اتجاهات لشعار بينات</h2><p>الخيارات تجمع بين هدوء التعلّم، روح الحلقات، والتقدم الشخصي. اختر واحدًا للتجربة مباشرة.</p></div>
          <div class="logo-gallery">
            ${logoOptions
              .map(
                (logo) => `
                  <button class="logo-choice${state.brandId === logo.id ? " is-selected" : ""}" type="button" data-action="select-logo" data-id="${logo.id}">
                    <span class="logo-choice__mark">${logoSvg(logo.id)}</span>
                    <b>${logo.name}</b><span>${logo.detail}</span>
                  </button>
                `
              )
              .join("")}
          </div>
        </article>
        <aside class="card inspiration-board">
          <img src="./assets/bayanat_logo_exploration.png" alt="لوحة استكشاف عشر اتجاهات لهوية بينات" />
          <div class="inspiration-board__copy"><span class="section-kicker">لوحة إلهام</span><h3>اتجاهات بصرية هادئة</h3><p>استكشف العلامات ثم اختر الشعار الأنسب من اللوحة التفاعلية.</p></div>
        </aside>
      </section>
    </div>
  `;
}

function hydrateRange() {
  const range = document.querySelector("#recitationInput");
  if (!range) return;
  const update = () => {
    const value = Number(range.value);
    range.style.setProperty("--range", `${Math.round(((value - 1) / 4) * 100)}%`);
    const output = document.querySelector("#recitationOutput");
    if (output) output.textContent = `${formatScore(value)} / 5`;
  };
  range.addEventListener("input", update);
  update();
}

function refreshTeacherTable() {
  const table = document.querySelector("#studentsTable");
  const empty = document.querySelector("#studentEmpty");
  if (!table || !empty) return;
  const students = filterStudents(state.students, state.search, state.attendanceFilter);
  table.innerHTML = renderStudentRows();
  empty.hidden = students.length > 0;
}

function showToast(message) {
  refs.toast.textContent = message;
  refs.toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => refs.toast.classList.remove("is-visible"), 5400);
}

function setView(view) {
  const permitted = getRoleNavigation(activeUser.role).some((item) => item.id === view);
  if (!permitted) return;
  state.currentView = view;
  renderNavigation();
  renderHeader();
  renderMain();
  window.scrollTo({ top: 0, behavior: "smooth" });
  document.body.classList.remove("side-open");
}

function selectStudent(id) {
  if (!state.students.some((student) => student.id === id)) return;
  state.selectedStudentId = id;
  persistState();
  renderMain();
  const record = document.querySelector("#teacherRecord");
  record?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function setAttendance(attendance) {
  const student = getSelectedStudent();
  if (!attendanceMeta[attendance]) return;
  student.attendance = attendance;
  persistState();
  renderMain();
  showToast(`تم تسجيل ${student.name} ${attendanceMeta[attendance].label}.`);
}

function saveTeacherRecord(form) {
  const student = getSelectedStudent();
  const values = new FormData(form);
  student.memorization = String(values.get("memorization") || "").trim();
  student.memorizationPages = Math.min(20, Math.max(0, Number(values.get("memorizationPages")) || 0));
  student.review = String(values.get("review") || "").trim();
  student.reinforcement = String(values.get("reinforcement") || "").trim();
  student.recitation = Number(values.get("recitation")) || 1;
  student.tafsirRead = values.get("tafsirRead") === "on";
  student.notes = String(values.get("notes") || "").trim();
  persistState();
  renderMain();
  showToast(`تم حفظ سجل ${student.name} بنجاح.`);
}

function toggleTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  task.complete = !task.complete;
  persistState();
  renderMain();
  showToast(task.complete ? "أحسنت، تم تسجيل المهمة كمكتملة." : "أعيدت المهمة إلى خطة اليوم.");
}

function openPersonDialog(kind) {
  const config = {
    student: { title: "إضافة طالب", kicker: "إدارة الطلاب", label: "المستوى", placeholder: "المستوى المتوسط" },
    supervisor: { title: "إضافة مشرف", kicker: "إدارة الفريق", label: "المسمى", placeholder: "مشرف برامج الحلقات" },
    teacher: { title: "إضافة معلّم", kicker: "إدارة الفريق", label: "المسمى", placeholder: "معلّم حلقة" },
  }[kind];
  if (!config) return;

  refs.personKindInput.value = kind;
  refs.personDialogTitle.textContent = config.title;
  refs.personDialogKicker.textContent = config.kicker;
  refs.personSubtitleLabel.textContent = config.label;
  refs.personSubtitleInput.placeholder = config.placeholder;
  refs.personForm.reset();
  refs.personKindInput.value = kind;
  refs.personDialog.showModal();
  refs.personNameInput.focus();
}

function addPerson(event) {
  event.preventDefault();
  const data = new FormData(refs.personForm);
  const kind = data.get("kind");
  const name = String(data.get("name") || "").trim();
  const subtitle = String(data.get("subtitle") || "").trim();
  const username = normalizeArabic(data.get("username")).replace(/\s+/g, "-");
  if (!name || !subtitle || !username) return;

  if (kind === "student") {
    state.students.push(createManagedPerson(kind, { name, subtitle, username }));
  } else {
    state.staff.push(createManagedPerson(kind, { name, subtitle, username }));
  }

  persistState();
  refs.personDialog.close();
  renderMain();
  showToast(kind === "student" ? `تمت إضافة ${name} إلى حلقة الفجر.` : `تمت إضافة ${name} إلى فريق العمل.`);
}

function applyTheme(theme) {
  document.body.classList.toggle("night-mode", theme === "night");
  refs.moodToggle.setAttribute("aria-pressed", String(theme === "night"));
  refs.moodLabel.textContent = theme === "night" ? "وضع نهاري" : "وضع ليلي";
}

function toggleTheme() {
  const next = document.body.classList.contains("night-mode") ? "day" : "night";
  window.localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

function enterPortal(account) {
  activeUser = account;
  state.currentView = "overview";
  persistActiveUser();
  refs.loginError.textContent = "";
  refs.authScreen.hidden = true;
  refs.portal.hidden = false;
  renderShell();
  window.scrollTo({ top: 0 });
}

function logout() {
  activeUser = null;
  persistActiveUser();
  document.body.classList.remove("side-open");
  refs.portal.hidden = true;
  refs.authScreen.hidden = false;
  refs.passwordInput.value = "";
  refs.loginError.textContent = "";
  refs.usernameInput.focus();
}

function handleLogin(event) {
  event.preventDefault();
  const account = authenticateDemoAccount(refs.usernameInput.value, refs.passwordInput.value, selectedAuthRole);
  if (!account) {
    refs.loginError.textContent = "تأكد من نوع الحساب، واسم المستخدم، وكلمة المرور التجريبية.";
    return;
  }
  enterPortal(account);
}

function selectAuthRole(role) {
  selectedAuthRole = role;
  const account = demoAccounts.find((item) => item.role === role);
  document.querySelectorAll("[data-auth-role]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.authRole === role);
  });
  refs.usernameInput.value = account.username;
  refs.passwordInput.value = "123456";
  refs.loginError.textContent = "";
}

function initApp() {
  state = loadState();
  refs = {
    authScreen: document.querySelector("#authScreen"),
    portal: document.querySelector("#portal"),
    authBrandMark: document.querySelector("#authBrandMark"),
    portalBrandMark: document.querySelector("#portalBrandMark"),
    loginForm: document.querySelector("#loginForm"),
    usernameInput: document.querySelector("#usernameInput"),
    passwordInput: document.querySelector("#passwordInput"),
    passwordToggle: document.querySelector("#passwordToggle"),
    loginError: document.querySelector("#loginError"),
    rolePicker: document.querySelector("#rolePicker"),
    demoLoginButton: document.querySelector("#demoLoginButton"),
    mainNav: document.querySelector("#mainNav"),
    sessionUser: document.querySelector("#sessionUser"),
    breadcrumb: document.querySelector("#breadcrumb"),
    roleBadge: document.querySelector("#roleBadge"),
    moodToggle: document.querySelector("#moodToggle"),
    moodLabel: document.querySelector("#moodLabel"),
    mainContent: document.querySelector("#mainContent"),
    toast: document.querySelector("#toast"),
    sideToggle: document.querySelector("#sideToggle"),
    sideClose: document.querySelector("#sideClose"),
    sideOverlay: document.querySelector("#sideOverlay"),
    logoutButton: document.querySelector("#logoutButton"),
    personDialog: document.querySelector("#personDialog"),
    personForm: document.querySelector("#personForm"),
    personKindInput: document.querySelector("#personKindInput"),
    personDialogTitle: document.querySelector("#personDialogTitle"),
    personDialogKicker: document.querySelector("#personDialogKicker"),
    personSubtitleLabel: document.querySelector("#personSubtitleLabel"),
    personSubtitleInput: document.querySelector("#personSubtitleInput"),
    personNameInput: document.querySelector("#personNameInput"),
  };

  applyTheme(window.localStorage.getItem(THEME_KEY) || "day");
  renderBrandMarks();

  refs.loginForm.addEventListener("submit", handleLogin);
  refs.rolePicker.addEventListener("click", (event) => {
    const button = event.target.closest("[data-auth-role]");
    if (button) selectAuthRole(button.dataset.authRole);
  });
  refs.demoLoginButton.addEventListener("click", () => {
    const account = demoAccounts.find((item) => item.role === selectedAuthRole);
    refs.usernameInput.value = account.username;
    refs.passwordInput.value = account.password;
    enterPortal(account);
  });
  refs.passwordToggle.addEventListener("click", () => {
    const isPassword = refs.passwordInput.type === "password";
    refs.passwordInput.type = isPassword ? "text" : "password";
    refs.passwordToggle.setAttribute("aria-label", isPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور");
  });

  refs.mainNav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (button) setView(button.dataset.view);
  });

  refs.mainContent.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
      setView(viewButton.dataset.view);
      return;
    }

    const action = event.target.closest("[data-action]");
    if (action) {
      const type = action.dataset.action;
      if (type === "select-student") selectStudent(action.dataset.id);
      if (type === "set-attendance") setAttendance(action.dataset.attendance);
      if (type === "toggle-task") toggleTask(action.dataset.id);
      if (type === "open-person-dialog") openPersonDialog(action.dataset.kind);
      if (type === "select-logo") {
        state.brandId = action.dataset.id;
        persistState();
        renderBrandMarks();
        renderMain();
        showToast(`تم اختيار شعار ${logoOptions.find((logo) => logo.id === state.brandId)?.name || "بينات"}.`);
      }
    }

    const toastButton = event.target.closest("[data-toast]");
    if (toastButton) showToast(toastButton.dataset.toast);
  });

  refs.mainContent.addEventListener("input", (event) => {
    if (event.target.id === "studentSearch") {
      state.search = event.target.value;
      refreshTeacherTable();
    }
  });

  refs.mainContent.addEventListener("click", (event) => {
    const filter = event.target.closest("[data-filter]");
    if (!filter) return;
    state.attendanceFilter = filter.dataset.filter;
    renderMain();
  });

  refs.mainContent.addEventListener("submit", (event) => {
    if (event.target.id === "teacherRecordForm") {
      event.preventDefault();
      saveTeacherRecord(event.target);
    }
  });

  refs.moodToggle.addEventListener("click", toggleTheme);
  refs.logoutButton.addEventListener("click", logout);
  refs.sideToggle.addEventListener("click", () => document.body.classList.add("side-open"));
  refs.sideClose.addEventListener("click", () => document.body.classList.remove("side-open"));
  refs.sideOverlay.addEventListener("click", () => document.body.classList.remove("side-open"));

  document.querySelectorAll("[data-toast]").forEach((button) => {
    if (!button.closest("#mainContent")) {
      button.addEventListener("click", () => showToast(button.dataset.toast));
    }
  });

  refs.personForm.addEventListener("submit", addPerson);
  document.querySelector("#personDialogClose").addEventListener("click", () => refs.personDialog.close());
  document.querySelector("#personDialogCancel").addEventListener("click", () => refs.personDialog.close());

  const storedUser = loadActiveUser();
  if (storedUser) {
    enterPortal(storedUser);
  } else {
    selectAuthRole("teacher");
    refs.authScreen.hidden = false;
    refs.portal.hidden = true;
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", initApp);
}
