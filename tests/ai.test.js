import assert from "node:assert/strict";
import test from "node:test";
import {
  authenticateDemoAccount,
  calculateSessionSummary,
  calculateTaskProgress,
  createInitialState,
  filterStudents,
  getRoleNavigation,
  initialStudents,
  normalizeArabic,
} from "../app.js";

test("authenticates each demo role with the matching credentials", () => {
  const teacher = authenticateDemoAccount("teacher", "123456", "teacher");
  const parent = authenticateDemoAccount("parent", "123456", "parent");
  const invalidRole = authenticateDemoAccount("teacher", "123456", "parent");
  const invalidPassword = authenticateDemoAccount("student", "bad-password", "student");

  assert.equal(teacher.name, "عبد الرحمن العتيبي");
  assert.equal(parent.childId, "abdullah-alshammari");
  assert.equal(invalidRole, null);
  assert.equal(invalidPassword, null);
});

test("normalizes Arabic spelling variants for student search", () => {
  assert.equal(normalizeArabic("إبراهيم"), "ابراهيم");
  assert.equal(normalizeArabic("هُدَى"), "هدي");
  assert.equal(normalizeArabic("الرَّحْمَـن"), "الرحمن");
});

test("filters students by Arabic name and attendance state", () => {
  const ibrahim = filterStudents(initialStudents, "ابراهيم");
  const late = filterStudents(initialStudents, "", "late");
  const absent = filterStudents(initialStudents, "", "absent");

  assert.deepEqual(ibrahim.map((student) => student.name), ["إبراهيم الغامدي"]);
  assert.deepEqual(late.map((student) => student.name), ["زياد محمد"]);
  assert.deepEqual(absent.map((student) => student.name), ["بدر الدوسري"]);
});

test("summarizes attendance and learning metrics for today's session", () => {
  assert.deepEqual(calculateSessionSummary(initialStudents), {
    total: 10,
    present: 8,
    late: 1,
    absent: 1,
    memorizationPages: 18,
    recitationAverage: 4.4,
    tafsirRead: 7,
    attendanceRate: 80,
  });
});

test("calculates a student's assignment progress", () => {
  assert.deepEqual(
    calculateTaskProgress([
      { complete: true },
      { complete: false },
      { complete: false },
      { complete: true },
    ]),
    { total: 4, complete: 2, percentage: 50 }
  );
  assert.deepEqual(calculateTaskProgress([]), { total: 0, complete: 0, percentage: 0 });
});

test("exposes role-appropriate navigation and creates isolated state", () => {
  const supervisorRoutes = getRoleNavigation("supervisor").map((item) => item.id);
  const first = createInitialState();
  const second = createInitialState();

  first.students[0].name = "اسم معدل";

  assert.deepEqual(supervisorRoutes, ["overview", "management", "reports", "brand"]);
  assert.equal(second.students[0].name, "عبدالله الشمري");
  assert.equal(first.brandId, "gate");
});
