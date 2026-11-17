import { afterAll, beforeAll, expect, it } from "vitest";
import type { Db } from "../src/db/pool.js";
import { createUser, setMembership } from "../src/auth/accounts.js";
import { createOrganization, finishAutomationRun, lastFinishedRun, lastSucceededRun, listLiveOrganizations, listOrgAdminEmails, startAutomationRun } from "../src/db/repo.js";
import { describeDb, freshDb } from "./helpers/db.js";

const T = (h: number) => new Date(Date.UTC(2026, 10, 16, h));

describeDb("automation run log", () => {
  let db: Db;
  let orgId: string;
  beforeAll(async () => {
    db = await freshDb();
    await db.query("TRUNCATE automation_runs");
    orgId = (await createOrganization(db, { name: "Wax Poetic", isFixture: false })).id;
    await createOrganization(db, { name: "[FIXTURE] Demo", isFixture: true });
  });
  afterAll(async () => { await db.end(); });

  it("has no last run before anything ran", async () => {
    expect(await lastSucceededRun(db, "sync_sweep")).toBeNull();
    expect(await lastFinishedRun(db, "sync_sweep")).toBeNull();
  });

  it("returns a succeeded run with its finish time and detail", async () => {
    const id = await startAutomationRun(db, "sync_sweep", null, T(11));
    await finishAutomationRun(db, id, "succeeded", { attempted: 2, failures: [] }, T(12));
    expect((await lastSucceededRun(db, "sync_sweep"))!.finishedAt.toISOString()).toBe(T(12).toISOString());
    expect(await lastFinishedRun(db, "sync_sweep")).toMatchObject({ status: "succeeded", detail: { attempted: 2 } });
  });

  it("does not count a failed or still-running run as a success", async () => {
    const failed = await startAutomationRun(db, "sync_sweep", null, T(13));
    await finishAutomationRun(db, failed, "failed", { reason: "boom" }, T(14));
    await startAutomationRun(db, "sync_sweep", null, T(15));
    expect((await lastSucceededRun(db, "sync_sweep"))!.finishedAt.toISOString()).toBe(T(12).toISOString());
    expect(await lastFinishedRun(db, "sync_sweep")).toMatchObject({ status: "failed", detail: { reason: "boom" } });
  });

  it("keeps jobs apart", async () => {
    expect(await lastSucceededRun(db, "weekly_digest")).toBeNull();
  });

  it("lists only enabled admins' emails for an organization", async () => {
    const a = await createUser(db, { email: "admin@example.com", password: "correct horse battery staple" });
    const v = await createUser(db, { email: "viewer@example.com", password: "correct horse battery staple" });
    const gone = await createUser(db, { email: "gone@example.com", password: "correct horse battery staple" });
    await setMembership(db, orgId, a, "admin");
    await setMembership(db, orgId, v, "viewer");
    await setMembership(db, orgId, gone, "admin");
    await db.query("UPDATE users SET disabled_at = now() WHERE id = $1", [gone]);
    expect(await listOrgAdminEmails(db, orgId)).toEqual(["admin@example.com"]);
  });

  it("lists live organizations only", async () => {
    expect((await listLiveOrganizations(db)).map((o) => o.name)).toEqual(["Wax Poetic"]);
  });
});
