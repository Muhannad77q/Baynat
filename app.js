const STORAGE_KEY = "notari-ai-notes:v1";

const seedNotes = [
  {
    id: "welcome-note",
    title: "Welcome to Notari AI Notes",
    body:
      "Capture ideas, clean up typos, summarize long notes, extract action items, and ask the assistant to organize your workspace.\n\nTry typing: fix typos, give me ideas, summarize this, suggest tags, or delete everything.",
    tags: ["ai", "welcome"],
    mood: "creative",
    pinned: true,
    favorite: true,
    createdAt: Date.now() - 120000,
    updatedAt: Date.now() - 60000,
  },
  {
    id: "launch-plan",
    title: "Launch checklist",
    body:
      "- Need to review homepage copy\n- Follow up with design about animations\n- Must create a short demo video\n- Should collect feedback after launch",
    tags: ["tasks", "launch"],
    mood: "focused",
    pinned: false,
    favorite: false,
    createdAt: Date.now() - 90000,
    updatedAt: Date.now() - 45000,
  },
];

const typoPairs = [
  ["\\bteh\\b", "the"],
  ["\\brecieve\\b", "receive"],
  ["\\bseperate\\b", "separate"],
  ["\\bdefinately\\b", "definitely"],
  ["\\boccured\\b", "occurred"],
  ["\\bbecuase\\b", "because"],
  ["\\bthier\\b", "their"],
  ["\\bfreind\\b", "friend"],
  ["\\bwierd\\b", "weird"],
  ["\\bgoverment\\b", "government"],
  ["\\bacheive\\b", "achieve"],
  ["\\bfull full\\b", "full"],
  ["\\bhas has\\b", "has"],
  ["\\batheistic\\b", "aesthetic"],
  ["\\bai\\b", "AI"],
];

const stopWords = new Set([
  "about",
  "after",
  "again",
  "also",
  "because",
  "before",
  "could",
  "every",
  "from",
  "have",
  "into",
  "more",
  "note",
  "notes",
  "that",
  "the",
  "this",
  "with",
  "would",
  "your",
  "need",
  "should",
  "must",
  "send",
  "review",
  "full",
  "power",
  "app",
]);

let state = {
  notes: [],
  activeId: null,
  filter: "all",
  search: "",
  lastDeleted: null,
};

let refs = {};
let saveTimer;
let toastTimer;
let isStreaming = false;

export function createNote(overrides = {}) {
  const now = Date.now();
  return {
    id: overrides.id || generateId(),
    title: overrides.title || "Untitled note",
    body: overrides.body || "",
    tags: normalizeTags(overrides.tags || []),
    mood: overrides.mood || "focused",
    pinned: Boolean(overrides.pinned),
    favorite: Boolean(overrides.favorite),
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
  };
}

export function normalizeTags(tags) {
  const source = Array.isArray(tags) ? tags.join(",") : tags;
  return [...new Set(source.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

export function getWordCount(text) {
  return (text.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
}

export function correctTypos(text) {
  let next = text;
  for (const [pattern, replacement] of typoPairs) {
    next = next.replace(new RegExp(pattern, "gi"), (match) => match[0] === match[0].toUpperCase()
      ? capitalize(replacement)
      : replacement);
  }
  next = next.replace(/\b(\w+)\s+\1\b/gi, "$1");
  next = next.replace(/\s+([,.!?;:])/g, "$1");
  next = next.replace(/([.!?])\s*([a-z])/g, (_, punctuation, letter) => `${punctuation} ${letter.toUpperCase()}`);
  return next;
}

export function summarizeText(text) {
  const sentences = text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length === 0) {
    return ["Add more detail and I can summarize the key points."];
  }

  const first = sentences.slice(0, 2);
  const actions = extractActionItems(text);
  return [
    ...first,
    actions.length ? `Action focus: ${actions.slice(0, 2).join("; ")}.` : `Core theme: ${topKeywords(text).slice(0, 3).join(", ") || "early idea"}.`,
  ];
}

export function extractActionItems(text) {
  const lines = text.split(/\n+/).map((line) => line.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
  return lines.filter((line) =>
    /\b(need to|must|should|todo|follow up|deadline|ship|create|review|send|call|fix|finish)\b/i.test(line)
  );
}

export function suggestTags(note) {
  const combined = `${note.title} ${note.body}`;
  const tags = [];

  if (/\b(ai|assistant|prompt|automation)\b/i.test(combined)) {
    tags.push("ai");
  }

  if (extractActionItems(note.body).length) {
    tags.push("tasks");
  }

  if (/\b(aesthetic|design|animation|ui|website|interface)\b/i.test(combined)) {
    tags.push("design");
  }

  if (/\b(launch|demo|copy|homepage|content)\b/i.test(combined)) {
    tags.push("content");
  }

  tags.push(...topKeywords(combined).slice(0, 6));
  return [...new Set(tags)].slice(0, 6);
}

export function generateIdeas(note) {
  const keywords = topKeywords(`${note.title} ${note.body}`).slice(0, 3);
  const anchor = keywords.length ? keywords.join(", ") : "your note";
  return [
    `Turn ${anchor} into a checklist with clear next actions.`,
    `Add a short "why it matters" section to sharpen the purpose.`,
    `Create a related note for risks, open questions, and follow-ups.`,
    `Ask: what is the smallest version of this idea that can be tested today?`,
  ];
}

export function generateDraft(prompt, note = createNote()) {
  const topic = extractDraftTopic(prompt) || note.title || "your idea";
  const language = detectPromptLanguage(prompt);

  if (language === "ar") {
    return [
      `## ${topic}`,
      `هذه مسودة واضحة عن ${topic}.`,
      `الفكرة الأساسية هي تحويل الملاحظة إلى شيء عملي ومفيد، مع توضيح الهدف والخطوة التالية.`,
      `- لماذا يهم: يساعدك على ترتيب أفكارك بسرعة.`,
      `- الخطوة التالية: أضف مثالاً أو مهمة واحدة يمكن تنفيذها الآن.`,
    ].join("\n");
  }

  if (language === "es") {
    return [
      `## ${capitalize(topic)}`,
      `Este es un borrador claro sobre ${topic}.`,
      `La idea principal es convertir la nota en algo útil, ordenado y fácil de continuar.`,
      `- Por qué importa: aclara el objetivo.`,
      `- Siguiente paso: añade un ejemplo o una tarea concreta.`,
    ].join("\n");
  }

  if (language === "fr") {
    return [
      `## ${capitalize(topic)}`,
      `Voici un brouillon clair sur ${topic}.`,
      `L'idée principale est de transformer cette note en contenu utile, structuré et facile à améliorer.`,
      `- Pourquoi c'est important : cela clarifie l'objectif.`,
      `- Prochaine étape : ajoute un exemple ou une action précise.`,
    ].join("\n");
  }

  return [
    `## ${capitalize(topic)}`,
    `Here is a strong draft about ${topic}.`,
    `The main idea is to turn this note into something clear, useful, and easy to build on.`,
    `- Why it matters: it gives the note a clear purpose.`,
    `- Next step: add one example, one decision, or one action you can take now.`,
  ].join("\n");
}

export function parseAiIntent(prompt) {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized) return "empty";
  if (/\b(undo|restore)\b/.test(normalized)) return "undo";
  if (/\b(delete|clear|remove|erase|wipe)\b.*\b(everything|all notes|all|workspace)\b/.test(normalized)) return "deleteAll";
  if (/\b(delete|remove|erase)\b.*\b(current|this note|note)\b/.test(normalized)) return "deleteCurrent";
  if (/\b(clear|empty)\b.*\b(current|this note|body|page)\b/.test(normalized)) return "clearCurrent";
  if (/\b(new|create|make)\b.*\b(note|page)\b/.test(normalized)) return "createNote";
  if (/\b(fix|correct|clean).*\b(typos?|spelling|grammar|writing)\b/.test(normalized)) return "fixTypos";
  if (/\b(summarize|summary|shorten|tl;dr)\b/.test(normalized)) return "summarize";
  if (/\b(action items|tasks|todo|to-do|checklist)\b/.test(normalized)) return "tasks";
  if (/\b(tags?|organize|categorize)\b/.test(normalized)) return "tags";
  if (/\b(ideas?|brainstorm|inspire|suggestions?)\b/.test(normalized)) return "ideas";
  if (/\b(improve|rewrite|make better|polish)\b/.test(normalized)) return "improve";
  if (isWritePrompt(prompt)) return "write";
  if (/\b(shortcuts?|help|commands?)\b/.test(normalized)) return "shortcuts";
  if (/\b(search|find|look for)\b/.test(normalized)) return "search";
  return "chat";
}

export function runAiCommand({ prompt, note, notes, lastDeleted = null }) {
  const intent = parseAiIntent(prompt);

  switch (intent) {
    case "deleteAll":
      return {
        intent,
        action: "replaceAll",
        notes: [createNote({ title: "Fresh start", body: "" })],
        lastDeleted: notes,
        title: "Workspace cleared",
        lines: ["Deleted every note and opened a fresh blank note.", "Type undo if you want the notes restored."],
      };
    case "deleteCurrent": {
      const remaining = notes.filter((item) => item.id !== note.id);
      return {
        intent,
        action: "replaceAll",
        notes: remaining.length ? remaining : [createNote({ title: "Fresh start", body: "" })],
        lastDeleted: [note],
        title: "Current note deleted",
        lines: ["The active note was removed.", "Type undo if you want to restore it."],
      };
    }
    case "clearCurrent":
      return {
        intent,
        action: "updateNote",
        note: { ...note, body: "", updatedAt: Date.now() },
        title: "Note cleared",
        lines: ["Cleared the current note body."],
      };
    case "createNote":
      return {
        intent,
        action: "addNote",
        note: createNote({ title: inferTitleFromPrompt(prompt), body: "" }),
        title: "New note created",
        lines: ["Opened a blank note so you can keep writing."],
      };
    case "write": {
      const draft = generateDraft(prompt, note);
      const nextBody = note.body.trim() ? `${note.body.trim()}\n\n${draft}` : draft;
      return {
        intent,
        action: "updateNote",
        note: { ...note, body: nextBody, updatedAt: Date.now() },
        title: "Draft written",
        lines: ["Added new writing directly into the note.", "Works with multilingual prompts and right-to-left text."],
      };
    }
    case "fixTypos": {
      const fixedBody = correctTypos(note.body);
      return {
        intent,
        action: "updateNote",
        note: { ...note, body: fixedBody, updatedAt: Date.now() },
        title: fixedBody === note.body ? "No obvious typos found" : "Typos cleaned up",
        lines: fixedBody === note.body ? ["I did not find common typo patterns in this note."] : ["Updated the note with cleaner spelling and spacing."],
      };
    }
    case "summarize":
      return {
        intent,
        action: "respond",
        title: "Summary",
        lines: summarizeText(note.body),
      };
    case "tasks": {
      const tasks = extractActionItems(note.body);
      return {
        intent,
        action: "respond",
        title: "Action items",
        lines: tasks.length ? tasks : ["No clear action items yet. Add phrases like need to, should, must, review, or follow up."],
      };
    }
    case "tags": {
      const tags = suggestTags(note);
      return {
        intent,
        action: "updateNote",
        note: { ...note, tags, updatedAt: Date.now() },
        title: "Tags suggested",
        lines: tags.length ? tags.map((tag) => `#${tag}`) : ["Add more content and I can suggest stronger tags."],
      };
    }
    case "ideas":
      return {
        intent,
        action: "respond",
        title: "Ideas to build on",
        lines: generateIdeas(note),
      };
    case "improve":
      return {
        intent,
        action: "respond",
        title: "Rewrite direction",
        lines: [
          "Lead with the outcome, then explain the context.",
          "Split long thoughts into bullets so the note is easier to scan.",
          "Add one decision, one risk, and one next step.",
        ],
      };
    case "shortcuts":
      return {
        intent,
        action: "respond",
        title: "Power shortcuts",
        lines: ["Ctrl+N creates a note.", "Ctrl+K jumps to search.", "Ctrl+Enter runs the AI prompt.", "Ctrl+/ shows this help."],
      };
    case "undo":
      return lastDeleted
        ? {
            intent,
            action: "replaceAll",
            notes: lastDeleted,
            lastDeleted: null,
            title: "Restored",
            lines: ["Your deleted notes are back."],
          }
        : {
            intent,
            action: "respond",
            title: "Nothing to restore",
            lines: ["There is no deleted note snapshot available."],
          };
    case "search":
      return {
        intent,
        action: "respond",
        title: "Search tip",
        lines: ["Use Ctrl+K, then search by title, body, or tag. Semantic search can be added later with a real AI API."],
      };
    case "empty":
      return {
        intent,
        action: "respond",
        title: "What should I do?",
        lines: ["Try: write a paragraph, اكتب خطة, give me ideas, fix typos, summarize, suggest tags, create a note, or delete everything."],
      };
    default:
      return {
        intent,
        action: "respond",
        title: "AI response",
        lines: [
          `I read this as a request about "${prompt.trim()}".`,
          "For now I can execute local note actions, brainstorm, summarize, fix common typos, extract tasks, and suggest tags.",
        ],
      };
  }
}

function initApp() {
  refs = {
    body: document.body,
    newNoteBtn: document.querySelector("#newNoteBtn"),
    searchInput: document.querySelector("#searchInput"),
    noteList: document.querySelector("#noteList"),
    noteCount: document.querySelector("#noteCount"),
    noteTitle: document.querySelector("#noteTitle"),
    noteBody: document.querySelector("#noteBody"),
    tagInput: document.querySelector("#tagInput"),
    moodInput: document.querySelector("#moodInput"),
    saveStatus: document.querySelector("#saveStatus"),
    pinBtn: document.querySelector("#pinBtn"),
    favoriteBtn: document.querySelector("#favoriteBtn"),
    deleteBtn: document.querySelector("#deleteBtn"),
    aiForm: document.querySelector("#aiForm"),
    aiPrompt: document.querySelector("#aiPrompt"),
    aiResponse: document.querySelector("#aiResponse"),
    quickActions: document.querySelector(".quick-actions"),
    wordCount: document.querySelector("#wordCount"),
    taskCount: document.querySelector("#taskCount"),
    tagCount: document.querySelector("#tagCount"),
    toast: document.querySelector("#toast"),
  };

  state.notes = loadNotes();
  state.activeId = state.notes[0]?.id || null;

  bindEvents();
  render();
}

function bindEvents() {
  refs.newNoteBtn.addEventListener("click", () => addNote());
  refs.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value;
    renderList();
  });

  document.querySelectorAll(".filter").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      document.querySelectorAll(".filter").forEach((filter) => filter.classList.toggle("active", filter === button));
      renderList();
    });
  });

  refs.noteTitle.addEventListener("input", () => updateActiveNote({ title: refs.noteTitle.value || "Untitled note" }));
  refs.noteBody.addEventListener("input", () => updateActiveNote({ body: refs.noteBody.value }));
  refs.aiPrompt.addEventListener("input", () => setInputDirection(refs.aiPrompt, refs.aiPrompt.value));
  refs.tagInput.addEventListener("change", () => updateActiveNote({ tags: normalizeTags(refs.tagInput.value) }));
  refs.moodInput.addEventListener("change", () => updateActiveNote({ mood: refs.moodInput.value }));
  refs.pinBtn.addEventListener("click", () => toggleActive("pinned"));
  refs.favoriteBtn.addEventListener("click", () => toggleActive("favorite"));
  refs.deleteBtn.addEventListener("click", deleteActiveNote);
  refs.aiForm.addEventListener("submit", (event) => {
    event.preventDefault();
    runAssistant(refs.aiPrompt.value);
  });
  refs.quickActions.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-prompt]");
    if (!button) return;
    refs.aiPrompt.value = button.dataset.prompt;
    runAssistant(button.dataset.prompt);
  });

  document.addEventListener("keydown", (event) => {
    const modifier = event.ctrlKey || event.metaKey;
    if (!modifier) return;

    if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      addNote();
    }

    if (event.key.toLowerCase() === "k") {
      event.preventDefault();
      refs.searchInput.focus();
      refs.searchInput.select();
    }

    if (event.key === "Enter") {
      event.preventDefault();
      refs.aiPrompt.focus();
      runAssistant(refs.aiPrompt.value || "give me ideas");
    }

    if (event.key === "/") {
      event.preventDefault();
      refs.aiPrompt.value = "show shortcuts";
      runAssistant("show shortcuts");
    }
  });
}

function loadNotes() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return Array.isArray(stored) && stored.length ? stored.map(createNote) : seedNotes.map(createNote);
  } catch {
    return seedNotes.map(createNote);
  }
}

function persistNotes() {
  clearTimeout(saveTimer);
  refs.saveStatus.textContent = "Saving...";
  saveTimer = setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.notes));
    refs.saveStatus.textContent = "Saved locally";
  }, 180);
}

function activeNote() {
  return state.notes.find((note) => note.id === state.activeId) || state.notes[0];
}

function addNote(note = createNote({ title: "Untitled note" })) {
  state.notes = [note, ...state.notes];
  state.activeId = note.id;
  persistNotes();
  render();
  refs.noteTitle.focus();
  refs.noteTitle.select();
  showToast("New note created");
}

function updateActiveNote(patch) {
  state.notes = state.notes.map((note) =>
    note.id === state.activeId ? { ...note, ...patch, updatedAt: Date.now() } : note
  );
  persistNotes();
  renderList();
  renderMetrics();
}

function toggleActive(key) {
  const note = activeNote();
  if (!note) return;
  updateActiveNote({ [key]: !note[key] });
  renderEditor();
}

function deleteActiveNote() {
  const note = activeNote();
  if (!note) return;
  const ok = window.confirm(`Delete "${note.title}"?`);
  if (!ok) return;
  const remaining = state.notes.filter((item) => item.id !== note.id);
  state.lastDeleted = [note];
  state.notes = remaining.length ? remaining : [createNote({ title: "Fresh start" })];
  state.activeId = state.notes[0].id;
  persistNotes();
  render();
  showToast("Note deleted. Type undo in AI to restore.");
}

async function runAssistant(prompt) {
  if (isStreaming) return;
  const currentNote = activeNote();
  if (!currentNote) return;

  isStreaming = true;
  refs.body.classList.add("thinking");
  refs.aiForm.querySelector("button").disabled = true;
  refs.aiPrompt.value = "";
  setInputDirection(refs.aiPrompt, "");

  try {
    showThinkingIndicator("Notari is thinking");
    await sleep(660);

    const result = runAiCommand({
      prompt,
      note: currentNote,
      notes: state.notes,
      lastDeleted: state.lastDeleted,
    });

    if (result.action === "updateNote" && result.intent === "write") {
      await streamWriteIntoNote(currentNote, result);
    } else {
      applyStateChange(result);
    }

    await streamAssistantResponse(result);
    showToast(result.title);
  } finally {
    refs.aiForm.querySelector("button").disabled = false;
    refs.body.classList.remove("thinking");
    isStreaming = false;
  }
}

function applyStateChange(result) {
  if (result.action === "replaceAll") {
    state.notes = result.notes.map(createNote);
    state.activeId = state.notes[0]?.id || null;
    state.lastDeleted = result.lastDeleted ?? null;
    persistNotes();
    render();
  } else if (result.action === "updateNote") {
    state.notes = state.notes.map((note) =>
      note.id === result.note.id ? createNote(result.note) : note
    );
    state.activeId = result.note.id;
    persistNotes();
    render();
  } else if (result.action === "addNote") {
    state.notes = [createNote(result.note), ...state.notes];
    state.activeId = result.note.id;
    persistNotes();
    render();
  }
}

async function streamWriteIntoNote(currentNote, result) {
  showThinkingIndicator("Notari is writing");

  const target = result.note;
  const startBody = currentNote.body;
  const finalBody = target.body;
  const appended = finalBody.startsWith(startBody) ? finalBody.slice(startBody.length) : finalBody;

  state.notes = state.notes.map((note) =>
    note.id === target.id ? createNote({ ...target, body: startBody }) : note
  );
  state.activeId = target.id;
  render();

  refs.noteBody.focus();
  let workingBody = startBody;
  refs.noteBody.value = workingBody;
  refs.noteBody.setSelectionRange(workingBody.length, workingBody.length);
  setInputDirection(refs.noteBody, workingBody);

  const tokens = tokenizeForStream(appended);
  let step = 0;
  for (const token of tokens) {
    workingBody += token;
    refs.noteBody.value = workingBody;
    refs.noteBody.scrollTop = refs.noteBody.scrollHeight;
    step += 1;
    if (step % 5 === 0 || /\s/.test(token)) {
      setInputDirection(refs.noteBody, workingBody);
      state.notes = state.notes.map((note) =>
        note.id === target.id ? { ...note, body: workingBody, updatedAt: Date.now() } : note
      );
      renderList();
      renderMetrics();
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(streamDelay(token));
  }

  state.notes = state.notes.map((note) =>
    note.id === target.id ? { ...note, body: workingBody, updatedAt: Date.now() } : note
  );
  setInputDirection(refs.noteBody, workingBody);
  persistNotes();
  render();
}

function render() {
  renderList();
  renderEditor();
  renderMetrics();
}

function renderList() {
  const filtered = filteredNotes();
  refs.noteCount.textContent = `${state.notes.length} ${state.notes.length === 1 ? "note" : "notes"}`;
  refs.noteList.replaceChildren();

  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No notes match this view.";
    refs.noteList.append(empty);
    return;
  }

  filtered.forEach((note) => {
    const button = document.createElement("button");
    button.className = `note-item${note.id === state.activeId ? " active" : ""}`;
    button.type = "button";
    button.addEventListener("click", () => {
      state.activeId = note.id;
      render();
    });

    const title = document.createElement("strong");
    title.textContent = `${note.pinned ? "[Pin] " : ""}${note.favorite ? "[Fav] " : ""}${note.title || "Untitled note"}`;
    const preview = document.createElement("p");
    preview.textContent = note.body || "Empty note";
    const chips = document.createElement("div");
    chips.className = "chip-row";
    note.tags.slice(0, 3).forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = `#${tag}`;
      chips.append(chip);
    });

    button.append(title, preview, chips);
    refs.noteList.append(button);
  });
}

function renderEditor() {
  const note = activeNote();
  if (!note) return;

  refs.noteTitle.value = note.title;
  refs.noteBody.value = note.body;
  setInputDirection(refs.noteTitle, note.title);
  setInputDirection(refs.noteBody, note.body);
  refs.tagInput.value = note.tags.join(", ");
  refs.moodInput.value = note.mood;
  refs.pinBtn.textContent = note.pinned ? "Unpin" : "Pin";
  refs.favoriteBtn.textContent = note.favorite ? "Unfavorite" : "Favorite";
}

function renderMetrics() {
  const note = activeNote();
  const allTags = new Set(state.notes.flatMap((item) => item.tags));
  const allTasks = state.notes.reduce((count, item) => count + extractActionItems(item.body).length, 0);
  refs.wordCount.textContent = `${getWordCount(note?.body || "")} words`;
  refs.taskCount.textContent = allTasks;
  refs.tagCount.textContent = allTags.size;
}

async function streamAssistantResponse(result) {
  const container = document.createDocumentFragment();
  const title = document.createElement("h3");
  title.textContent = result.title;
  container.append(title);
  const list = document.createElement("ul");
  container.append(list);
  refs.aiResponse.replaceChildren(container);

  for (const line of result.lines) {
    const item = document.createElement("li");
    const cursor = document.createElement("span");
    cursor.className = "stream-cursor";
    item.append(cursor);
    list.append(item);

    const tokens = tokenizeForStream(line);
    for (const token of tokens) {
      const textNode = document.createTextNode(token);
      item.insertBefore(textNode, cursor);
      refs.aiResponse.scrollTop = refs.aiResponse.scrollHeight;
      // eslint-disable-next-line no-await-in-loop
      await sleep(streamDelay(token));
    }

    cursor.remove();
  }
}

function showThinkingIndicator(label = "Notari is thinking") {
  const wrap = document.createElement("div");
  wrap.className = "thinking-indicator";
  wrap.append(label);
  const dots = document.createElement("span");
  dots.className = "dots";
  for (let i = 0; i < 3; i += 1) {
    dots.append(document.createElement("span"));
  }
  wrap.append(dots);
  refs.aiResponse.replaceChildren(wrap);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function tokenizeForStream(text) {
  return text.match(/\p{L}+|\p{N}+|\s+|[^\s\p{L}\p{N}]+/gu) || [];
}

export function streamDelay(token) {
  if (!token) return 0;
  if (/\n/.test(token)) return 95;
  if (/^\s+$/.test(token)) return 12;
  if (/[.!?،؟。]/.test(token)) return 120;
  if (/^[,;:]$/.test(token)) return 70;
  return 20 + Math.random() * 22;
}

function filteredNotes() {
  const search = state.search.trim().toLowerCase();
  return [...state.notes]
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
    .filter((note) => {
      if (state.filter === "pinned" && !note.pinned) return false;
      if (state.filter === "favorites" && !note.favorite) return false;
      if (state.filter === "todo" && !extractActionItems(note.body).length) return false;
      if (!search) return true;
      return `${note.title} ${note.body} ${note.tags.join(" ")}`.toLowerCase().includes(search);
    });
}

function showToast(message) {
  clearTimeout(toastTimer);
  refs.toast.textContent = message;
  refs.toast.classList.add("visible");
  toastTimer = setTimeout(() => refs.toast.classList.remove("visible"), 2400);
}

function topKeywords(text) {
  const counts = new Map();
  const words = (text.toLowerCase().match(/[\p{L}][\p{L}\p{N}'’-]{2,}/gu) || []).filter((word) => !stopWords.has(word));
  words.forEach((word) => counts.set(word, (counts.get(word) || 0) + 1));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word]) => word)
    .slice(0, 8);
}

function isWritePrompt(prompt) {
  const comparable = normalizePromptForMatching(prompt);
  return /(^|\s)(write|draft|compose|generate|make)\b/i.test(comparable)
    || /([اأإآ]كتب|اكتبي|اكتبلي|صغ|[اأإآ]نشئ|انشئ)/u.test(comparable)
    || /(escribe|redacta|genera|écris|ecris|rédige|redige|escreva|schreib|schreibe|yaz|लिख|لکھ|بنویس|写|撰写|書いて|書く|써|작성)/iu.test(comparable);
}

function extractDraftTopic(prompt) {
  const comparable = normalizePromptForMatching(prompt);
  return comparable
    .replace(/^(please\s+)?(write|draft|compose|generate|make)\s+(a|an|the|me|for me)?\s*/i, "")
    .replace(/^([اأإآ]كتب|اكتبي|اكتبلي|صغ|[اأإآ]نشئ|انشئ)\s*/u, "")
    .replace(/^(escribe|redacta|genera|écris|ecris|rédige|redige|escreva|schreib|schreibe|yaz)\s*/iu, "")
    .replace(/^(लिख|لکھ|بنویس|写|撰写|書いて|書く|써|작성)\s*/iu, "")
    .replace(/^(paragraph|note|draft|story|plan|text|content|email|letter|essay|poem)\s+(about|for|on)?\s*/i, "")
    .replace(/^(فقرة|ملاحظة|خطة|رسالة|نص)\s*(عن|حول)?\s*/u, "")
    .replace(/[.!?؟]+$/u, "")
    .trim();
}

function detectPromptLanguage(prompt) {
  if (/[\u0600-\u06ff]/u.test(prompt)) return "ar";
  if (/\b(escribe|redacta|genera|sobre|para)\b|[¿¡]/iu.test(prompt)) return "es";
  if (/\b(écris|ecris|rédige|redige|sur|pour)\b/iu.test(prompt)) return "fr";
  return "en";
}

function normalizePromptForMatching(prompt) {
  return prompt.normalize("NFKC").replace(/[\u064B-\u065F\u0670]/gu, "");
}

function inferTitleFromPrompt(prompt) {
  const match = prompt.match(/(?:called|named|about)\s+(.+)$/i);
  if (!match) return "Untitled note";
  return capitalize(match[1].replace(/[.!?]+$/, "").trim()).slice(0, 80) || "Untitled note";
}

function generateId() {
  return globalThis.crypto?.randomUUID?.() || `note-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function setInputDirection(element, value) {
  element.dir = getTextDirection(value);
}

export function getTextDirection(value) {
  const firstStrong = value.match(/[\p{L}]/u)?.[0] || "";
  if (!firstStrong) return "auto";
  return /[\u0591-\u07ff\uFB1D-\uFDFD\uFE70-\uFEFC]/u.test(firstStrong) ? "rtl" : "ltr";
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", initApp);
}
