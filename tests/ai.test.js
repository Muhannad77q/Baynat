import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSearchTrailAnswer,
  calculatePopulationJump,
  ksaPopulationSeries,
  parseSearchIntent,
  themeDirections,
} from "../app.js";

test("classifies Search Trail prompt types", () => {
  assert.equal(parseSearchIntent("People living in KSA for the past 10 years and changes in 2025"), "population");
  assert.equal(parseSearchIntent("School science search about photosynthesis with ideas"), "school");
  assert.equal(parseSearchIntent("Generate a high quality photo of a stadium"), "photo");
  assert.equal(parseSearchIntent("Latest football match score and momentum"), "football");
  assert.equal(parseSearchIntent(""), "empty");
  assert.equal(parseSearchIntent("Explain why oceans are blue"), "general");
});

test("calculates the highlighted 2025 population jump", () => {
  assert.deepEqual(calculatePopulationJump(ksaPopulationSeries, 2024, 2025), {
    fromYear: 2024,
    toYear: 2025,
    change: 0.6,
    percent: 1.6,
  });
});

test("builds population answer with ten-year graph data", () => {
  const answer = buildSearchTrailAnswer("people living in KSA from past 10 years and show 2025 jump");

  assert.equal(answer.intent, "population");
  assert.equal(answer.graph.length, 10);
  assert.equal(answer.graph.at(-1).year, 2025);
  assert.match(answer.bullets.join(" "), /\+6\.5M/);
  assert.match(answer.bullets.join(" "), /\+0\.6M/);
});

test("builds school science answer with project ideas", () => {
  const answer = buildSearchTrailAnswer("got search in school for science it write it and give ideas");

  assert.equal(answer.intent, "school");
  assert.match(answer.summary, /school research/i);
  assert.ok(answer.bullets.some((bullet) => bullet.includes("Project idea")));
});

test("builds image generation answer with editable media prompt", () => {
  const answer = buildSearchTrailAnswer("generate photos high quality graphics football stadium");

  assert.equal(answer.intent, "photo");
  assert.match(answer.bullets.join(" "), /4K realism/);
  assert.equal(answer.media.label, "Generated photo direction");
});

test("includes ten editable dark theme directions", () => {
  assert.equal(themeDirections.length, 10);
  assert.equal(new Set(themeDirections.map((theme) => theme.name)).size, 10);
});
