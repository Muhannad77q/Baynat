import assert from "node:assert/strict";
import test from "node:test";
import {
  correctTypos,
  createNote,
  extractActionItems,
  generateDraft,
  getTextDirection,
  getWordCount,
  parseAiIntent,
  runAiCommand,
  suggestTags,
} from "../app.js";

test("parses direct AI actions", () => {
  assert.equal(parseAiIntent("delete everything"), "deleteAll");
  assert.equal(parseAiIntent("clear this note"), "clearCurrent");
  assert.equal(parseAiIntent("make a new note about product ideas"), "createNote");
  assert.equal(parseAiIntent("fix typos"), "fixTypos");
  assert.equal(parseAiIntent("Ideas"), "ideas");
  assert.equal(parseAiIntent("Suggest tags"), "tags");
  assert.equal(parseAiIntent("write a paragraph about study goals"), "write");
  assert.equal(parseAiIntent("اكتب خطة عن الدراسة"), "write");
  assert.equal(parseAiIntent("إكتب خُطّة عن الدراسة"), "write");
  assert.equal(parseAiIntent("show shortcuts"), "shortcuts");
});

test("cleans common typos and duplicate words", () => {
  const input = "teh app has has full full ai power becuase it is atheistic.";
  assert.equal(correctTypos(input), "the app has full AI power because it is aesthetic.");
});

test("extracts actionable lines from messy notes", () => {
  const items = extractActionItems("- Need to review copy\nRandom thought\nShould send the demo");
  assert.deepEqual(items, ["Need to review copy", "Should send the demo"]);
});

test("delete everything replaces workspace and keeps undo snapshot", () => {
  const notes = [
    createNote({ id: "one", title: "One", body: "Keep this" }),
    createNote({ id: "two", title: "Two", body: "Keep this too" }),
  ];
  const result = runAiCommand({ prompt: "delete everything", note: notes[0], notes });

  assert.equal(result.action, "replaceAll");
  assert.equal(result.notes.length, 1);
  assert.equal(result.notes[0].title, "Fresh start");
  assert.deepEqual(result.lastDeleted.map((note) => note.id), ["one", "two"]);
});

test("undo restores deleted note snapshot", () => {
  const deleted = [createNote({ id: "old", title: "Old note" })];
  const active = createNote({ id: "fresh", title: "Fresh start" });
  const result = runAiCommand({ prompt: "undo", note: active, notes: [active], lastDeleted: deleted });

  assert.equal(result.action, "replaceAll");
  assert.equal(result.notes[0].id, "old");
  assert.equal(result.lastDeleted, null);
});

test("suggests useful tags from note content", () => {
  const note = createNote({
    title: "AI launch tasks",
    body: "Need to review AI assistant prompts and create aesthetic launch copy.",
  });

  const tags = suggestTags(note);
  assert.deepEqual(tags.slice(0, 4), ["ai", "tasks", "design", "content"]);
  assert.equal(tags.includes("the"), false);
});

test("writes draft content directly into the active note", () => {
  const note = createNote({ id: "draft", title: "Study goals", body: "Existing thought." });
  const result = runAiCommand({
    prompt: "write a paragraph about study goals",
    note,
    notes: [note],
  });

  assert.equal(result.action, "updateNote");
  assert.match(result.note.body, /Existing thought\./);
  assert.match(result.note.body, /Here is a strong draft about study goals/i);
});

test("supports Arabic draft prompts and unicode word counts", () => {
  const draft = generateDraft("اكتب خطة عن الدراسة", createNote({ title: "الدراسة" }));

  assert.match(draft, /هذه مسودة واضحة/);
  assert.equal(getWordCount("مرحبا بالعالم hello world"), 4);
});

test("sets direction from the first strong character", () => {
  assert.equal(getTextDirection("English first\nثم العربية"), "ltr");
  assert.equal(getTextDirection("العربية أولا\nthen English"), "rtl");
  assert.equal(getTextDirection("1234"), "auto");
});
