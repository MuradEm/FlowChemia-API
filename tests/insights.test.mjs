import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { createApp } from "../dist/src/app.js";

test("persisted insights and role-specific team projections", async (t) => {
  const original = process.env.DATABASE_URL;
  const adminURL = new URL(original);
  adminURL.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminURL.toString() });
  await admin.connect();
  const name = "flowchemia_insights_" + randomUUID().replaceAll("-", "");
  const url = new URL(original);
  url.pathname = "/" + name;
  let app, db;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    process.env.DATABASE_URL = url.toString();
    const password = "fictional-insight-" + randomUUID();
    for (const [args, input] of [
      [["node_modules/prisma/build/index.js", "migrate", "deploy"], undefined],
      [
        ["dist/scripts/bootstrap.js"],
        JSON.stringify({
          email: "owner@example.test",
          displayName: "Owner",
          companyName: "Insight Company",
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
    db = new pg.Client({ connectionString: url.toString() });
    await db.connect();
    app = await createApp(false);
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    async function req(method, path, token, body, status = 200) {
      const r = await fetch(base + path, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await r.json();
      assert.equal(r.status, status, `${path}: ${JSON.stringify(json)}`);
      return json;
    }
    const login = async (email) =>
      (await req("POST", "/auth/login", null, { email, password })).token;
    const owner = await login("owner@example.test");
    const org = (await req("GET", "/me", owner)).memberships[0].organization.id;
    const root = "/organizations/" + org;
    async function invite(label, role = "EMPLOYEE") {
      const email = label + "@example.test";
      const inv = await req(
        "POST",
        root + "/invitations",
        owner,
        { email, role },
        201,
      );
      const m = (
        await req(
          "POST",
          "/invitations/accept",
          null,
          { token: inv.token, displayName: label, password },
          201,
        )
      ).membership;
      return { id: m.id, token: await login(email) };
    }
    const hr = await invite("HR", "HR_ADMIN"),
      alice = await invite("Alice"),
      bob = await invite("Bob"),
      carla = await invite("Carla");
    await req("POST", root + "/questions/import-standard", hr.token, {});
    await req("PATCH", root + "/feedback-policy", owner, {
      questionSelection: "ADAPTIVE",
    });
    const team = await req(
      "POST",
      root + "/teams",
      owner,
      { name: "PLC Team" },
      201,
    );
    for (const person of [alice, bob, carla])
      await req(
        "POST",
        `${root}/teams/${team.id}/members`,
        owner,
        { membershipId: person.id },
        201,
      );
    const endpoint = `${root}/teams/${team.id}/insights`;
    await t.test(
      "empty overview returns no edges and no baseline masquerading as feedback",
      async () => {
        const overview = await req("GET", endpoint, hr.token);
        assert.equal(overview.relationships.length, 0);
        assert.equal(overview.employees.length, 3);
        assert.ok(overview.employees.every(e=>e.skillPresentation==='BANDS' && e.skills.length===5 && e.skills.every(s=>s.indicator.band===null)));
        assert.ok(
          overview.employees.every((e) =>
            e.skills.every((s) => s.indicator.state === "UNKNOWN"),
          ),
        );
        const numericKeys =
          /"(score|combinedScore|firstToSecondScore|confidence|rating|details)":/;
        assert.ok(!numericKeys.test(JSON.stringify(overview)));
        assert.equal((await req("GET", endpoint, owner)).mode, "ROSTER");
        assert.ok(
          (await req("GET", endpoint, owner)).employees.every(
            (e) => e.skills === null,
          ),
        );
      },
    );
    await req(
      "POST",
      `${root}/teams/${team.id}/access`,
      owner,
      { membershipId: alice.id, role: "MANAGER" },
      201,
    );
    await req(
      "POST",
      `${root}/teams/${team.id}/surveys/milestone`,
      owner,
      {
        participantMembershipIds: [alice.id, bob.id],
        closesAt: new Date(Date.now() + 86400000).toISOString(),
      },
      201,
    );
    async function submit(person, rating) {
      const a = (
        await req("GET", root + "/assignments/my-open", person.token)
      )[0];
      const d = await req("GET", root + "/assignments/" + a.id, person.token);
      await req(
        "POST",
        root + "/assignments/" + a.id + "/submit",
        person.token,
        {
          answers: d.questions.map((q) => ({
            questionVersionId: q.id,
            rating,
          })),
        },
      );
      return d;
    }
    await t.test(
      "completion atomically saves numerical summaries; null observations stay unobserved",
      async () => {
        await submit(alice, 5);
        const skills = await db.query(
          'SELECT score,details FROM "SkillInsight" WHERE "membershipId"=$1 AND "modelVersion"=$2',
          [bob.id, "baseline-70-v1"],
        );
        assert.equal(skills.rows.length, 5);
        assert.ok(skills.rows.some((r) => r.score > 70));
        assert.ok(skills.rows.every((r) => r.details));
        const pair = await db.query(
          'SELECT * FROM "PairInsight" WHERE "orgId"=$1',
          [org],
        );
        assert.equal(pair.rows.length, 1);
        assert.equal(pair.rows[0].combinedScore, null);
        await submit(bob, null);
        const full = await req(
          "GET",
          endpoint + "?focus=" + alice.id,
          hr.token,
        );
        const relation = full.relationships.find((p) =>
          [p.firstMembershipId, p.secondMembershipId].includes(bob.id),
        );
        assert.equal(relation.combined, null);
        const incoming =
          relation.firstMembershipId === bob.id
            ? relation.firstToSecond
            : relation.secondToFirst;
        assert.equal(incoming.enjoyment.state, "UNKNOWN");
      },
    );
    await req(
      "POST",
      `${root}/teams/${team.id}/surveys/milestone`,
      owner,
      {
        participantMembershipIds: [alice.id, bob.id],
        closesAt: new Date(Date.now() + 86400000).toISOString(),
      },
      201,
    );
    await submit(alice, 4);
    await submit(bob, 1);
    await t.test(
      "self pairs withhold incoming and combined results from managers and employees at API layer",
      async () => {
        const selected = await req(
          "GET",
          endpoint + "?focus=" + alice.id,
          alice.token,
        );
        assert.equal(selected.relationships.length, 2);
        for (const p of selected.relationships) {
          assert.equal(p.visibility, "OWN_EXPERIENCE");
          assert.equal(p.combined, null);
          assert.equal(
            p.firstMembershipId === alice.id
              ? p.secondToFirst
              : p.firstToSecond,
            null,
          );
        }
        const managerOther = await req(
          "GET",
          endpoint + "?focus=" + bob.id,
          alice.token,
        );
        const otherPair = managerOther.relationships.find((p) =>
          [p.firstMembershipId, p.secondMembershipId].includes(carla.id),
        );
        assert.equal(otherPair.visibility, "BOTH_DIRECTIONS");
        const employee = await req(
          "GET",
          endpoint + "?focus=" + bob.id,
          bob.token,
        );
        assert.equal(employee.mode, "PERSONAL");
        assert.ok(
          employee.employees
            .filter((e) => e.membershipId !== bob.id)
            .every((e) => e.skills === null),
        );
        assert.ok(employee.relationships.every((p) => p.combined === null));
        const full = await req(
          "GET",
          endpoint + "?focus=" + alice.id,
          hr.token,
        );
        assert.ok(full.relationships.some((p) => p.combined));
        assert.ok(!/"score":/.test(JSON.stringify(full)));
      },
    );
    await t.test(
      "focus is team-scoped; role revocation immediately changes projections",
      async () => {
        await req(
          "GET",
          endpoint + "?focus=" + randomUUID(),
          hr.token,
          undefined,
          404,
        );
        const foreign = (
          await req("POST", "/organizations", owner, { name: "Foreign" }, 201)
        ).organization;
        await req(
          "GET",
          `/organizations/${foreign.id}/teams/${team.id}/insights`,
          hr.token,
          undefined,
          404,
        );
        await req(
          "DELETE",
          `${root}/teams/${team.id}/access/${alice.id}`,
          owner,
        );
        assert.equal(
          (await req("GET", endpoint, alice.token)).mode,
          "PERSONAL",
        );
      },
    );
    await t.test(
      "history follows employees into a new project and persisted summaries are read without recomputation",
      async () => {
        const next = await req(
          "POST",
          root + "/teams",
          owner,
          { name: "New PLC project" },
          201,
        );
        for (const person of [alice, bob])
          await req(
            "POST",
            `${root}/teams/${next.id}/members`,
            owner,
            { membershipId: person.id },
            201,
          );
        const before = await db.query(
          'SELECT "computedAt" FROM "SkillInsight" WHERE "membershipId"=$1 ORDER BY "skillId"',
          [bob.id],
        );
        const view = await req(
          "GET",
          `${root}/teams/${next.id}/insights`,
          hr.token,
        );
        assert.ok(
          view.employees
            .find((e) => e.membershipId === bob.id)
            .skills.some((s) => s.indicator.reports > 0),
        );
        const after = await db.query(
          'SELECT "computedAt" FROM "SkillInsight" WHERE "membershipId"=$1 ORDER BY "skillId"',
          [bob.id],
        );
        assert.deepEqual(after.rows, before.rows);
      },
    );
    await t.test("failed summary persistence rolls back answers and credit together", async () => {
      await req("POST", `${root}/teams/${team.id}/surveys/milestone`, owner, {participantMembershipIds:[alice.id,bob.id],closesAt:new Date(Date.now()+86400000).toISOString()},201);
      const assignment=(await req("GET",root+"/assignments/my-open",alice.token))[0];
      const detail=await req("GET",root+"/assignments/"+assignment.id,alice.token);
      const body={answers:detail.questions.map(q=>({questionVersionId:q.id,rating:3}))};
      await db.query(`CREATE FUNCTION fail_insight_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test write failure'; END; $$; CREATE TRIGGER fail_insight_write BEFORE UPDATE ON "SkillInsight" FOR EACH ROW EXECUTE FUNCTION fail_insight_write()`);
      await req("POST",root+"/assignments/"+assignment.id+"/submit",alice.token,body,500);
      assert.equal((await db.query('SELECT status FROM "Assignment" WHERE id=$1',[assignment.id])).rows[0].status,'OPEN');
      assert.equal((await db.query('SELECT count(*) n FROM "Answer" WHERE "assignmentId"=$1',[assignment.id])).rows[0].n,'0');
      assert.equal((await db.query('SELECT count(*) n FROM "ParticipationCredit" WHERE "assignmentId"=$1',[assignment.id])).rows[0].n,'0');
      await db.query('DROP TRIGGER fail_insight_write ON "SkillInsight"; DROP FUNCTION fail_insight_write()');
      await req("POST",root+"/assignments/"+assignment.id+"/submit",alice.token,body);
    });
    await t.test('skill bands are projected from cached scores without exposing exact values',async()=>{
      const skills=(await db.query('SELECT id FROM "Skill" WHERE "orgId"=$1 ORDER BY name',[org])).rows;
      const bands=['RED','ORANGE','YELLOW','LIGHT_GREEN','GREEN'];
      const scores=[10,30,50,70,90];
      for(let i=0;i<skills.length;i++) {
        const details={score:scores[i],reports:8,reviewers:3,firstAt:new Date(Date.now()-28*86400000).toISOString(),lastAt:new Date().toISOString()};
        await db.query('UPDATE "SkillInsight" SET score=$1, details=$2::jsonb WHERE "membershipId"=$3 AND "skillId"=$4',[scores[i],JSON.stringify(details),bob.id,skills[i].id]);
      }
      const manager=(await req('GET',endpoint,hr.token)).employees.find(e=>e.membershipId===bob.id);
      assert.equal(manager.skillPresentation,'BANDS');
      assert.deepEqual(manager.skills.map(s=>s.indicator.band),bands);
      const own=(await req('GET',endpoint,bob.token)).employees.find(e=>e.membershipId===bob.id);
      assert.equal(own.skillPresentation,'SUMMARY');
      assert.deepEqual(own.skills.map(s=>s.indicator.label),['Room for improvement','Room for improvement','On the way','Doing well','Doing well']);
      assert.ok(!/"score":/.test(JSON.stringify(manager)));
    });
  } finally {
    await app?.close();
    await db?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
    process.env.DATABASE_URL = original;
  }
});
