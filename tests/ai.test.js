import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import {
  AD_DURATION,
  AD_HEIGHT,
  AD_WIDTH,
  ASSEMBLY_STEPS,
  EXPORT_FPS,
  EXPORT_FRAME_COUNT,
  INGREDIENTS,
  INTRO_FORGET_WORD,
  RENDERED_VIDEO_PATH,
  TIMELINE,
  assemblyStepPillX,
  assemblyTextTransition,
  clamp,
  easeInOutCubic,
  progressBetween,
  sceneAt,
} from "../app.js";

test("builds one contiguous 18-second advertising timeline", () => {
  assert.equal(TIMELINE[0].start, 0);
  assert.equal(TIMELINE.at(-1).end, AD_DURATION);
  assert.equal(AD_DURATION, 18_000);

  TIMELINE.slice(1).forEach((scene, index) => {
    assert.equal(scene.start, TIMELINE[index].end);
  });
});

test("defines the publish-ready render as 540 fixed 1080x1920 frames", () => {
  assert.equal(AD_WIDTH, 1_080);
  assert.equal(AD_HEIGHT, 1_920);
  assert.equal(EXPORT_FPS, 30);
  assert.equal(EXPORT_FRAME_COUNT, 540);
  assert.equal(RENDERED_VIDEO_PATH, "./assets/laththa-cake-ad-1080x1920.mp4");
});

test("ships the validated MP4 and its render manifest", async () => {
  const manifestUrl = new URL("../assets/laththa-cake-ad-1080x1920.json", import.meta.url);
  const videoUrl = new URL("../assets/laththa-cake-ad-1080x1920.mp4", import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const videoStats = await stat(videoUrl);

  assert.equal(manifest.width, AD_WIDTH);
  assert.equal(manifest.height, AD_HEIGHT);
  assert.equal(manifest.fps, EXPORT_FPS);
  assert.equal(manifest.frameCount, EXPORT_FRAME_COUNT);
  assert.equal(manifest.duration, AD_DURATION / 1_000);
  assert.equal(manifest.audioSampleRate, 48_000);
  assert.equal(manifest.audioChannels, 2);
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
  assert.ok(videoStats.size > 1_000_000);
});

test("maps playback positions to the intended ad scenes", () => {
  assert.equal(sceneAt(0).id, "intro");
  assert.equal(sceneAt(2_799).id, "intro");
  assert.equal(sceneAt(2_800).id, "ingredients");
  assert.equal(sceneAt(5_900).id, "assembly");
  assert.equal(sceneAt(14_500).id, "serving");
  assert.equal(sceneAt(18_000).id, "intro");
  assert.equal(sceneAt(-1).id, "serving");
});

test("clamps animation progress at both boundaries", () => {
  assert.equal(clamp(-0.4), 0);
  assert.equal(clamp(1.4), 1);
  assert.equal(progressBetween(400, 500, 1_000), 0);
  assert.equal(progressBetween(750, 500, 1_000), 0.5);
  assert.equal(progressBetween(1_200, 500, 1_000), 1);
});

test("uses a smooth symmetrical assembly easing curve", () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(0.5), 0.5);
  assert.equal(easeInOutCubic(1), 1);
  assert.ok(easeInOutCubic(0.25) < 0.25);
  assert.ok(easeInOutCubic(0.75) > 0.75);
});

test("hands assembly copy off on consecutive frames without overlap", () => {
  for (let frameIndex = 0; frameIndex < EXPORT_FRAME_COUNT; frameIndex += 1) {
    const time = (frameIndex * 1_000) / EXPORT_FPS;
    const { titleOut, heroIn } = assemblyTextTransition(time);
    assert.equal(titleOut > 0 && heroIn > 0, false, `copy overlaps at ${time}ms`);
  }

  const beforeHandoff = assemblyTextTransition((340 * 1_000) / EXPORT_FPS);
  const afterHandoff = assemblyTextTransition((341 * 1_000) / EXPORT_FPS);
  assert.ok(beforeHandoff.titleOut > 0);
  assert.equal(beforeHandoff.heroIn, 0);
  assert.equal(afterHandoff.titleOut, 0);
  assert.ok(afterHandoff.heroIn > 0);
});

test("lays assembly steps out right-to-left", () => {
  assert.deepEqual(
    ASSEMBLY_STEPS.map(([number, label]) => `${number} ${label}`),
    ["١ القاعدة", "٢ الكريمة", "٣ الفراولة", "٤ اللمسة"],
  );
  assert.deepEqual(ASSEMBLY_STEPS.map((_, index) => assemblyStepPillX(index)), [739, 516, 293, 70]);
});

test("uses the correct damma in the opening copy", () => {
  assert.equal(INTRO_FORGET_WORD, "تُنْسى.");
});

test("covers every featured cake ingredient exactly once", () => {
  assert.deepEqual(
    INGREDIENTS.map((ingredient) => ingredient.icon),
    ["cream", "glaze", "strawberry", "berries", "chocolate"],
  );
  assert.equal(new Set(INGREDIENTS.map((ingredient) => ingredient.name)).size, INGREDIENTS.length);
});
