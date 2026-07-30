import assert from "node:assert/strict";
import test from "node:test";
import {
  AD_DURATION,
  INGREDIENTS,
  TIMELINE,
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

test("covers every featured cake ingredient exactly once", () => {
  assert.deepEqual(
    INGREDIENTS.map((ingredient) => ingredient.icon),
    ["cream", "glaze", "strawberry", "berries", "chocolate"],
  );
  assert.equal(new Set(INGREDIENTS.map((ingredient) => ingredient.name)).size, INGREDIENTS.length);
});
