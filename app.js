export const ksaPopulationSeries = [
  { year: 2016, population: 31.8 },
  { year: 2017, population: 32.6 },
  { year: 2018, population: 33.4 },
  { year: 2019, population: 34.2 },
  { year: 2020, population: 35.0 },
  { year: 2021, population: 35.5 },
  { year: 2022, population: 36.4 },
  { year: 2023, population: 37.0 },
  { year: 2024, population: 37.7 },
  { year: 2025, population: 38.3 },
];

export const themeDirections = [
  {
    name: "Neon Observatory",
    detail: "Deep navy, cyan trails, glass answer cards, and glowing graph lines.",
    gradient: "radial-gradient(circle at 25% 20%, #66e4ff 0 10%, transparent 24%), linear-gradient(135deg, #06111f, #18255e 52%, #0bf0bd)",
  },
  {
    name: "Football Night",
    detail: "Dark stadium lights, electric green accents, match pulse panels.",
    gradient: "radial-gradient(circle at 70% 24%, #d4ff70 0 9%, transparent 22%), linear-gradient(135deg, #03080a, #102d24 52%, #39ff88)",
  },
  {
    name: "Royal Data",
    detail: "Black and gold dashboard for premium answers and statistics.",
    gradient: "radial-gradient(circle at 35% 28%, #ffd166 0 10%, transparent 25%), linear-gradient(135deg, #090806, #22170d 55%, #d49a28)",
  },
  {
    name: "Purple Engine",
    detail: "Violet search field, fast AI glow, and cinematic cards.",
    gradient: "radial-gradient(circle at 72% 24%, #ff7af5 0 10%, transparent 24%), linear-gradient(135deg, #0b0718, #241454 52%, #8a6dff)",
  },
  {
    name: "Science Lab",
    detail: "Teal formulas, school research cards, and clean experiment visuals.",
    gradient: "radial-gradient(circle at 24% 24%, #9afff0 0 10%, transparent 24%), linear-gradient(135deg, #071414, #0d323d 52%, #43e8d8)",
  },
  {
    name: "Graph Galaxy",
    detail: "Space black, bright blue bars, starfield dots, and data trails.",
    gradient: "radial-gradient(circle at 62% 30%, #ffffff 0 2%, transparent 5%), radial-gradient(circle at 28% 20%, #66e4ff 0 8%, transparent 21%), linear-gradient(135deg, #050812, #101b45 55%, #355cff)",
  },
  {
    name: "Photo Studio",
    detail: "High-contrast black, magenta light, and glossy generated image tiles.",
    gradient: "radial-gradient(circle at 35% 18%, #ff4eb8 0 11%, transparent 25%), linear-gradient(135deg, #09030a, #281127 52%, #ff78cf)",
  },
  {
    name: "Desert Signal",
    detail: "KSA-inspired dark sand, aqua routes, and map-like patterns.",
    gradient: "radial-gradient(circle at 72% 20%, #f2b36d 0 11%, transparent 26%), linear-gradient(135deg, #0f0b08, #352514 52%, #49d7c8)",
  },
  {
    name: "Matrix Trail",
    detail: "Black interface, green code glow, instant answer rhythm.",
    gradient: "radial-gradient(circle at 26% 22%, #26ff8a 0 9%, transparent 23%), linear-gradient(135deg, #020806, #072018 55%, #00c46f)",
  },
  {
    name: "Arctic Focus",
    detail: "Cool graphite, ice-blue highlights, and calm research workspace.",
    gradient: "radial-gradient(circle at 70% 22%, #b6f3ff 0 11%, transparent 25%), linear-gradient(135deg, #071018, #193148 52%, #9bdcff)",
  },
];

const answerTemplates = {
  population: {
    type: "Data answer",
    title: "KSA population: ten-year trend with 2025 highlight",
    summary:
      "This sample trail shows Saudi Arabia rising from about 31.8M people in 2016 to about 38.3M in 2025. The 2025 bar is highlighted so the latest jump is easy to compare.",
    bullets: [
      "2016 to 2025 sample change: +6.5M people, about +20.4% across the decade.",
      "2025 sample jump from 2024: +0.6M people, about +1.6% year over year.",
      "Likely drivers to research: migration, Vision 2030 projects, labor demand, birth rates, and city growth.",
      "Best next step: connect live official statistics so the graph updates with verified data.",
    ],
    graph: ksaPopulationSeries,
  },
  school: {
    type: "School helper",
    title: "Science search: clear explanation and project ideas",
    summary:
      "For school research, Search Trail gives a simple explanation first, then ideas you can turn into a paragraph, poster, or experiment.",
    bullets: [
      "Explain the topic in one short paragraph using your grade level.",
      "Add three key facts, one diagram idea, and one real-life example.",
      "Project idea: compare two plants, one with full sunlight and one with limited light, then record changes.",
      "Writing angle: start with why the science matters in daily life, then show evidence.",
    ],
  },
  photo: {
    type: "Photo generator",
    title: "High-quality image prompt ready to generate",
    summary:
      "Search Trail turns visual requests into polished prompts with subject, style, lighting, camera detail, and quality guidance.",
    bullets: [
      "Prompt: futuristic football stadium at night, glowing roof trails, packed crowd, cinematic lighting, ultra-detailed grass, 4K realism.",
      "Style: premium sports photography mixed with clean AI interface graphics.",
      "Lighting: blue rim light, neon green field glow, soft fog, high contrast.",
      "Avoid: blurry players, warped text, low-quality crowd faces, broken geometry.",
    ],
    media: {
      label: "Generated photo direction",
      copy: "Use this as the image prompt, then edit colors, stadium style, logo placement, or camera angle.",
    },
  },
  football: {
    type: "Football insight",
    title: "Match pulse: score, momentum, and key moments",
    summary:
      "For football searches, Search Trail can summarize the score, explain momentum, and highlight the moments that changed the match.",
    bullets: [
      "Score card: show current score, minute, possession, shots on target, and dangerous attacks.",
      "Momentum: explain which team is controlling space and why.",
      "Key moments: goals, missed chances, cards, substitutions, injuries, and tactical switches.",
      "Next upgrade: connect a live sports feed for real fixtures and verified match events.",
    ],
  },
  general: {
    type: "Best answer",
    title: "Answer trail prepared",
    summary:
      "Search Trail adapts the answer to your question and gives a direct response, supporting details, visuals, and next steps.",
    bullets: [
      "Start with the shortest useful answer.",
      "Add details only where they help you decide, learn, or create.",
      "Suggest a graph, image, study outline, or match card when the question needs one.",
      "Keep the dark interface readable so the best answer is easy to scan.",
    ],
  },
  empty: {
    type: "Try a prompt",
    title: "Ask Search Trail anything",
    summary:
      "Try asking about population changes, school science, photo generation, football matches, or any topic you want explained.",
    bullets: [
      "Example: people living in KSA for the past 10 years and changes in 2025.",
      "Example: help me with a school science search and give ideas.",
      "Example: generate a high quality photo of a futuristic football stadium.",
      "Example: explain the latest football match momentum.",
    ],
  },
};

let refs = {};

export function parseSearchIntent(query) {
  const normalized = query.trim().toLowerCase();

  if (!normalized) return "empty";
  if (/\b(ksa|saudi|population|people living|past 10 years|2025|graph|chart)\b/.test(normalized)) {
    return "population";
  }
  if (/\b(school|science|homework|study|experiment|photosynthesis|ideas|project)\b/.test(normalized)) {
    return "school";
  }
  if (/\b(photo|image|picture|generate|4k|quality|graphic|graphics)\b/.test(normalized)) {
    return "photo";
  }
  if (/\b(football|match|score|goal|fixture|league|stadium)\b/.test(normalized)) {
    return "football";
  }

  return "general";
}

export function calculatePopulationJump(series = ksaPopulationSeries, fromYear = 2024, toYear = 2025) {
  const from = series.find((item) => item.year === fromYear);
  const to = series.find((item) => item.year === toYear);
  if (!from || !to) return null;

  const change = Number((to.population - from.population).toFixed(1));
  const percent = Number(((change / from.population) * 100).toFixed(1));
  return { fromYear, toYear, change, percent };
}

export function buildSearchTrailAnswer(query) {
  const intent = parseSearchIntent(query);
  const template = answerTemplates[intent];

  if (intent !== "population") {
    return { intent, ...template };
  }

  const decadeChange = Number((ksaPopulationSeries.at(-1).population - ksaPopulationSeries[0].population).toFixed(1));
  const jump = calculatePopulationJump();
  return {
    intent,
    ...template,
    bullets: [
      `2016 to 2025 sample change: +${decadeChange}M people, about +20.4% across the decade.`,
      `2025 sample jump from 2024: +${jump.change}M people, about +${jump.percent}% year over year.`,
      "Likely drivers to research: migration, Vision 2030 projects, labor demand, birth rates, and city growth.",
      "Best next step: connect live official statistics so the graph updates with verified data.",
    ],
  };
}

function initApp() {
  refs = {
    form: document.querySelector("#searchForm"),
    input: document.querySelector("#searchInput"),
    answerType: document.querySelector("#answerType"),
    answerTitle: document.querySelector("#answerTitle"),
    answerSummary: document.querySelector("#answerSummary"),
    answerList: document.querySelector("#answerList"),
    chartPanel: document.querySelector("#chartPanel"),
    mediaPanel: document.querySelector("#mediaPanel"),
    themeGrid: document.querySelector("#themeGrid"),
  };

  refs.form.addEventListener("submit", (event) => {
    event.preventDefault();
    renderAnswer(refs.input.value);
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-query]");
    if (!button) return;
    refs.input.value = button.dataset.query;
    renderAnswer(button.dataset.query);
    if (!button.closest("#demo")) {
      document.querySelector("#demo").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  renderThemes();
  renderAnswer("People living in KSA for the past 10 years and what changed in 2025");
}

function renderAnswer(query) {
  const answer = buildSearchTrailAnswer(query);
  refs.answerType.textContent = answer.type;
  refs.answerTitle.textContent = answer.title;
  refs.answerSummary.textContent = answer.summary;
  refs.answerList.replaceChildren(...answer.bullets.map(renderBullet));
  renderChart(answer.graph || []);
  renderMedia(answer.media);
}

function renderBullet(text) {
  const item = document.createElement("li");
  item.textContent = text;
  return item;
}

function renderChart(series) {
  refs.chartPanel.replaceChildren();
  refs.chartPanel.hidden = series.length === 0;
  if (!series.length) return;

  const values = series.map((item) => item.population);
  const min = Math.min(...values);
  const max = Math.max(...values);

  series.forEach((item) => {
    const bar = document.createElement("div");
    bar.className = `chart-bar${item.year === 2025 ? " highlight" : ""}`;

    const fill = document.createElement("span");
    fill.style.height = `${34 + ((item.population - min) / (max - min)) * 60}%`;

    const value = document.createElement("small");
    value.className = "chart-value";
    value.textContent = `${item.population.toFixed(1)}M`;

    const year = document.createElement("small");
    year.textContent = item.year;

    bar.append(fill, value, year);
    refs.chartPanel.append(bar);
  });
}

function renderMedia(media) {
  refs.mediaPanel.replaceChildren();
  if (!media) return;

  const photo = document.createElement("div");
  photo.className = "media-photo";
  photo.textContent = media.label;

  const copy = document.createElement("div");
  copy.className = "media-copy";
  const title = document.createElement("h3");
  title.textContent = "Editable image direction";
  const text = document.createElement("p");
  text.textContent = media.copy;
  copy.append(title, text);

  refs.mediaPanel.append(photo, copy);
}

function renderThemes() {
  refs.themeGrid.replaceChildren(
    ...themeDirections.map((theme, index) => {
      const card = document.createElement("article");
      card.className = "theme-card";
      card.style.setProperty("--theme-bg", theme.gradient);

      const content = document.createElement("div");
      content.className = "theme-card-content";
      const name = document.createElement("strong");
      name.textContent = `${String(index + 1).padStart(2, "0")} ${theme.name}`;
      const detail = document.createElement("span");
      detail.textContent = theme.detail;
      content.append(name, detail);
      card.append(content);
      return card;
    })
  );
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", initApp);
}
