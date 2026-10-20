import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import sharp from "sharp";
import { createApp } from "../dist/src/app.js";

test("company profiles enforce team-scoped editing, private photos and tenant isolation", async (t) => {
  const original = process.env.DATABASE_URL,
    adminUrl = new URL(original);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const name = "flowchemia_profiles_" + randomUUID().replaceAll("-", ""),
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
          companyName: "Automation",
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
      const v = await r.json();
      assert.equal(r.status, status, `${method} ${path}: ${JSON.stringify(v)}`);
      return v;
    }
    const owner = await req("POST", "/auth/login", null, {
      email: "owner@example.test",
      password,
    });
    const me = await req("GET", "/me", owner.token),
      org = me.memberships[0].organization.id,
      root = "/organizations/" + org;
    const persons = {};
    for (const [label, role] of [
      ["Alice", "EMPLOYEE"],
      ["Bob", "EMPLOYEE"],
      ["Manager", "EMPLOYEE"],
      ["Leader", "EMPLOYEE"],
      ["Outsider", "EMPLOYEE"],
      ["HR", "HR_ADMIN"],
    ]) {
      const email = label.toLowerCase() + "@example.test";
      const inv = await req(
        "POST",
        root + "/invitations",
        owner.token,
        { email, role },
        201,
      );
      const accepted = await req(
        "POST",
        "/invitations/accept",
        null,
        { token: inv.token, displayName: label, password },
        201,
      );
      persons[label] = {
        ...(await req("POST", "/auth/login", null, { email, password })),
        id: accepted.membership.id,
      };
    }
    const {
      Alice: alice,
      Bob: bob,
      Manager: manager,
      Leader: leader,
      Outsider: outsider,
      HR: hr,
    } = persons;
    const team = await req(
      "POST",
      root + "/teams",
      owner.token,
      { name: "PLC" },
      201,
    );
    for (const p of [alice, bob, leader])
      await req(
        "POST",
        root + `/teams/${team.id}/members`,
        owner.token,
        { membershipId: p.id },
        201,
      );
    await req(
      "POST",
      root + `/teams/${team.id}/access`,
      owner.token,
      { membershipId: manager.id, role: "MANAGER" },
      201,
    );
    await req(
      "POST",
      root + `/teams/${team.id}/access`,
      owner.token,
      { membershipId: leader.id, role: "TEAM_LEADER" },
      201,
    );
    const path = (p, tail = "profile") => root + `/employees/${p.id}/${tail}`;
    await t.test(
      "profiles default empty and login email is never a work email",
      async () => {
        const p = await req("GET", path(alice), alice.token);
        assert.equal(p.jobTitle, null);
        assert.equal(p.workEmail, null);
        assert.equal(p.canEditPhoto, true);
        assert.equal(p.canEditInfo, false);
        assert.ok(!JSON.stringify(p).includes("alice@example.test"));
        assert.equal(
          (await req("GET", path(alice), manager.token)).canEditInfo,
          true,
        );
        assert.equal(
          (await req("GET", path(alice), leader.token)).canEditInfo,
          false,
        );
        assert.equal(
          (await req("GET", path(alice), hr.token)).canEditInfo,
          true,
        );
        await req("GET", path(alice), null, undefined, 401);
        await req("GET", path(alice), outsider.token, undefined, 404);
      },
    );
    await t.test(
      "only manager of a current team, HR or owner can edit professional info",
      async () => {
        await req(
          "PATCH",
          path(alice),
          alice.token,
          { jobTitle: "Fake title" },
          403,
        );
        await req(
          "PATCH",
          path(alice),
          leader.token,
          { workPhone: "123" },
          403,
        );
        await req(
          "PATCH",
          path(outsider),
          manager.token,
          { jobTitle: "Unrelated" },
          404,
        );
        const edited = await req("PATCH", path(alice), manager.token, {
          jobTitle: "PLC Programmer",
          department: "Automation",
          location: "Berlin",
          workEmail: "ALICE.WORK@example.test",
          workPhone: "+49 123 456",
        });
        assert.equal(edited.jobTitle, "PLC Programmer");
        assert.equal(edited.workEmail, "alice.work@example.test");
        await req("PATCH", path(alice), hr.token, { location: "Hamburg" });
        const result = await req("PATCH", path(alice), owner.token, {
          workPhone: null,
        });
        assert.equal(result.workPhone, null);
        assert.equal(result.department, "Automation");
        assert.equal(
          (await req("GET", "/me", alice.token)).user.email,
          "alice@example.test",
        );
        assert.ok(
          (
            await req("POST", "/auth/login", null, {
              email: "alice@example.test",
              password,
            })
          ).token,
        );
        for (const invalid of [
          { role: "HR_ADMIN" },
          { photo: "x" },
          { jobTitle: "" },
          { jobTitle: "x".repeat(121) },
          { workEmail: "bad" },
          { location: "a\nb" },
          { jobTitle: 42 },
          {},
        ])
          await req("PATCH", path(alice), manager.token, invalid, 400);
      },
    );
    let uploaded;
    await t.test(
      "photo is self-managed, decoded, resized, re-encoded and protected on reads",
      async () => {
        const png = await sharp({
          create: {
            width: 800,
            height: 600,
            channels: 3,
            background: "#278487",
          },
        })
          .png()
          .withMetadata({ exif: { IFD0: { Artist: "Private metadata" } } })
          .toBuffer();
        const dataUrl = "data:image/png;base64," + png.toString("base64");
        for (const p of [bob, manager, leader, hr])
          await req("PATCH", path(alice, "photo"), p.token, { dataUrl }, 403);
        await req("PATCH", path(alice, "photo"), owner.token, { dataUrl }, 403);
        uploaded = await req("PATCH", path(alice, "photo"), alice.token, {
          dataUrl,
        });
        assert.ok(uploaded.photoUpdatedAt);
        const photo = await req("GET", path(alice, "photo"), bob.token);
        assert.ok(photo.dataUrl.startsWith("data:image/jpeg;base64,"));
        const meta = await sharp(
          Buffer.from(photo.dataUrl.split(",")[1], "base64"),
        ).metadata();
        assert.equal(meta.width, 384);
        assert.equal(meta.height, 384);
        assert.equal(meta.format, "jpeg");
        assert.equal(meta.exif, undefined);
        await req("GET", path(alice, "photo"), null, undefined, 401);
        await req("GET", path(alice, "photo"), outsider.token, undefined, 404);
        await req("DELETE", path(alice, "photo"), hr.token, undefined, 403);
        const invalid = [
          "data:image/svg+xml;base64,PHN2Zz4=",
          "https://example.test/photo.jpg",
          "data:image/jpeg;base64,aGVsbG8=",
          "data:image/png;base64," + Buffer.from("<svg/>").toString("base64"),
        ];
        for (const dataUrl of invalid)
          await req(
            "PATCH",
            path(alice, "photo"),
            alice.token,
            { dataUrl },
            400,
          );
        await req(
          "PATCH",
          path(alice, "photo"),
          alice.token,
          { dataUrl: "x".repeat(200000) },
          413,
        );
        const retained = await req("GET", path(alice, "photo"), alice.token);
        assert.equal(retained.dataUrl, photo.dataUrl);
      },
    );
    await t.test(
      "directory and team cards show real profile fields without login contacts or photo bytes",
      async () => {
        const list = await req("GET", root + "/employees", manager.token);
        assert.deepEqual(
          new Set(list.map((p) => p.membershipId)),
          new Set([manager.id, alice.id, bob.id, leader.id]),
        );
        assert.equal(
          list.find((p) => p.membershipId === alice.id).jobTitle,
          "PLC Programmer",
        );
        assert.ok(!JSON.stringify(list).includes("base64"));
        assert.ok(!JSON.stringify(list).includes("alice@example.test"));
        assert.equal(
          (await req("GET", root + "/employees", outsider.token)).length,
          1,
        );
        assert.equal(
          (await req("GET", root + "/employees", hr.token)).length,
          7,
        );
        const teamView = await req(
          "GET",
          root + `/teams/${team.id}/insights`,
          manager.token,
        );
        const card = teamView.employees.find(
          (p) => p.membershipId === alice.id,
        );
        assert.equal(card.profile.jobTitle, "PLC Programmer");
        assert.equal(card.profile.photoUpdatedAt, uploaded.photoUpdatedAt);
        assert.ok(!JSON.stringify(card).includes("workEmail"));
      },
    );
    await t.test(
      "same account in another company has independent profile and no access to first-company photos",
      async () => {
        const other = await req(
            "POST",
            "/organizations",
            outsider.token,
            { name: "Other Company" },
            201,
          ),
          otherRoot = "/organizations/" + other.organization.id;
        const invite = await req(
          "POST",
          otherRoot + "/invitations",
          outsider.token,
          { email: "alice@example.test", role: "EMPLOYEE" },
          201,
        );
        const joined = await req(
          "POST",
          "/invitations/accept",
          alice.token,
          { token: invite.token },
          201,
        );
        const separate = await req(
          "GET",
          otherRoot + `/employees/${joined.membership.id}/profile`,
          alice.token,
        );
        assert.equal(separate.jobTitle, null);
        assert.equal(separate.photoUpdatedAt, null);
        await req(
          "GET",
          otherRoot + `/employees/${alice.id}/photo`,
          outsider.token,
          undefined,
          404,
        );
        await req(
          "PATCH",
          otherRoot + `/employees/${alice.id}/profile`,
          outsider.token,
          { jobTitle: "Wrong company" },
          404,
        );
        assert.equal(
          (await req("GET", path(alice), alice.token)).jobTitle,
          "PLC Programmer",
        );
      },
    );
    await t.test(
      "ended teams and revoked manager access cannot edit; removing photo restores initials",
      async () => {
        await db.query(
          'UPDATE "Team" SET "startsAt"=now()-interval \'1 day\', "endsAt"=now()-interval \'1 second\' WHERE id=$1',
          [team.id],
        );
        await req("GET", path(alice), manager.token, undefined, 404);
        await req(
          "PATCH",
          path(alice),
          manager.token,
          { jobTitle: "Denied" },
          404,
        );
        await db.query('UPDATE "Team" SET "endsAt"=NULL WHERE id=$1', [
          team.id,
        ]);
        await req(
          "DELETE",
          root + `/teams/${team.id}/access/${manager.id}`,
          owner.token,
        );
        await req(
          "PATCH",
          path(alice),
          manager.token,
          { jobTitle: "Denied" },
          404,
        );
        await req("DELETE", path(alice, "photo"), alice.token);
        assert.equal(
          (await req("GET", path(alice, "photo"), alice.token)).dataUrl,
          null,
        );
        assert.equal(
          (await req("GET", path(alice), alice.token)).photoUpdatedAt,
          null,
        );
      },
    );
  } finally {
    if (app) await app.close();
    if (db) await db.end();
    process.env.DATABASE_URL = original;
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
});
