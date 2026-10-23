import { test } from "node:test";
import assert from "node:assert/strict";
import { estimate, indicator, STAR_POINTS } from "../src/insight-model.ts";
const day = 86400000,
  now = Date.parse("2026-10-19T12:00:00Z");
const row = (points, extra = {}) => ({
  author: "A",
  subject: "B",
  key: "skill",
  time: now,
  points,
  weight: 1,
  ...extra,
});
test("accepted star mapping and baseline are internal calculation weight, not real evidence", () => {
  assert.deepEqual(STAR_POINTS.slice(1), [30, 50, 65, 80, 100]);
  const empty = estimate([], now);
  assert.equal(empty.score, 70);
  assert.equal(empty.reports, 0);
  assert.equal(indicator(empty, now).state, "UNKNOWN");
  const one = estimate([row(30)], now);
  assert.ok(Math.abs(one.score - 380 / 6) < 1e-10);
  assert.equal(one.reviewers, 1);
  assert.equal(indicator(one, now).state, "EARLY");
  assert.ok(!("score" in indicator(one, now)));
});
test("same reviewer-week is capped, mappings keep relative weights, and future observations do not contribute", () => {
  const single = estimate([row(100)], now);
  const duplicate = estimate([row(100), row(100)], now);
  assert.equal(single.score, duplicate.score);
  assert.equal(duplicate.reports, 1);
  const half = estimate([row(100, { weight: 0.5 })], now);
  assert.ok(half.score < single.score);
  assert.equal(estimate([row(100, { time: now + day })], now).reports, 0);
});
test("recent repeated changes outweigh old evidence while preserving history and reviewer diversity", () => {
  const score = estimate(
    [row(30, { time: now - 84 * day }), row(100, { author: "C" })],
    now,
  );
  assert.ok(score.score > 70);
  assert.equal(score.reports, 2);
  assert.equal(score.reviewers, 2);
  assert.equal(indicator(score, now + 127 * day).state, "OLDER");
  const mature = estimate(
    Array.from({ length: 6 }, (_, i) =>
      row(100, { author: i % 2 ? "A" : "C", time: now - i * 7 * day }),
    ),
    now,
  );
  assert.equal(indicator(mature, now).state, "POSITIVE");
});

test("five skill bands use fixed boundaries without exposing scores or turning a baseline into evidence", async () => {
  const { skillIndicator } = await import("../src/insight-model.ts");
  const mature = {
    reports: 8,
    reviewers: 3,
    firstAt: new Date(now - 28 * day).toISOString(),
    lastAt: new Date(now).toISOString(),
  };
  for (const [score, band, label] of [
    [0, "RED", "Room for improvement"],
    [19.99, "RED", "Room for improvement"],
    [20, "ORANGE", "Room for improvement"],
    [39.99, "ORANGE", "Room for improvement"],
    [40, "YELLOW", "On the way"],
    [59.99, "YELLOW", "On the way"],
    [60, "LIGHT_GREEN", "Doing well"],
    [79.99, "LIGHT_GREEN", "Doing well"],
    [80, "GREEN", "Doing well"],
    [100, "GREEN", "Doing well"],
  ]) {
    const result = skillIndicator({ ...mature, score }, now);
    assert.equal(result.band, band);
    assert.equal(result.label, label);
    assert.ok(!("score" in result));
  }
  assert.equal(skillIndicator(estimate([], now), now).band, null);
  assert.equal(
    skillIndicator({ ...mature, score: 90, reports: 2 }, now).band,
    "GREEN",
  );
  assert.equal(
    skillIndicator({ ...mature, score: 90, reviewers: 1 }, now).band,
    "GREEN",
  );
  assert.equal(
    skillIndicator({ ...mature, score: 90 }, now + 127 * day).band,
    "GREEN",
  );
});

test("early and older colours retain evidence state and baseline-only remains unknown", async () => {
  const { skillIndicator } = await import("../src/insight-model.ts");
  const early = estimate([row(100)], now),
    result = skillIndicator(early, now);
  assert.equal(result.state, "EARLY");
  assert.equal(result.band, "LIGHT_GREEN");
  assert.equal(result.tone, "MIXED");
  assert.equal(result.reports, 1);
  assert.equal(result.label, "Doing well");
  assert.equal(indicator(early, now, true).label, "Mixed observations");
  assert.equal(skillIndicator(early, now + 127 * day).state, "OLDER");
  assert.equal(skillIndicator(early, now + 127 * day).band, "LIGHT_GREEN");
  const unknown = skillIndicator(estimate([], now), now);
  assert.equal(unknown.band, null);
  assert.equal(unknown.tone, "UNKNOWN");
  assert.ok(!("score" in result));
});
