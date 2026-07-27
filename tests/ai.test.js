import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateSessionSummary,
  createInitialState,
  filterStudents,
  getFollowupStudents,
  initialStudents,
  normalizeArabic,
} from "../app.js";

test("normalizes Arabic spelling variants for student search", () => {
  assert.equal(normalizeArabic("إبراهيم"), "ابراهيم");
  assert.equal(normalizeArabic("هُدَى"), "هدي");
  assert.equal(normalizeArabic("الرَّحْمَـن"), "الرحمن");
});

test("finds students by Arabic name and attendance status", () => {
  const ibrahim = filterStudents(initialStudents, "ابراهيم");
  const late = filterStudents(initialStudents, "", "late");
  const absent = filterStudents(initialStudents, "", "absent");

  assert.equal(ibrahim.length, 1);
  assert.equal(ibrahim[0].name, "إبراهيم الغامدي");
  assert.deepEqual(late.map((student) => student.name), ["زياد محمد"]);
  assert.deepEqual(absent.map((student) => student.name), ["بدر الدوسري"]);
});

test("summarizes the attendance and study records for today's session", () => {
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

test("prioritizes absent and late students in the follow-up list", () => {
  assert.deepEqual(
    getFollowupStudents(initialStudents).map((student) => student.name),
    ["بدر الدوسري", "زياد محمد", "طارق السبيعي"]
  );
});

test("creates a fresh editable state for each new session", () => {
  const firstState = createInitialState();
  const secondState = createInitialState();

  firstState.students[0].name = "اسم معدّل";

  assert.equal(secondState.students[0].name, "عبدالله الشمري");
  assert.equal(firstState.selectedId, "abdullah-alshammari");
});
