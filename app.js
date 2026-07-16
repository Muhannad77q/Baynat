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

export const LANGUAGE_MAP = {
  english: "en", en: "en", ingles: "en", "inglés": "en", "الإنجليزية": "en", "الانجليزية": "en", "انجليزي": "en", "انجليزية": "en", "إنجليزي": "en", "إنجليزية": "en", anglais: "en", englisch: "en",
  arabic: "ar", ar: "ar", arabe: "ar", "árabe": "ar", "العربية": "ar", "عربي": "ar", "عربية": "ar", arabisch: "ar",
  spanish: "es", es: "es", "español": "es", espanol: "es", espagnol: "es", spanisch: "es", "الإسبانية": "es", "الاسبانية": "es", "اسباني": "es",
  french: "fr", fr: "fr", "français": "fr", francais: "fr", "französisch": "fr", franzosisch: "fr", "الفرنسية": "fr", "فرنسي": "fr",
  german: "de", de: "de", deutsch: "de", aleman: "de", "alemán": "de", allemand: "de", "الألمانية": "de", "الالمانية": "de",
  italian: "it", it: "it", italiano: "it", italien: "it", italienisch: "it", "الإيطالية": "it", "الايطالية": "it",
  portuguese: "pt", pt: "pt", "português": "pt", portugues: "pt", portugais: "pt", portugiesisch: "pt", "البرتغالية": "pt",
  russian: "ru", ru: "ru", "русский": "ru", ruso: "ru", russe: "ru", russisch: "ru", "الروسية": "ru", "روسي": "ru",
  japanese: "ja", ja: "ja", "日本語": "ja", "japonés": "ja", japones: "ja", japonais: "ja", japanisch: "ja", "اليابانية": "ja",
  chinese: "zh-CN", zh: "zh-CN", "中文": "zh-CN", mandarin: "zh-CN", chino: "zh-CN", chinois: "zh-CN", chinesisch: "zh-CN", "الصينية": "zh-CN",
  korean: "ko", ko: "ko", "한국어": "ko", coreano: "ko", "coréen": "ko", coreen: "ko", koreanisch: "ko", "الكورية": "ko",
  hindi: "hi", hi: "hi", "हिन्दी": "hi", "الهندية": "hi",
  turkish: "tr", tr: "tr", "türkçe": "tr", turco: "tr", turc: "tr", "türkisch": "tr", turkisch: "tr", "التركية": "tr",
  dutch: "nl", nl: "nl", nederlands: "nl", "holandés": "nl", holandes: "nl", neerlandais: "nl", "niederländisch": "nl", "الهولندية": "nl",
  urdu: "ur", ur: "ur", "اردو": "ur", "الأردية": "ur",
  persian: "fa", farsi: "fa", fa: "fa", "فارسي": "fa", "الفارسية": "fa",
  hebrew: "he", he: "he", "עברית": "he", "hebreo": "he", hebreu: "he", hebraisch: "he", "العبرية": "he",
  polish: "pl", pl: "pl", polski: "pl", polaco: "pl", polonais: "pl", polnisch: "pl", "البولندية": "pl",
  swedish: "sv", sv: "sv", svenska: "sv", sueco: "sv", "suédois": "sv", suedois: "sv", schwedisch: "sv", "السويدية": "sv",
  greek: "el", el: "el", griego: "el", grec: "el", griechisch: "el", "اليونانية": "el",
  vietnamese: "vi", vi: "vi", vietnamita: "vi", vietnamien: "vi", vietnamesisch: "vi", "الفيتنامية": "vi",
  indonesian: "id", id: "id", bahasa: "id", indonesio: "id", "indonésien": "id", indonesisch: "id", "الإندونيسية": "id",
  thai: "th", th: "th", "ภาษาไทย": "th", "tailandés": "th", tailandes: "th", "thaïlandais": "th", "التايلاندية": "th",
  ukrainian: "uk", uk: "uk", "українська": "uk", ucraniano: "uk", ukrainien: "uk", ukrainisch: "uk",
  bengali: "bn", bn: "bn", "বাংলা": "bn",
};

export const LANGUAGE_NAMES = {
  en: "English", ar: "Arabic", es: "Spanish", fr: "French", de: "German", it: "Italian",
  pt: "Portuguese", ru: "Russian", ja: "Japanese", "zh-CN": "Chinese", ko: "Korean",
  hi: "Hindi", tr: "Turkish", nl: "Dutch", ur: "Urdu", fa: "Persian", he: "Hebrew",
  pl: "Polish", sv: "Swedish", el: "Greek", vi: "Vietnamese", id: "Indonesian",
  th: "Thai", uk: "Ukrainian", bn: "Bengali",
};

export function isTranslatePrompt(prompt) {
  if (!prompt) return false;
  const normalized = normalizePromptForMatching(prompt).toLowerCase();
  if (/\b(translate|translation|translator)\b/.test(normalized)) return true;
  if (/(traduce|traduci|traduza|traduzir|traduire|traducir|übersetze|ubersetze|çevir|翻译|翻訳|번역)/iu.test(normalized)) return true;
  if (/(ترجم|الترجمة|ترجمة|ترجمها|ترجمه)/u.test(normalized)) return true;
  return false;
}

export function detectTargetLanguage(prompt, fallback = "en") {
  if (!prompt) return fallback;
  const normalized = normalizePromptForMatching(prompt).toLowerCase();
  const prepositionPatterns = [
    /(?:to|into|in)\s+(?:the\s+)?([\p{L}]+)/gu,
    /(?:al|en|au|aux|à|a|nach|ins?|em|para)\s+([\p{L}]+)/gu,
    /(?:إلى|الى|للـ|لـ|ل)\s*([\p{L}]+)/gu,
  ];
  for (const pattern of prepositionPatterns) {
    for (const match of normalized.matchAll(pattern)) {
      const key = match[1];
      if (LANGUAGE_MAP[key]) return LANGUAGE_MAP[key];
    }
  }
  const wordSet = new Set(normalized.match(/[\p{L}]+/gu) || []);
  for (const [key, code] of Object.entries(LANGUAGE_MAP)) {
    if (wordSet.has(key)) return code;
  }
  return fallback;
}

export function detectDominantLanguage(text) {
  if (!text) return "en";
  if (/[\u0600-\u06ff]/u.test(text)) return "ar";
  if (/[\u4e00-\u9fff]/u.test(text)) return "zh-CN";
  if (/[\u3040-\u309f\u30a0-\u30ff]/u.test(text)) return "ja";
  if (/[\uac00-\ud7af]/u.test(text)) return "ko";
  if (/[\u0900-\u097f]/u.test(text)) return "hi";
  if (/[\u0590-\u05ff]/u.test(text)) return "he";
  if (/[\u0400-\u04ff]/u.test(text)) return "ru";
  if (/[\u0e00-\u0e7f]/u.test(text)) return "th";
  return "en";
}

function splitForTranslate(text, limit = 450) {
  if (!text) return [];
  if (text.length <= limit) return [text];
  const paragraphs = text.split(/\n{2,}/);
  const chunks = [];
  let buffer = "";
  const flushBuffer = () => { if (buffer) { chunks.push(buffer); buffer = ""; } };
  for (const paragraph of paragraphs) {
    if ((buffer.length + paragraph.length + 2) > limit) {
      flushBuffer();
      if (paragraph.length > limit) {
        const sentences = paragraph.split(/(?<=[.!?،؟。])\s+/);
        let inner = "";
        for (const sentence of sentences) {
          if ((inner.length + sentence.length + 1) > limit) {
            if (inner) { chunks.push(inner); inner = ""; }
            if (sentence.length > limit) {
              for (let i = 0; i < sentence.length; i += limit) chunks.push(sentence.slice(i, i + limit));
            } else {
              inner = sentence;
            }
          } else {
            inner = inner ? `${inner} ${sentence}` : sentence;
          }
        }
        if (inner) chunks.push(inner);
      } else {
        buffer = paragraph;
      }
    } else {
      buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    }
  }
  flushBuffer();
  return chunks.length ? chunks : [text];
}

export async function translateViaApi(text, sourceLang, targetLang, { fetchImpl = (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null) } = {}) {
  if (!text || !text.trim()) return "";
  if (!fetchImpl) throw new Error("fetch is not available");
  if (sourceLang === targetLang) return text;
  let primaryError;
  try {
    return await translateWithGoogle(text, sourceLang, targetLang, fetchImpl);
  } catch (error) {
    primaryError = error;
  }
  try {
    return await translateWithMyMemory(text, sourceLang, targetLang, fetchImpl);
  } catch {
    throw primaryError;
  }
}

async function translateWithGoogle(text, sourceLang, targetLang, fetchImpl) {
  const chunks = splitForTranslate(text, 2800);
  const results = [];
  for (const chunk of chunks) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sourceLang)}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(chunk)}`;
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`Google translate returned ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      throw new Error("Google translate returned malformed response");
    }
    const translated = data[0]
      .filter((row) => Array.isArray(row) && typeof row[0] === "string")
      .map((row) => row[0])
      .join("");
    if (!translated) throw new Error("Google translate returned empty translation");
    results.push(translated);
  }
  return results.join("\n\n");
}

async function translateWithMyMemory(text, sourceLang, targetLang, fetchImpl) {
  const chunks = splitForTranslate(text, 450);
  const results = [];
  for (const chunk of chunks) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${encodeURIComponent(sourceLang)}|${encodeURIComponent(targetLang)}`;
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`MyMemory returned ${response.status}`);
    const data = await response.json();
    const translated = data?.responseData?.translatedText;
    if (typeof translated !== "string" || /INVALID TARGET LANGUAGE|PLEASE SELECT|MYMEMORY WARNING/i.test(translated)) {
      throw new Error("MyMemory could not process this language pair");
    }
    results.push(translated);
  }
  return results.join("\n\n");
}

export function shortenText(text) {
  if (!text || !text.trim()) return text;
  const sentences = text.replace(/\n+/g, " ").split(/(?<=[.!?،؟。])\s+/).filter(Boolean);
  if (sentences.length <= 2) return text.trim();
  const target = Math.max(2, Math.round(sentences.length / 3));
  return sentences.slice(0, target).join(" ").trim();
}

export function toBulletList(text) {
  if (!text || !text.trim()) return text;
  const items = text
    .split(/\n+|(?<=[.!?،؟。])\s+/)
    .map((piece) => piece.replace(/^[-*•]\s*/, "").replace(/[.!?،؟。]+$/u, "").trim())
    .filter((piece) => piece.length > 0);
  const seen = new Set();
  const unique = items.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.map((item) => `- ${item}`).join("\n");
}

export function outlineFromText(text) {
  const language = detectDominantLanguage(text);
  const headings = {
    en: { outline: "Outline", section: "Section", overview: "Overview", takeaways: "Key takeaways" },
    ar: { outline: "الخطوط العريضة", section: "قسم", overview: "نظرة عامة", takeaways: "أبرز النقاط" },
    es: { outline: "Esquema", section: "Sección", overview: "Vista general", takeaways: "Puntos clave" },
    fr: { outline: "Plan", section: "Section", overview: "Aperçu", takeaways: "Points clés" },
  };
  const H = headings[language] || headings.en;
  if (!text || !text.trim()) {
    return `## ${H.outline}\n\n### ${H.overview}\n- ${language === "ar" ? "أضف محتوى وسأنظمه في خطوط عريضة." : "Add content and I will structure it as an outline."}`;
  }
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const lines = [`## ${H.outline}`, ""];
  paragraphs.forEach((paragraph, index) => {
    const sentences = paragraph.split(/(?<=[.!?،؟。])\s+/).filter(Boolean);
    const heading = (sentences[0] || `${H.section} ${index + 1}`).replace(/[.!?،؟。]+$/u, "").slice(0, 90);
    lines.push(`### ${index + 1}. ${heading}`);
    sentences.slice(1, 4).forEach((sentence) => {
      const point = sentence.replace(/[.!?،؟。]+$/u, "").trim();
      if (point) lines.push(`- ${point}`);
    });
    lines.push("");
  });
  return lines.join("\n").trim();
}

export function generateTitleFromContent(text) {
  const cleaned = (text || "").replace(/^#+\s*/gm, "").trim();
  if (!cleaned) return "Untitled note";
  const firstSentence = cleaned.split(/(?<=[.!?،؟。])\s+/)[0] || cleaned.split(/\n/)[0];
  if (firstSentence && firstSentence.length <= 70) {
    return capitalize(firstSentence.replace(/[.!?،؟。]+$/u, "").trim());
  }
  const keywords = topKeywords(cleaned).slice(0, 4);
  if (keywords.length) return capitalize(keywords.join(" "));
  return firstSentence.slice(0, 60);
}

export function extendDraft(prompt, note) {
  const language = detectDominantLanguage(note?.body || "") !== "en"
    ? detectDominantLanguage(note.body)
    : detectPromptLanguage(prompt);
  const noteKeywords = topKeywords(`${note?.title || ""} ${note?.body || ""}`).slice(0, 3);
  const anchor = noteKeywords[0] || extractDraftTopic(prompt) || note?.title || "this idea";
  if (language === "ar") {
    return [
      `بالإضافة إلى ما سبق، هناك زاوية أخرى تتعلق بـ${anchor} تستحق التوضيح.`,
      "يمكن تعميق هذه الفكرة بذكر مثال محدد يوضح كيف تنطبق على الواقع.",
      "- الفكرة الأساسية: اربطها بنتيجة يمكن قياسها.",
      "- الخطوة التالية: حدد قراراً واحداً يمكن اتخاذه هذا الأسبوع.",
    ].join("\n");
  }
  if (language === "es") {
    return [
      `Ampliando lo anterior, otro ángulo sobre ${anchor} vale la pena aclarar.`,
      "Puedes profundizarlo con un ejemplo concreto que muestre cómo se aplica en la práctica.",
      "- Idea central: conéctala con un resultado que puedas medir.",
      "- Siguiente paso: elige una decisión concreta para esta semana.",
    ].join("\n");
  }
  if (language === "fr") {
    return [
      `En prolongeant ce qui précède, un autre angle autour de ${anchor} mérite d'être précisé.`,
      "Approfondis-le avec un exemple concret qui montre comment cela se joue dans la pratique.",
      "- Idée clé : relie-la à un résultat mesurable.",
      "- Prochaine étape : choisis une décision précise pour cette semaine.",
    ].join("\n");
  }
  return [
    `Building on that, another angle around ${anchor} is worth spelling out.`,
    "Go deeper with one concrete example that shows how this plays out in practice.",
    "- The core idea: connect it to an outcome you can measure.",
    "- Next step: pick one decision you can make this week.",
  ].join("\n");
}

export function draftAnswer(prompt, note) {
  const language = detectPromptLanguage(prompt) !== "en"
    ? detectPromptLanguage(prompt)
    : detectDominantLanguage(note?.body || "");
  const question = prompt
    .replace(/^(what|why|how|when|where|who|which|is|are|can|should|does|do|will|would|could)\b\s*/i, "")
    .replace(/^(ما|لماذا|كيف|متى|أين|من|هل)\s*/u, "")
    .replace(/[?؟.!]+$/u, "")
    .trim() || "this";
  if (language === "ar") {
    return [
      `## إجابة`,
      `سؤالك حول ${question} يستحق تفكيراً هادئاً.`,
      "الإطار: عرّف المصطلحات، اذكر السياق، ثم قدم إجابة واضحة مع سبب.",
      "- ابدأ بجملة واحدة تلخص الإجابة.",
      "- أضف مثالاً واحداً يجعلها ملموسة.",
      "- انتهِ بخطوة تالية أو قرار يمكن اتخاذه.",
    ].join("\n");
  }
  if (language === "es") {
    return [
      `## Respuesta`,
      `Tu pregunta sobre ${question} merece una respuesta reflexiva.`,
      "Marco: define los términos, nombra el contexto y da una respuesta clara con una razón.",
      "- Empieza con una frase que resuma la respuesta.",
      "- Añade un ejemplo que la haga concreta.",
      "- Cierra con un siguiente paso o decisión.",
    ].join("\n");
  }
  if (language === "fr") {
    return [
      `## Réponse`,
      `Ta question sur ${question} mérite une réflexion posée.`,
      "Cadre : définis les termes, nomme le contexte, puis donne une réponse claire avec une raison.",
      "- Commence par une phrase qui résume la réponse.",
      "- Ajoute un exemple pour la rendre concrète.",
      "- Termine par une prochaine étape ou une décision.",
    ].join("\n");
  }
  return [
    `## Answer`,
    `Your question about ${question} deserves a thoughtful take.`,
    "Frame it like this: define the terms, name the context, then give a clear answer with a reason.",
    "- Open with one sentence that captures the answer.",
    "- Add one example that makes it concrete.",
    "- Close with a next step or a decision you can make.",
  ].join("\n");
}

export function draftExplanation(topic, note) {
  const language = detectDominantLanguage(note?.body || "");
  const safeTopic = topic || (note?.title || "this idea");
  if (language === "ar") {
    return [
      `## ${safeTopic}`,
      `يمكن فهم ${safeTopic} كفكرة تجمع بين عدة عناصر مترابطة.`,
      "- التعريف: صف الفكرة في جملة واحدة، ثم اذكر الغرض منها.",
      "- السياق: أضف مثالاً من الحياة اليومية يوضح كيف تعمل.",
      "- لماذا تهم: اربطها بنتيجة أو قرار يمكن اتخاذه الآن.",
    ].join("\n");
  }
  if (language === "es") {
    return [
      `## ${capitalize(safeTopic)}`,
      `${capitalize(safeTopic)} se puede entender como una idea que reúne varias piezas conectadas.`,
      "- Definición: describe la idea en una frase y di para qué sirve.",
      "- Contexto: añade un ejemplo cotidiano que la haga concreta.",
      "- Por qué importa: conéctala con un resultado o decisión.",
    ].join("\n");
  }
  if (language === "fr") {
    return [
      `## ${capitalize(safeTopic)}`,
      `${capitalize(safeTopic)} peut être compris comme une idée qui relie plusieurs éléments.`,
      "- Définition : décris l'idée en une phrase et dis à quoi elle sert.",
      "- Contexte : ajoute un exemple concret qui la rend claire.",
      "- Pourquoi c'est important : relie-la à un résultat ou une décision.",
    ].join("\n");
  }
  return [
    `## ${capitalize(safeTopic)}`,
    `${capitalize(safeTopic)} can be understood as an idea that pulls together a few connected pieces.`,
    "- Definition: describe the idea in one sentence and say what it is for.",
    "- Context: add an everyday example that makes it concrete.",
    "- Why it matters: connect it to an outcome or decision you can make now.",
  ].join("\n");
}

export function detectTone(prompt) {
  const p = (prompt || "").toLowerCase();
  if (/\b(concise|shorter|briefer?|terse|tight|snappy|concisely|tersely)\b/.test(p)) return "concise";
  if (/\b(formal|professional|business|serious|academic|formally|professionally)\b/.test(p)) return "formal";
  if (/\b(casual|informal|relaxed|chill|chatty|casually|informally)\b/.test(p)) return "casual";
  if (/\b(warm|friendly|approachable|kind|nice|warmly|kindly)\b/.test(p)) return "friendly";
  return "formal";
}

export function rewriteWithTone(text, tone) {
  if (!text || !text.trim()) return text;
  if (tone === "concise") return shortenText(text);
  const replacements = {
    formal: [
      ["\\bcan't\\b", "cannot"], ["\\bwon't\\b", "will not"], ["\\bdon't\\b", "do not"],
      ["\\bdoesn't\\b", "does not"], ["\\bdidn't\\b", "did not"], ["\\bisn't\\b", "is not"],
      ["\\baren't\\b", "are not"], ["\\bwasn't\\b", "was not"], ["\\bweren't\\b", "were not"],
      ["\\bit's\\b", "it is"], ["\\bthat's\\b", "that is"], ["\\bwe're\\b", "we are"],
      ["\\bthey're\\b", "they are"], ["\\byou're\\b", "you are"], ["\\bi'm\\b", "I am"],
      ["\\bi'll\\b", "I will"], ["\\bwe'll\\b", "we will"], ["\\bwanna\\b", "want to"],
      ["\\bgonna\\b", "going to"], ["\\bkinda\\b", "somewhat"], ["\\bsorta\\b", "somewhat"],
      ["\\bget\\b", "obtain"], ["\\bhelp\\b", "assist"], ["\\bshow\\b", "demonstrate"],
      ["\\bstart\\b", "commence"], ["\\bstuff\\b", "material"], ["\\bthings\\b", "items"],
    ],
    casual: [
      ["\\bcannot\\b", "can't"], ["\\bwill not\\b", "won't"], ["\\bdo not\\b", "don't"],
      ["\\bit is\\b", "it's"], ["\\bwe are\\b", "we're"], ["\\bthey are\\b", "they're"],
      ["\\byou are\\b", "you're"], ["\\bI am\\b", "I'm"], ["\\bthat is\\b", "that's"],
      ["\\bobtain\\b", "get"], ["\\bassist\\b", "help"], ["\\bcommence\\b", "start"],
      ["\\butilize\\b", "use"], ["\\bdemonstrate\\b", "show"], ["\\bhowever\\b", "but"],
      ["\\btherefore\\b", "so"], ["\\bconsequently\\b", "so"], ["\\badditionally\\b", "also"],
    ],
    friendly: [
      ["\\bhi\\b", "hey there"], ["\\bhello\\b", "hey"], ["\\butilize\\b", "use"],
      ["\\bassistance\\b", "a hand"], ["\\bhowever\\b", "though"], ["\\bimmediately\\b", "right away"],
    ],
  };
  const list = replacements[tone] || replacements.formal;
  let result = text;
  for (const [pattern, replacement] of list) {
    result = result.replace(new RegExp(pattern, "gi"), (match) =>
      match[0] === match[0].toUpperCase() ? capitalize(replacement) : replacement
    );
  }
  return result;
}

export function isQuestion(prompt) {
  if (!prompt) return false;
  const trimmed = prompt.trim();
  if (/[?؟]/.test(trimmed)) return true;
  const lower = trimmed.toLowerCase();
  if (/^(what|why|how|when|where|who|which|whose|whom|is|are|can|should|does|do|did|will|would|could|may|might)\b/.test(lower)) return true;
  if (/^(ما|لماذا|كيف|متى|أين|من|هل|أ)\s/u.test(trimmed)) return true;
  return false;
}

function extractExplainTopic(prompt) {
  const match = prompt.match(/(?:explain|clarify|elaborate on|what does|what is|help me understand)\s+(?:me\s+)?(?:the\s+|a\s+|an\s+)?(.+?)(?:\s+(?:mean|means|please))?[?.!]*$/i);
  if (match) return match[1].trim();
  const arabicMatch = prompt.match(/(?:اشرح|وضح|فسر)\s+(?:لي\s+)?(.+?)[?؟.!]*$/u);
  if (arabicMatch) return arabicMatch[1].trim();
  return null;
}

export function parseAiIntent(prompt) {
  const normalized = prompt.trim().toLowerCase();
  const raw = prompt.trim();
  if (!normalized) return "empty";
  if (isTranslatePrompt(prompt)) return "translate";
  if (/\b(undo|restore)\b/.test(normalized) || /(تراجع|استرجع)/u.test(raw)) return "undo";
  if (/\b(delete|clear|remove|erase|wipe)\b.*\b(everything|all notes|all|workspace)\b/.test(normalized)) return "deleteAll";
  if (/\b(delete|remove|erase)\b.*\b(current|this note|note)\b/.test(normalized)) return "deleteCurrent";
  if (/\b(clear|empty)\b.*\b(current|this note|body|page)\b/.test(normalized)) return "clearCurrent";
  if (/\b(new|create|make)\b.*\b(note|page)\b/.test(normalized)) return "createNote";
  if (/\b(fix|correct|clean).*\b(typos?|spelling|grammar|writing)\b/.test(normalized)) return "fixTypos";
  if (/\b(outline|structure it|table of contents|toc)\b/.test(normalized)) return "outline";
  if (/\b(bullet(?:s|point)?|as (?:a )?list|to (?:a )?list|convert to (?:a )?list|make (?:it |this |a )?list|checklistify)\b/.test(normalized)) return "convertToList";
  if (/\b(title|headline|name (?:this|the|for)? ?note|suggest (?:a )?title)\b/.test(normalized)) return "generateTitle";
  if (/\b(shorter|shorten|make (?:it |this )?(?:short|shorter|brief|concise|tight)|trim|condense|tl;dr)\b/.test(normalized)) return "shorten";
  if (/\b(continue|keep going|extend|expand|another paragraph|add more|write more|more please)\b/.test(normalized) || /(أكمل|واصل|أضف المزيد|زد)/u.test(raw)) return "continue";
  if (/\b(rewrite|paraphrase|rephrase|redo|rework|say (?:it|this) (?:differently|another way)|make (?:it|this) (?:more )?(?:formal|casual|professional|friendly))\b/.test(normalized)) return "rewrite";
  if (/\b(explain|clarify|elaborate|what does .+ mean|help me understand)\b/.test(normalized) || /(اشرح|وضح|فسر)/u.test(raw)) return "explain";
  if (/\b(summarize|summary|recap)\b/.test(normalized)) return "summarize";
  if (/\b(action items|tasks|todo|to-do|checklist)\b/.test(normalized)) return "tasks";
  if (/\b(tags?|organize|categorize)\b/.test(normalized)) return "tags";
  if (/\b(ideas?|brainstorm|inspire|suggestions?)\b/.test(normalized)) return "ideas";
  if (/\b(improve|make better|polish|refine)\b/.test(normalized)) return "improve";
  if (isWritePrompt(prompt)) return "write";
  if (isQuestion(prompt)) return "answer";
  if (/\b(shortcuts?|help|commands?)\b/.test(normalized)) return "shortcuts";
  if (/\b(search|find|look for)\b/.test(normalized)) return "search";
  return "write";
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
    case "translate": {
      const targetLang = detectTargetLanguage(prompt, "en");
      const sourceLang = detectDominantLanguage(note.body);
      const targetName = LANGUAGE_NAMES[targetLang] || targetLang.toUpperCase();
      return {
        intent,
        action: "translate",
        note,
        sourceLang,
        targetLang,
        title: `Translating to ${targetName}`,
        lines: [`Reaching the translation service for ${targetName}…`],
      };
    }
    case "continue": {
      if (!note.body.trim()) {
        return {
          intent,
          action: "respond",
          title: "Nothing to continue yet",
          lines: ["Add a first sentence and I will extend the thought."],
        };
      }
      const extension = extendDraft(prompt, note);
      const nextBody = `${note.body.trim()}\n\n${extension}`;
      return {
        intent,
        action: "updateNote",
        note: { ...note, body: nextBody, updatedAt: Date.now() },
        title: "Note extended",
        lines: ["Added a new paragraph that keeps the thought going.", "Works in every supported language."],
      };
    }
    case "shorten": {
      const shortened = shortenText(note.body);
      if (!note.body.trim() || shortened === note.body.trim()) {
        return {
          intent,
          action: "respond",
          title: "Already tight",
          lines: ["The note is already short. Add more content and I can trim it."],
        };
      }
      return {
        intent,
        action: "updateNote",
        note: { ...note, body: shortened, updatedAt: Date.now() },
        title: "Shortened",
        lines: ["Trimmed the note to its core sentences.", "Type undo in the note to revert."],
      };
    }
    case "outline": {
      const outline = outlineFromText(note.body);
      return {
        intent,
        action: "updateNote",
        note: { ...note, body: outline, updatedAt: Date.now() },
        title: "Outline created",
        lines: ["Restructured the note into headings and bullets."],
      };
    }
    case "convertToList": {
      if (!note.body.trim()) {
        return {
          intent,
          action: "respond",
          title: "Nothing to list yet",
          lines: ["Add some sentences and I will turn them into a list."],
        };
      }
      const list = toBulletList(note.body);
      return {
        intent,
        action: "updateNote",
        note: { ...note, body: list, updatedAt: Date.now() },
        title: "Turned into a list",
        lines: ["Converted your paragraphs into bullet points."],
      };
    }
    case "generateTitle": {
      const newTitle = generateTitleFromContent(note.body);
      if (newTitle === note.title) {
        return {
          intent,
          action: "respond",
          title: "Title already fits",
          lines: [`Current title "${note.title}" is a strong match for the content.`],
        };
      }
      return {
        intent,
        action: "updateNote",
        note: { ...note, title: newTitle, updatedAt: Date.now() },
        title: "Title suggested",
        lines: [`Renamed the note to "${newTitle}".`],
      };
    }
    case "rewrite": {
      if (!note.body.trim()) {
        return {
          intent,
          action: "respond",
          title: "Nothing to rewrite",
          lines: ["Write a sentence or two first, then ask me to rewrite in any tone."],
        };
      }
      const tone = detectTone(prompt);
      const rewritten = rewriteWithTone(note.body, tone);
      if (rewritten === note.body) {
        return {
          intent,
          action: "respond",
          title: `Already ${tone}`,
          lines: ["The note already reads in that tone."],
        };
      }
      return {
        intent,
        action: "updateNote",
        note: { ...note, body: rewritten, updatedAt: Date.now() },
        title: `Rewritten (${tone})`,
        lines: [`Applied a ${tone} rewrite. Type undo to revert.`],
      };
    }
    case "explain": {
      const topic = extractExplainTopic(prompt) || topKeywords(note.body)[0] || note.title || "this idea";
      const explanation = draftExplanation(topic, note);
      const nextBody = note.body.trim() ? `${note.body.trim()}\n\n${explanation}` : explanation;
      return {
        intent,
        action: "updateNote",
        note: { ...note, body: nextBody, updatedAt: Date.now() },
        title: "Explanation added",
        lines: [`Explained ${topic} inside the note.`],
      };
    }
    case "answer": {
      const answer = draftAnswer(prompt, note);
      const nextBody = note.body.trim() ? `${note.body.trim()}\n\n${answer}` : answer;
      return {
        intent,
        action: "updateNote",
        note: { ...note, body: nextBody, updatedAt: Date.now() },
        title: "Answered in the note",
        lines: ["Drafted a thoughtful answer directly in the note."],
      };
    }
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

  window.setTimeout(() => document.body.classList.add("booted"), 3600);

  const splash = document.getElementById("splash");
  if (splash) {
    window.setTimeout(() => splash.remove(), 3300);
  }
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

const BODY_STREAM_INTENTS = new Set([
  "write", "continue", "explain", "answer",
  "shorten", "outline", "convertToList", "rewrite",
]);

const STREAM_LABELS = {
  write: "Notari is writing",
  continue: "Notari is continuing",
  explain: "Notari is explaining",
  answer: "Notari is answering",
  shorten: "Notari is trimming",
  outline: "Notari is outlining",
  convertToList: "Notari is listing",
  rewrite: "Notari is rewriting",
  translate: "Notari is translating",
};

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
    await sleep(900);

    const result = runAiCommand({
      prompt,
      note: currentNote,
      notes: state.notes,
      lastDeleted: state.lastDeleted,
    });

    if (result.action === "translate") {
      await handleTranslate(currentNote, result);
      return;
    }

    if (result.action === "updateNote" && BODY_STREAM_INTENTS.has(result.intent) && result.note.body !== currentNote.body) {
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

async function handleTranslate(currentNote, result) {
  const targetName = LANGUAGE_NAMES[result.targetLang] || result.targetLang.toUpperCase();
  const sourceName = LANGUAGE_NAMES[result.sourceLang] || result.sourceLang.toUpperCase();

  if (!currentNote.body.trim()) {
    const emptyResult = {
      intent: "translate",
      action: "respond",
      title: "Nothing to translate",
      lines: ["Write some text in the note first, then ask me to translate."],
    };
    await streamAssistantResponse(emptyResult);
    showToast(emptyResult.title);
    return;
  }

  showThinkingIndicator(`Translating ${sourceName} → ${targetName}`);
  try {
    const translated = await translateViaApi(currentNote.body, result.sourceLang, result.targetLang);
    if (!translated || !translated.trim()) {
      throw new Error("Empty translation");
    }
    const divider = "\n\n— — —\n\n";
    const nextBody = `${currentNote.body.trim()}${divider}${translated.trim()}`;
    const updateResult = {
      intent: "translate",
      action: "updateNote",
      note: { ...currentNote, body: nextBody, updatedAt: Date.now() },
      title: `Translated to ${targetName}`,
      lines: [
        `Added the ${targetName} translation below the original.`,
        "Powered by MyMemory. Type undo to remove it.",
      ],
    };
    await streamWriteIntoNote(currentNote, updateResult);
    await streamAssistantResponse(updateResult);
    showToast(updateResult.title);
  } catch (error) {
    const errorResult = {
      intent: "translate",
      action: "respond",
      title: "Translation unavailable",
      lines: [
        "I could not reach the translation service from this network.",
        "Check your internet or try again in a moment. I can still rewrite, shorten, outline, or continue in any language.",
      ],
    };
    await streamAssistantResponse(errorResult);
    showToast(errorResult.title);
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
  const label = STREAM_LABELS[result.intent] || "Notari is writing";
  showThinkingIndicator(label);
  await sleep(420);

  const target = result.note;
  const oldBody = currentNote.body;
  const finalBody = target.body;
  const appending = Boolean(oldBody) && finalBody.startsWith(oldBody);
  const startBody = appending ? oldBody : "";
  const streamText = appending ? finalBody.slice(oldBody.length) : finalBody;

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

  const tokens = tokenizeForStream(streamText);
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

  filtered.forEach((note, index) => {
    const button = document.createElement("button");
    button.className = `note-item${note.id === state.activeId ? " active" : ""}`;
    button.type = "button";
    button.style.setProperty("--stagger", String(index));
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
