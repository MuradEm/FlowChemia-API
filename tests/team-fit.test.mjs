import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeTeam } from "../src/team-fit.ts";
const people = ["a", "b", "c", "d", "e"].map((id, i) => ({
  id,
  name: id.toUpperCase(),
  bands: i === 4 ? [] : [4, 4, 5],
}));
const readable = new Set(people.map((p) => p.id));
const pair = (first, second, points, established = true) => ({
  first,
  second,
  points,
  established,
});
test("team chemistry averages established visible pairs, rounds to five and keeps missing evidence neutral", () => {
  const all = analyzeTeam(
    people,
    ["a", "b", "c"],
    [pair("a", "b", 82), pair("a", "c", 88), pair("b", "c", 84)],
    readable,
    "hr",
  );
  assert.equal(all.teamAnalysis.chemistry, 85);
  assert.equal(all.teamAnalysis.evidence, "ESTABLISHED");
  assert.equal(all.teamAnalysis.label, "Good chemistry");
  assert.equal(all.teamAnalysis.teamwork, "Strong teamwork potential");
  const partial = analyzeTeam(
    people,
    ["a", "b", "c"],
    [pair("a", "b", 85), pair("b", "c", 30, false)],
    readable,
    "hr",
  );
  assert.equal(partial.teamAnalysis.chemistry, 85);
  assert.equal(partial.teamAnalysis.evidence, "LIMITED");
  assert.equal(partial.teamAnalysis.knownPairs, 1);
  assert.equal(partial.teamAnalysis.totalPairs, 3);
  assert.match(partial.teamAnalysis.teamwork, /More feedback/);
  const none = analyzeTeam(people, ["a", "b"], [], readable, "hr");
  assert.equal(none.teamAnalysis.chemistry, null);
  assert.equal(none.teamAnalysis.evidence, "NONE");
  const low = analyzeTeam(
    people,
    ["a", "b"],
    [pair("a", "b", 40)],
    readable,
    "hr",
  );
  assert.match(low.teamAnalysis.label, /attention/);
  assert.match(low.teamAnalysis.teamwork, /Low teamwork/);
});
test("whole-team numbers and ranking cannot reveal incoming self feedback or unauthorized pair values", () => {
  const hidden = [pair("a", "b", 95), pair("a", "c", 30), pair("b", "c", 80)];
  const own = analyzeTeam(people, ["a", "b", "c"], hidden, readable, "a");
  assert.equal(own.teamAnalysis.chemistry, null);
  assert.equal(own.teamAnalysis.evidence, "RESTRICTED");
  assert.equal(own.teamAnalysis.knownPairs, 1);
  const privateOne = analyzeTeam(
    people,
    ["a", "b"],
    hidden,
    new Set(["a"]),
    "hr",
  );
  assert.equal(privateOne.teamAnalysis.chemistry, null);
  assert.equal(privateOne.teamAnalysis.knownPairs, 0);
  const before = analyzeTeam(people, ["a"], [pair("a", "d", 0)], readable, "a");
  const after = analyzeTeam(
    people,
    ["a"],
    [pair("a", "d", 100)],
    readable,
    "a",
  );
  assert.deepEqual(before.recommendations, after.recommendations);
});
test("recommendations rank team-specific category evidence, keep unknown separate, and expose no private score", () => {
  const view = analyzeTeam(
    people,
    ["a", "b"],
    [
      pair("a", "c", 95),
      pair("b", "c", 90),
      pair("a", "d", 40),
      pair("b", "d", 30),
    ],
    readable,
    "hr",
  );
  assert.deepEqual(
    view.recommendations.map((r) => r.membershipId),
    ["c", "d", "e"],
  );
  assert.equal(view.recommendations[0].fit, "STRONG");
  assert.equal(view.recommendations[2].fit, "UNKNOWN");
  assert.ok(!/"(score|points|_value)":/.test(JSON.stringify(view)));
  const reversed = analyzeTeam(
    people,
    ["b", "a"],
    [
      pair("a", "c", 95),
      pair("b", "c", 90),
      pair("a", "d", 40),
      pair("b", "d", 30),
    ],
    readable,
    "hr",
  );
  assert.deepEqual(view.recommendations, reversed.recommendations);
  const empty = analyzeTeam(people, [], [], readable, "hr");
  assert.equal(empty.teamAnalysis.chemistry, null);
  assert.match(empty.recommendations[0].label, /skill feedback/);
});
