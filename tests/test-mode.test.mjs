import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { createApp } from "../dist/src/app.js";
import { Clock } from "../dist/src/clock.js";
import { SurveyService } from "../dist/src/surveys.js";

test("company test mode permits repeat manual batches without changing normal timing rules", async (t) => {
  const original = process.env.DATABASE_URL,
    adminURL = new URL(original);
  adminURL.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminURL.toString() });
  await admin.connect();
  const name = "flowchemia_test_mode_" + randomUUID().replaceAll("-", ""),
    url = new URL(original);
  url.pathname = "/" + name;
  let app, db;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    process.env.DATABASE_URL = url.toString();
    const password = "fictional-" + randomUUID();
    for (const [args, input] of [
      [["node_modules/prisma/build/index.js", "migrate", "deploy"], undefined],
      [
        ["dist/scripts/bootstrap.js"],
        JSON.stringify({
          email: "owner@example.test",
          displayName: "Owner",
          companyName: "Test Mode Company",
          password,
        }),
      ],
    ]) {
      const r = spawnSync(process.execPath, args, {
        env: process.env,
        input,
        encoding: "utf8",
      });
      assert.equal(r.status, 0, r.stderr);
    }
    app = await createApp(false);
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    db = new pg.Client({ connectionString: url.toString() });
    await db.connect();
    async function req(method, path, token, body, status = 200) {
      const r = await fetch(base + path, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await r.json();
      assert.equal(r.status, status, `${path}: ${JSON.stringify(result)}`);
      return result;
    }
    const login = async (email) =>
      (await req("POST", "/auth/login", null, { email, password })).token;
    const owner = await login("owner@example.test");
    const org = (await req("GET", "/me", owner)).memberships[0].organization.id,
      root = "/organizations/" + org;
    const people = [];
    for (const [label, role] of [
      ["Alice", "EMPLOYEE"],
      ["Bob", "EMPLOYEE"],
      ["Charlie", "EMPLOYEE"],
      ["HR", "HR_ADMIN"],
    ]) {
      const email = label.toLowerCase() + "@example.test",
        inv = await req(
          "POST",
          root + "/invitations",
          owner,
          { email, role },
          201,
        ),
        member = (
          await req(
            "POST",
            "/invitations/accept",
            null,
            { token: inv.token, displayName: label, password },
            201,
          )
        ).membership;
      people.push({ ...member, token: await login(email) });
    }
    const hr = people.pop();
    const [alice, bob, charlie] = people;
    const team = await req(
      "POST",
      root + "/teams",
      owner,
      { name: "PLC" },
      201,
    );
    for (const person of people)
      await req(
        "POST",
        `${root}/teams/${team.id}/members`,
        owner,
        { membershipId: person.id },
        201,
      );
    await req("POST", root + "/questions/import-standard", hr.token, {});
    await req("PATCH", root + "/feedback-policy", owner, {
      questionSelection: "ADAPTIVE",
      colleaguesPerPeriod: 2,
      automaticEnabled: true,
    });
    let now = new Date();
    app.get(Clock).now = () => new Date(now);
    const open = (person) =>
      req("GET", root + "/assignments/my-open", person.token);
    const settle = async (person) => {
      for (const a of await open(person))
        await req("POST", `${root}/assignments/${a.id}/skip`, person.token, {});
    };
    const testBatch = (requestId = randomUUID(), token = owner) =>
      req("POST", root + "/surveys/generate-test", token, { requestId });
    await t.test(
      "mode is off by default, only administrators toggle it, and settings are company-scoped",
      async () => {
        assert.equal(
          (await req("GET", root + "/feedback-policy", owner)).testMode,
          false,
        );
        await req(
          "POST",
          root + "/surveys/generate-test",
          owner,
          { requestId: randomUUID() },
          409,
        );
        await req(
          "PATCH",
          root + "/test-mode",
          alice.token,
          { enabled: true },
          403,
        );
        await req(
          "POST",
          root + "/surveys/generate-test",
          alice.token,
          { requestId: randomUUID() },
          403,
        );
        for (const body of [
          { enabled: "true" },
          { enabled: true, orgId: org },
          {},
        ])
          await req("PATCH", root + "/test-mode", owner, body, 400);
        await req(
          "POST",
          root + "/surveys/generate-test",
          owner,
          { requestId: "NORMAL" },
          400,
        );
        const foreign = (
          await req("POST", "/organizations", owner, { name: "Separate" }, 201)
        ).organization;
        await req(
          "PATCH",
          `/organizations/${foreign.id}/test-mode`,
          hr.token,
          { enabled: true },
          404,
        );
        assert.equal(
          (await req("PATCH", root + "/test-mode", hr.token, { enabled: true }))
            .testMode,
          true,
        );
        assert.equal(
          (
            await db.query(
              'SELECT "testMode" FROM "Organization" WHERE id=$1',
              [org],
            )
          ).rows[0].testMode,
          true,
        );
        assert.equal(
          (await req("GET", `/organizations/${foreign.id}`, owner)).testMode,
          false,
        );
        assert.equal((await req("GET", root, alice.token)).testMode, true);
      },
    );
    let firstId, originalPeriod;
    await t.test(
      "test batches do not consume the normal receipt; any pending survey blocks a new test batch",
      async () => {
        const id = randomUUID(),
          first = await testBatch(id);
        firstId = id;
        originalPeriod = first.periodStart;
        assert.equal(first.createdAssignments, 6);
        assert.equal(first.isTest, true);
        assert.equal((await open(hr)).length, 0);
        assert.ok(
          (await open(alice)).every((a) => a.isTest && a.closesAt === null),
        );
        const settings = await req("GET", root + "/feedback-policy", owner);
        assert.equal(settings.currentPeriodProcessed, false);
        assert.equal(settings.lastGeneration.isTest, true);
        const blocked = await testBatch();
        assert.equal(blocked.createdAssignments, 0);
        assert.equal(blocked.blockedEmployees, 3);
        const a = (await open(alice))[0];
        await req("POST", `${root}/assignments/${a.id}/skip`, alice.token, {});
        assert.equal((await testBatch()).blockedEmployees, 3);
      },
    );
    await t.test(
      "completion enables another batch immediately; request replay stays idempotent even after completion",
      async () => {
        for (const person of people) await settle(person);
        const replay = await testBatch(firstId);
        assert.equal(replay.alreadyProcessed, true);
        assert.equal(replay.createdAssignments, 0);
        const receipts = await db.query(
          'SELECT count(*) n FROM "SurveyGeneration" WHERE "orgId"=$1',
          [org],
        );
        const id = randomUUID(),
          runs = await Promise.all([testBatch(id), testBatch(id)]);
        assert.equal(
          runs.reduce((sum, r) => sum + r.createdAssignments, 0),
          6,
        );
        assert.equal(runs.filter((r) => r.alreadyProcessed).length, 1);
        assert.equal(
          Number(
            (
              await db.query(
                'SELECT count(*) n FROM "SurveyGeneration" WHERE "orgId"=$1',
                [org],
              )
            ).rows[0].n,
          ),
          Number(receipts.rows[0].n) + 1,
        );
        assert.equal((await open(alice)).length, 2);
        assert.equal(
          new Set((await open(alice)).map((a) => a.subject.membershipId)).size,
          2,
        );
        const normal = await req(
          "POST",
          root + "/surveys/generate-periodic",
          owner,
          {},
        );
        assert.equal(normal.isTest, false);
        assert.equal(normal.createdAssignments, 0);
        assert.equal(
          (await req("GET", root + "/feedback-policy", owner))
            .currentPeriodProcessed,
          true,
        );
        for (const person of people) await settle(person);
        assert.equal((await testBatch()).createdAssignments, 6);
      },
    );
    await t.test(
      "test answers and participation retain labels and update normal insights; replacements stay inside the test batch",
      async () => {
        const a = (await open(alice))[0],
          detail = await req("GET", `${root}/assignments/${a.id}`, alice.token);
        assert.equal(detail.isTest, true);
        assert.equal(detail.questions.length, 5);
        await req("POST", `${root}/assignments/${a.id}/submit`, alice.token, {
          answers: detail.questions.map((q) => ({
            questionVersionId: q.id,
            rating: 4,
          })),
        });
        assert.ok(
          (await req("GET", root + "/participation/my", alice.token)).some(
            (c) => c.isTest && c.outcome === "COMPLETED",
          ),
        );
        assert.ok(
          Number(
            (
              await db.query(
                'SELECT count(*) n FROM "SkillInsight" WHERE "orgId"=$1 AND "observationCount">0',
                [org],
              )
            ).rows[0].n,
          ) > 0,
        );
        for (const person of people) await settle(person);
        // Create a one-colleague test batch after normal policy pause applies immediately.
        await req("PATCH", root + "/feedback-policy", owner, {
          automaticEnabled: false,
          colleaguesPerPeriod: 1,
        });
        await testBatch();
        const before = (await open(alice))[0];
        const replacement = await req(
          "POST",
          `${root}/assignments/${before.id}/replace`,
          alice.token,
          {},
        );
        assert.equal(replacement.outcome, "REPLACED");
        assert.equal((await open(alice))[0].isTest, true);
        assert.notEqual(
          (await open(alice))[0].subject.membershipId,
          before.subject.membershipId,
        );
        const keys = (
          await db.query(
            'SELECT s."testRunId" FROM "Assignment" a JOIN "Survey" s ON s.id=a."surveyId" WHERE a.id=ANY($1::uuid[])',
            [[before.id, replacement.replacementAssignmentId]],
          )
        ).rows;
        assert.equal(keys[0].testRunId, keys[1].testRunId);
      },
    );
    await t.test(
      "turning mode off preserves history, blocks new test requests and restores normal limits",
      async () => {
        const before = Number(
          (
            await db.query(
              'SELECT count(*) n FROM "Assignment" WHERE "orgId"=$1',
              [org],
            )
          ).rows[0].n,
        );
        await req("PATCH", root + "/test-mode", owner, { enabled: false });
        await req(
          "POST",
          root + "/surveys/generate-test",
          owner,
          { requestId: randomUUID() },
          409,
        );
        assert.equal((await testBatch(firstId)).alreadyProcessed, true);
        assert.ok((await open(alice)).every((a) => a.isTest));
        assert.equal(
          Number(
            (
              await db.query(
                'SELECT count(*) n FROM "Assignment" WHERE "orgId"=$1',
                [org],
              )
            ).rows[0].n,
          ),
          before,
        );
        assert.equal(
          (await req("POST", root + "/surveys/generate-periodic", owner, {}))
            .createdAssignments,
          0,
        );
        await req("PATCH", root + "/test-mode", owner, { enabled: true });
        for (const person of people) await settle(person);
        const reused = randomUUID();
        const generated = await testBatch(reused);
        assert.equal(generated.isTest, true);
        // A retry in another calendar period still addresses the original test batch.
        now = new Date(Date.parse(originalPeriod) + 21 * 86400000);
        const retry = await testBatch(reused);
        assert.equal(retry.generationId, generated.generationId);
        assert.equal(retry.alreadyProcessed, true);
        await req("PATCH", root + "/feedback-policy", owner, {
          automaticEnabled: true,
        });
        const settings = await req("GET", root + "/feedback-policy", owner);
        now = new Date(Date.parse(settings.nextGenerationAt) + 1000);
        const automatic = await app.get(SurveyService).generateAutomatic(org);
        assert.equal(automatic.isTest, false);
        assert.equal(
          (await app.get(SurveyService).generateAutomatic(org))
            .alreadyProcessed,
          true,
        );
        assert.equal(
          (
            await db.query(
              'SELECT "testMode" FROM "Organization" WHERE id=$1',
              [org],
            )
          ).rows[0].testMode,
          true,
        );
      },
    );
  } finally {
    await app?.close();
    await db?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
    process.env.DATABASE_URL = original;
  }
});
