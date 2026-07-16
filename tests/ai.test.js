import assert from "node:assert/strict";
import test from "node:test";
import {
  correctTypos,
  createNote,
  detectDominantLanguage,
  detectTargetLanguage,
  detectTone,
  draftAnswer,
  draftExplanation,
  extractActionItems,
  extendDraft,
  generateDraft,
  generateTitleFromContent,
  getTextDirection,
  getWordCount,
  isQuestion,
  isTranslatePrompt,
  LANGUAGE_NAMES,
  outlineFromText,
  parseAiIntent,
  rewriteWithTone,
  runAiCommand,
  shortenText,
  streamDelay,
  suggestTags,
  toBulletList,
  tokenizeForStream,
  translateViaApi,
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

test("parses expanded AI intents (translate, continue, rewrite, and friends)", () => {
  assert.equal(parseAiIntent("translate this to Spanish"), "translate");
  assert.equal(parseAiIntent("translate to arabic"), "translate");
  assert.equal(parseAiIntent("ترجم إلى الإنجليزية"), "translate");
  assert.equal(parseAiIntent("continue this note"), "continue");
  assert.equal(parseAiIntent("keep going"), "continue");
  assert.equal(parseAiIntent("أكمل"), "continue");
  assert.equal(parseAiIntent("make it shorter"), "shorten");
  assert.equal(parseAiIntent("shorten this"), "shorten");
  assert.equal(parseAiIntent("turn this into an outline"), "outline");
  assert.equal(parseAiIntent("convert to a bullet list"), "convertToList");
  assert.equal(parseAiIntent("bullets please"), "convertToList");
  assert.equal(parseAiIntent("suggest a title"), "generateTitle");
  assert.equal(parseAiIntent("rewrite this in a formal tone"), "rewrite");
  assert.equal(parseAiIntent("rephrase this"), "rewrite");
  assert.equal(parseAiIntent("explain photosynthesis"), "explain");
  assert.equal(parseAiIntent("اشرح لي الفكرة"), "explain");
  assert.equal(parseAiIntent("What is quantum computing?"), "answer");
  assert.equal(parseAiIntent("Why does the sky turn red at sunset"), "answer");
});

test("does not fall through to 'chat' for unknown prompts — defaults to helpful write", () => {
  assert.equal(parseAiIntent("random musings about photography"), "write");
  assert.equal(parseAiIntent("hmmm"), "write");
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

test("tokenizes text into streamable chunks across scripts", () => {
  assert.deepEqual(tokenizeForStream("Hola 你好"), ["Hola", " ", "你好"]);
  assert.deepEqual(tokenizeForStream("Yes! Now."), ["Yes", "!", " ", "Now", "."]);
  assert.deepEqual(tokenizeForStream("مرحبا"), ["مرحبا"]);
  assert.deepEqual(tokenizeForStream(""), []);
});

test("stream delay slows for punctuation and newlines", () => {
  const wordDelay = streamDelay("hello");
  const punctuationDelay = streamDelay(".");
  const newlineDelay = streamDelay("\n");
  const spaceDelay = streamDelay(" ");

  assert.ok(punctuationDelay > wordDelay, "punctuation should pause longer than a word");
  assert.ok(newlineDelay > wordDelay, "newline should pause longer than a word");
  assert.ok(spaceDelay < wordDelay, "single space should be fast");
});

test("detects translate prompts across languages and formats", () => {
  assert.equal(isTranslatePrompt("translate this to Spanish"), true);
  assert.equal(isTranslatePrompt("Translate"), true);
  assert.equal(isTranslatePrompt("ترجم إلى الإنجليزية"), true);
  assert.equal(isTranslatePrompt("traduire en français"), true);
  assert.equal(isTranslatePrompt("übersetze ins englische"), true);
  assert.equal(isTranslatePrompt("write a poem"), false);
  assert.equal(isTranslatePrompt(""), false);
});

test("detects target languages from a variety of prompt shapes", () => {
  assert.equal(detectTargetLanguage("translate to Spanish"), "es");
  assert.equal(detectTargetLanguage("translate into french"), "fr");
  assert.equal(detectTargetLanguage("translate this to arabic"), "ar");
  assert.equal(detectTargetLanguage("ترجم إلى الإنجليزية"), "en");
  assert.equal(detectTargetLanguage("traduce al español"), "es");
  assert.equal(detectTargetLanguage("translate to japanese"), "ja");
  assert.equal(detectTargetLanguage("translate to chinese"), "zh-CN");
  assert.equal(detectTargetLanguage("translate"), "en");
});

test("detects dominant language of note body text", () => {
  assert.equal(detectDominantLanguage("Hello there, this is english"), "en");
  assert.equal(detectDominantLanguage("مرحبا بالعالم"), "ar");
  assert.equal(detectDominantLanguage("こんにちは"), "ja");
  assert.equal(detectDominantLanguage("你好世界"), "zh-CN");
  assert.equal(detectDominantLanguage("Привет мир"), "ru");
});

test("translateViaApi prefers Google Translate and returns joined text", async () => {
  const seen = [];
  const fakeFetch = async (url) => {
    seen.push(url);
    return {
      ok: true,
      json: async () => [[["Hola mundo", "Hello world", null, null, 10]], null, "en", null, null, null, null, []],
    };
  };
  const output = await translateViaApi("Hello world", "en", "es", { fetchImpl: fakeFetch });
  assert.equal(output, "Hola mundo");
  assert.equal(seen.length, 1);
  assert.match(seen[0], /translate\.googleapis\.com/);
  assert.match(seen[0], /sl=en&tl=es/);
});

test("translateViaApi falls back to MyMemory when Google fails", async () => {
  const seen = [];
  const fakeFetch = async (url) => {
    seen.push(url);
    if (url.includes("googleapis")) return { ok: false, json: async () => ({}) };
    return {
      ok: true,
      json: async () => ({ responseData: { translatedText: "Hola mundo" } }),
    };
  };
  const output = await translateViaApi("Hello world", "en", "es", { fetchImpl: fakeFetch });
  assert.equal(output, "Hola mundo");
  assert.equal(seen.length, 2);
  assert.match(seen[0], /translate\.googleapis\.com/);
  assert.match(seen[1], /mymemory\.translated\.net/);
  assert.match(seen[1], /langpair=en\|es/);
});

test("translateViaApi rejects unsupported language pairs cleanly", async () => {
  const fakeFetch = async (url) => {
    if (url.includes("googleapis")) throw new Error("google unavailable");
    return {
      ok: true,
      json: async () => ({ responseData: { translatedText: "PLEASE SELECT TWO DISTINCT LANGUAGES" } }),
    };
  };
  await assert.rejects(() => translateViaApi("Hello", "en", "en-fake", { fetchImpl: fakeFetch }));
});

test("translate intent packages sourceLang, targetLang, and stays async-ready", () => {
  const note = createNote({ id: "t", title: "Draft", body: "Hello world" });
  const result = runAiCommand({ prompt: "translate to Spanish", note, notes: [note] });
  assert.equal(result.intent, "translate");
  assert.equal(result.action, "translate");
  assert.equal(result.targetLang, "es");
  assert.equal(result.sourceLang, "en");
  assert.match(result.title, /Spanish/);
});

test("continue intent appends a new paragraph in the note's dominant language", () => {
  const note = createNote({ id: "c", title: "Focus", body: "This is my first thought about focus." });
  const result = runAiCommand({ prompt: "continue", note, notes: [note] });
  assert.equal(result.action, "updateNote");
  assert.ok(result.note.body.startsWith(note.body));
  assert.ok(result.note.body.length > note.body.length);
});

test("continue intent refuses to continue on an empty note", () => {
  const note = createNote({ id: "c", title: "Empty", body: "" });
  const result = runAiCommand({ prompt: "continue", note, notes: [note] });
  assert.equal(result.action, "respond");
  assert.match(result.title, /Nothing to continue/i);
});

test("shortenText compresses long notes but preserves short ones", () => {
  const shortNote = "Short body.";
  assert.equal(shortenText(shortNote), shortNote);
  const long = "First sentence here. Second sentence here. Third sentence here. Fourth sentence here. Fifth sentence here. Sixth sentence here.";
  const shortened = shortenText(long);
  assert.ok(shortened.length < long.length, "long text should be trimmed");
});

test("toBulletList converts prose into deduped bullet points", () => {
  const list = toBulletList("Buy milk. Buy eggs. Buy milk.");
  const lines = list.split("\n");
  assert.deepEqual(lines, ["- Buy milk", "- Buy eggs"]);
});

test("outlineFromText produces a structured outline with headings", () => {
  const outline = outlineFromText("Intro sentence. More intro details.\n\nSecond section. More details here.");
  assert.match(outline, /^## Outline/);
  assert.match(outline, /### 1\./);
  assert.match(outline, /### 2\./);
});

test("generateTitleFromContent picks a sensible title", () => {
  const title = generateTitleFromContent("Launch checklist for the AI notes app. Includes homepage copy and demo video.");
  assert.equal(title, "Launch checklist for the AI notes app");
  assert.equal(generateTitleFromContent(""), "Untitled note");
});

test("extendDraft continues in the note's language (Arabic and English)", () => {
  const arNote = createNote({ id: "a", title: "الدراسة", body: "الدراسة مهمة." });
  const arExt = extendDraft("continue", arNote);
  assert.match(arExt, /بالإضافة إلى ما سبق/);

  const enNote = createNote({ id: "b", title: "Study", body: "Studying matters." });
  const enExt = extendDraft("continue", enNote);
  assert.match(enExt, /Building on that/);
});

test("draftAnswer returns a thoughtful multi-line answer", () => {
  const note = createNote({ id: "q", title: "Physics", body: "" });
  const answer = draftAnswer("Why is the sky blue?", note);
  assert.match(answer, /## Answer/);
  assert.match(answer, /sky blue/i);
});

test("draftExplanation adapts to the note's language", () => {
  const arNote = createNote({ id: "e", body: "مقدمة عربية" });
  const enNote = createNote({ id: "e", body: "English intro" });
  assert.match(draftExplanation("photosynthesis", enNote), /can be understood/);
  assert.match(draftExplanation("التمثيل الضوئي", arNote), /يمكن فهم/);
});

test("rewriteWithTone applies formal and casual transformations", () => {
  const casual = rewriteWithTone("I cannot help you obtain the data.", "casual");
  assert.match(casual, /can't/);
  assert.match(casual, /get/);
  const formal = rewriteWithTone("It's a great tool, we can't get enough of it.", "formal");
  assert.match(formal, /It is/);
  assert.match(formal, /cannot/);
  assert.match(formal, /obtain/);
});

test("detectTone picks up on tone cues in the prompt", () => {
  assert.equal(detectTone("make it more formal"), "formal");
  assert.equal(detectTone("rewrite this casually"), "casual");
  assert.equal(detectTone("be warm and friendly"), "friendly");
  assert.equal(detectTone("make it concise"), "concise");
});

test("isQuestion identifies both English and Arabic questions", () => {
  assert.equal(isQuestion("What is love?"), true);
  assert.equal(isQuestion("How does light bend"), true);
  assert.equal(isQuestion("ما هي الفكرة؟"), true);
  assert.equal(isQuestion("write a paragraph"), false);
});

test("LANGUAGE_NAMES maps common ISO codes to friendly names", () => {
  assert.equal(LANGUAGE_NAMES.es, "Spanish");
  assert.equal(LANGUAGE_NAMES.ar, "Arabic");
  assert.equal(LANGUAGE_NAMES["zh-CN"], "Chinese");
});

test("outline intent replaces body with structured outline", () => {
  const note = createNote({ id: "o", title: "Notes", body: "Alpha. Beta. Gamma.\n\nSecond paragraph. And more." });
  const result = runAiCommand({ prompt: "outline this", note, notes: [note] });
  assert.equal(result.action, "updateNote");
  assert.match(result.note.body, /## Outline/);
});

test("shorten intent trims a long note body", () => {
  const body = "One sentence. Two sentence. Three sentence. Four sentence. Five sentence. Six sentence.";
  const note = createNote({ id: "s", body });
  const result = runAiCommand({ prompt: "make it shorter", note, notes: [note] });
  assert.equal(result.action, "updateNote");
  assert.ok(result.note.body.length < body.length);
});

test("generateTitle intent updates the note title based on content", () => {
  const note = createNote({ id: "gt", title: "Untitled note", body: "Launch checklist for the AI notes app." });
  const result = runAiCommand({ prompt: "suggest a title", note, notes: [note] });
  assert.equal(result.action, "updateNote");
  assert.notEqual(result.note.title, "Untitled note");
});

test("rewrite intent uses tone detection to reshape body", () => {
  const note = createNote({ id: "rw", body: "I can't help you obtain the data." });
  const result = runAiCommand({ prompt: "rewrite this more formally", note, notes: [note] });
  assert.equal(result.action, "updateNote");
  assert.match(result.note.body, /cannot/);
});

test("answer intent appends a drafted answer to the note", () => {
  const note = createNote({ id: "a", title: "Physics", body: "Existing note." });
  const result = runAiCommand({ prompt: "why is the sky blue?", note, notes: [note] });
  assert.equal(result.action, "updateNote");
  assert.match(result.note.body, /^Existing note\./);
  assert.match(result.note.body, /## Answer/);
});

test("unknown prompts route to write instead of dismissive chat", () => {
  const note = createNote({ id: "u", title: "Topic", body: "" });
  const result = runAiCommand({ prompt: "photography workflow", note, notes: [note] });
  assert.equal(result.intent, "write");
  assert.equal(result.action, "updateNote");
  assert.ok(result.note.body.length > 0);
});
