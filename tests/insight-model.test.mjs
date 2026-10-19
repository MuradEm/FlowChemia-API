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
