import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { createApp } from "../dist/src/app.js";

test("team builder scopes previews and saves teams atomically with safe replays", async (t) => {
  const original = process.env.DATABASE_URL,
    adminUrl = new URL(original);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const name = "flowchemia_builder_" + randomUUID().replaceAll("-", ""),
    url = new URL(original);
  url.pathname = "/" + name;
  let db, app;
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
          companyName: "Builder Company",
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
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await r.json();
      assert.equal(
        r.status,
        status,
        `${method} ${path}: ${JSON.stringify(result)}`,
      );
      return result;
    }
    const owner = (
      await req("POST", "/auth/login", null, {
        email: "owner@example.test",
        password,
      })
    ).token;
    const me = await req("GET", "/me", owner),
      org = me.memberships[0].organization.id,
      root = "/organizations/" + org,
      builder = root + "/team-builder";
    const people = {};
    for (const [name, role] of [
      ["Alice", "EMPLOYEE"],
      ["Bob", "EMPLOYEE"],
      ["Carla", "EMPLOYEE"],
      ["Manager", "EMPLOYEE"],
      ["HR", "HR_ADMIN"],
      ["Outsider", "EMPLOYEE"],
    ]) {
      const email = name.toLowerCase() + "@example.test",
        inv = await req(
          "POST",
          root + "/invitations",
          owner,
          { email, role },
          201,
        ),
        joined = await req(
          "POST",
          "/invitations/accept",
          null,
          { token: inv.token, displayName: name, password },
          201,
        );
      people[name] = {
        id: joined.membership.id,
        token: (await req("POST", "/auth/login", null, { email, password }))
          .token,
      };
    }
    const {
      Alice: alice,
      Bob: bob,
      Carla: carla,
      Manager: manager,
      HR: hr,
      Outsider: outsider,
    } = people;
    await req("POST", root + "/questions/import-standard", hr.token, {});
    const draft = (extra = {}) => ({
      requestId: randomUUID(),
      name: "PLC Commissioning",
      startsAt: new Date(Date.now() - 3600000).toISOString(),
      endsAt: null,
      membershipIds: [alice.id, bob.id],
      managerIds: [manager.id],
      leaderIds: [alice.id],
      ...extra,
    });
    let created, body, teamPath;
    await t.test(
      "personal card needs no team and capabilities do not grant employee builder access",
      async () => {
        const own = await req("GET", root + "/my-card", outsider.token);
        assert.equal(own.membershipId, outsider.id);
        assert.equal(own.skillPresentation, "SUMMARY");
        assert.equal(own.skills.length, 5);
        assert.ok(own.skills.every((s) => s.indicator.band === null));
        assert.ok(!/"score":/.test(JSON.stringify(own)));
        assert.equal(
          (await req("GET", builder + "/capabilities", owner)).canCreate,
          true,
        );
        assert.equal(
          (await req("GET", builder + "/capabilities", manager.token)).canUse,
          false,
        );
        await req("GET", builder, alice.token, undefined, 403);
        await req("GET", builder, null, undefined, 401);
        await req(
          "POST",
          builder + "/preview",
          outsider.token,
          { membershipIds: [alice.id] },
          403,
        );
      },
    );
    await t.test(
      "create is atomic, excludes HR, creates no surveys and tolerates concurrent replay",
      async () => {
        const before = (await db.query('SELECT count(*)::int n FROM "Survey"'))
          .rows[0].n;
        body = draft();
        const results = await Promise.all([
          req("POST", builder + "/save", owner, body),
          req("POST", builder + "/save", owner, body),
        ]);
        assert.equal(results[0].teamId, results[1].teamId);
        assert.equal(results.filter((x) => x.alreadySaved).length, 1);
        created = results[0].teamId;
        teamPath = root + "/teams/" + created;
        assert.equal(
          (await db.query('SELECT count(*)::int n FROM "Team"')).rows[0].n,
          1,
        );
        assert.equal(
          (await req("GET", root + "/my-card", hr.token)).role,
          "HR_ADMIN",
        );
        assert.equal(
          (await req("GET", root + "/my-card", manager.token)).role,
          "MANAGER",
        );
        const team = await req("GET", teamPath, owner);
        assert.equal(team.members.length, 2);
        assert.equal(team.access.length, 2);
        assert.ok(
          team.access.some(
            (a) => a.membershipId === alice.id && a.role === "TEAM_LEADER",
          ),
        );
        assert.equal(
          (await db.query('SELECT count(*)::int n FROM "Survey"')).rows[0].n,
          before,
        );
        await req(
          "POST",
          builder + "/save",
          owner,
          { ...body, name: "Different payload" },
          409,
        );
        await req(
          "POST",
          builder + "/save",
          owner,
          draft({ membershipIds: [alice.id, hr.id] }),
          404,
        );
        assert.equal(
          (await db.query('SELECT count(*)::int n FROM "Team"')).rows[0].n,
          1,
        );
      },
    );
    await t.test(
      "candidate scopes and previews retain feedback privacy and do not draw overview edges",
      async () => {
        const ownerView = await req("GET", builder, owner);
        assert.equal(ownerView.employees.length, 6);
        assert.ok(!ownerView.employees.some((e) => e.membershipId === hr.id));
        assert.ok(
          ownerView.employees
            .filter((e) => e.membershipId !== me.memberships[0].id)
            .every((e) => e.skills === null),
        );
        const managerView = await req(
          "GET",
          builder + "?teamId=" + created,
          manager.token,
        );
        assert.deepEqual(
          new Set(managerView.employees.map((e) => e.membershipId)),
          new Set([alice.id, bob.id, manager.id]),
        );
        assert.equal(managerView.canAssignRoles, false);
        assert.ok(
          managerView.employees.find((e) => e.membershipId === bob.id).skills,
        );
        await req("GET", builder, alice.token, undefined, 403);
        const overview = await req("POST", builder + "/preview", hr.token, {
          membershipIds: [alice.id, bob.id, manager.id],
        });
        assert.equal(overview.relationships.length, 0);
        const focused = await req("POST", builder + "/preview", hr.token, {
          membershipIds: [alice.id, bob.id, manager.id],
          focus: alice.id,
        });
        assert.equal(focused.relationships.length, 2);
        assert.ok(
          focused.relationships.every(
            (p) => p.visibility === "BOTH_DIRECTIONS",
          ),
        );
        const own = await req("POST", builder + "/preview", manager.token, {
          membershipIds: [alice.id, bob.id, manager.id],
          focus: manager.id,
        });
        assert.ok(
          own.relationships.every(
            (p) =>
              p.visibility === "OWN_EXPERIENCE" &&
              [p.firstToSecond, p.secondToFirst].filter(Boolean).length === 1 &&
              p.combined === null,
          ),
        );
        await req(
          "POST",
          builder + "/preview",
          manager.token,
          { membershipIds: [alice.id, carla.id] },
          404,
        );
        await req(
          "POST",
          builder + "/preview",
          hr.token,
          { membershipIds: [alice.id], focus: bob.id },
          400,
        );
        assert.ok(
          !/"(score|details|combinedScore|rating)":/.test(
            JSON.stringify(focused),
          ),
        );
      },
    );
    await t.test(
      "validation and role changes cannot leave a partially created team",
      async () => {
        for (const invalid of [
          draft({ membershipIds: [alice.id, alice.id] }),
          draft({ leaderIds: [carla.id] }),
          draft({ leaderIds: [alice.id], managerIds: [alice.id] }),
          draft({ endsAt: new Date(Date.now() - 1000).toISOString() }),
          { ...draft(), extra: true },
        ])
          await req("POST", builder + "/save", owner, invalid, 400);
        assert.equal(
          (await db.query('SELECT count(*)::int n FROM "Team"')).rows[0].n,
          1,
        );
        const roleDraft = (
          await req("GET", builder + "?teamId=" + created, owner)
        ).draft;
        await req(
          "POST",
          builder + "/save",
          owner,
          draft({
            teamId: created,
            revision: roleDraft.revision,
            managerIds: [alice.id],
            leaderIds: undefined,
          }),
          400,
        );
        const state = (
          await req("GET", builder + "?teamId=" + created, manager.token)
        ).draft;
        await req(
          "POST",
          builder + "/save",
          manager.token,
          draft({ teamId: created, revision: state.revision }),
          403,
        );
        await req(
          "POST",
          builder + "/save",
          manager.token,
          draft({ managerIds: undefined, leaderIds: undefined }),
          403,
        );
      },
    );
    await t.test(
      "manager edits preserve history and independent manager grants; removing leaders removes their role",
      async () => {
        const before = await req("GET", teamPath, owner),
          state = (
            await req("GET", builder + "?teamId=" + created, manager.token)
          ).draft;
        const edit = draft({
          teamId: created,
          revision: state.revision,
          name: "PLC Updated",
          membershipIds: [bob.id],
          managerIds: undefined,
          leaderIds: undefined,
        });
        await req("POST", builder + "/save", manager.token, edit);
        const after = await req("GET", teamPath, owner);
        assert.equal(after.name, "PLC Updated");
        assert.equal(after.members.length, 1);
        assert.equal(
          after.members[0].id,
          before.members.find((m) => m.membershipId === bob.id).id,
        );
        assert.ok(
          after.access.some(
            (a) => a.membershipId === manager.id && a.role === "MANAGER",
          ),
        );
        assert.ok(!after.access.some((a) => a.role === "TEAM_LEADER"));
        assert.ok(
          (
            await db.query('SELECT "leftAt" FROM "TeamMember" WHERE id=$1', [
              before.members.find((m) => m.membershipId === alice.id).id,
            ])
          ).rows[0].leftAt,
        );
        const replay = await req("POST", builder + "/save", owner, body);
        assert.equal(replay.alreadySaved, true);
        assert.equal((await req("GET", teamPath, owner)).name, "PLC Updated");
      },
    );
    await t.test(
      "stale edits and concurrent saves do not overwrite another roster change",
      async () => {
        const state = (
          await req("GET", builder + "?teamId=" + created, manager.token)
        ).draft;
        await req(
          "POST",
          teamPath + "/members",
          owner,
          { membershipId: carla.id },
          201,
        );
        await req(
          "POST",
          builder + "/save",
          manager.token,
          draft({
            teamId: created,
            revision: state.revision,
            membershipIds: [bob.id],
            managerIds: undefined,
            leaderIds: undefined,
          }),
          409,
        );
        const fresh = (await req("GET", builder + "?teamId=" + created, owner))
          .draft;
        const first = draft({
          teamId: created,
          revision: fresh.revision,
          name: "First edit",
          membershipIds: fresh.membershipIds,
          managerIds: fresh.managerIds,
          leaderIds: fresh.leaderIds,
        });
        const second = {
          ...first,
          requestId: randomUUID(),
          name: "Second edit",
        };
        async function raw(b) {
          const r = await fetch(base + builder + "/save", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + owner,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(b),
          });
          await r.json();
          return r.status;
        }
        assert.deepEqual(
          (await Promise.all([raw(first), raw(second)])).sort(),
          [200, 409],
        );
        assert.equal((await req("GET", teamPath, owner)).members.length, 2);
      },
    );
    await t.test(
      "team aggregates and recommendation order use only established permitted evidence",
      async () => {
        const estimate = (score) => ({
          score,
          reports: 6,
          reviewers: 2,
          firstAt: new Date(Date.now() - 30 * 86400000).toISOString(),
          lastAt: new Date().toISOString(),
        });
        async function seed(a, b, points) {
          const [first, second] = [a, b].sort();
          const details = {
            firstEnjoyment: estimate(points),
            secondEnjoyment: estimate(points),
            firstEffectiveness: estimate(points),
            secondEffectiveness: estimate(points),
          };
          await db.query(
            'INSERT INTO "PairInsight" (id,"orgId","firstMembershipId","secondMembershipId","combinedScore","firstToSecondScore","secondToFirstScore","modelVersion",details) VALUES ($1,$2,$3,$4,$5,$5,$5,$6,$7::jsonb) ON CONFLICT ("orgId","firstMembershipId","secondMembershipId","modelVersion") DO UPDATE SET details=EXCLUDED.details,"combinedScore"=EXCLUDED."combinedScore"',
            [
              randomUUID(),
              org,
              first,
              second,
              points,
              "baseline-70-v1",
              JSON.stringify(details),
            ],
          );
        }
        await seed(alice.id, bob.id, 85);
        await seed(alice.id, carla.id, 90);
        await seed(bob.id, carla.id, 80);
        for (const p of [alice, bob, carla]) {
          await seed(p.id, outsider.id, 95);
          await seed(p.id, manager.id, 40);
        }
        const view = await req("POST", builder + "/preview", hr.token, {
          membershipIds: [alice.id, bob.id, carla.id],
        });
        assert.equal(view.teamAnalysis.chemistry, 85);
        assert.equal(view.teamAnalysis.evidence, "ESTABLISHED");
        assert.equal(view.teamAnalysis.knownPairs, 3);
        assert.equal(view.relationships.length, 0);
        assert.equal(view.recommendations[0].membershipId, outsider.id);
        assert.ok(
          !/"(score|points|_value|combinedScore)":/.test(JSON.stringify(view)),
        );
        const own = await req("POST", builder + "/preview", manager.token, {
          membershipIds: [bob.id, carla.id, manager.id],
        });
        assert.equal(own.teamAnalysis.chemistry, null);
        assert.equal(own.teamAnalysis.evidence, "RESTRICTED");
        const roster = await req("POST", builder + "/preview", owner, {
          membershipIds: [alice.id, bob.id],
        });
        assert.equal(roster.teamAnalysis.chemistry, null);
      },
    );
    await t.test(
      "company isolation, role revocation and inactive membership are enforced",
      async () => {
        const other = await req(
            "POST",
            "/organizations",
            outsider.token,
            { name: "Other" },
            201,
          ),
          otherRoot = "/organizations/" + other.organization.id;
        await req("GET", otherRoot + "/team-builder", owner, undefined, 404);
        await req(
          "POST",
          otherRoot + "/team-builder/preview",
          outsider.token,
          { membershipIds: [bob.id] },
          404,
        );
        await req("DELETE", teamPath + "/access/" + manager.id, owner);
        assert.equal(
          (await req("GET", builder + "/capabilities", manager.token)).canUse,
          false,
        );
        await req("GET", builder, manager.token, undefined, 403);
        await db.query('UPDATE "Membership" SET active=false WHERE id=$1', [
          outsider.id,
        ]);
        await req("GET", root + "/my-card", outsider.token, undefined, 404);
      },
    );
  } finally {
    await app?.close();
    await db?.end();
    process.env.DATABASE_URL = original;
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
