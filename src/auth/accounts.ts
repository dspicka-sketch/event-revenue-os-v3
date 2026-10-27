// Users, organization memberships and bearer sessions. Shared by the desktop
// web client and the mobile client: both authenticate with the same tokens.

import type { Db } from "../db/pool.js";
import { hashPassword, hashToken, newSessionToken, verifyPassword } from "./password.js";

export type Role = "admin" | "viewer";
export type ClientKind = "web" | "mobile" | "cli";

export interface AuthedUser {
  userId: string;
  email: string;
  displayName: string | null;
  sessionId: string;
}

const SESSION_DAYS: Record<ClientKind, number> = { web: 14, mobile: 30, cli: 1 };

export async function createUser(db: Db, u: { email: string; password: string; displayName?: string }): Promise<string> {
  const hash = await hashPassword(u.password);
  const r = await db.query<{ id: string }>(
    "INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id",
    [u.email.trim(), u.displayName ?? null, hash],
  );
  return r.rows[0]!.id;
}

export async function findUserId(db: Db, email: string): Promise<string | null> {
  return (await db.query<{ id: string }>("SELECT id FROM users WHERE lower(email) = lower($1)", [email.trim()])).rows[0]?.id ?? null;
}

export async function setMembership(db: Db, orgId: string, userId: string, role: Role): Promise<void> {
  await db.query(
    `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [orgId, userId, role],
  );
}

// A precomputed hash so unknown emails cost the same as wrong passwords.
let dummyHash: Promise<string> | null = null;

export async function login(db: Db, email: string, password: string, client: ClientKind): Promise<{ token: string; expiresAt: Date } | null> {
  const row = (
    await db.query<{ id: string; password_hash: string; disabled_at: Date | null }>(
      "SELECT id, password_hash, disabled_at FROM users WHERE lower(email) = lower($1)",
      [email.trim()],
    )
  ).rows[0];
  if (!row) {
    dummyHash ??= hashPassword("not-a-real-password-000");
    await verifyPassword(password, await dummyHash);
    return null;
  }
  if (row.disabled_at || !(await verifyPassword(password, row.password_hash))) return null;
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS[client] * 86400_000);
  await db.query("INSERT INTO sessions (user_id, token_hash, client, expires_at) VALUES ($1, $2, $3, $4)", [row.id, hashToken(token), client, expiresAt]);
  return { token, expiresAt };
}

export async function authenticate(db: Db, token: string): Promise<AuthedUser | null> {
  if (!token || token.length > 200) return null;
  const r = await db.query<{ session_id: string; user_id: string; email: string; display_name: string | null }>(
    `UPDATE sessions s SET last_used_at = now()
     FROM users u
     WHERE s.token_hash = $1 AND s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now() AND u.disabled_at IS NULL
     RETURNING s.id AS session_id, u.id AS user_id, u.email, u.display_name`,
    [hashToken(token)],
  );
  const row = r.rows[0];
  return row ? { userId: row.user_id, email: row.email, displayName: row.display_name, sessionId: row.session_id } : null;
}

export async function logout(db: Db, sessionId: string): Promise<void> {
  await db.query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [sessionId]);
}

export async function roleIn(db: Db, userId: string, orgId: string): Promise<Role | null> {
  return (
    await db.query<{ role: Role }>("SELECT role FROM organization_members WHERE user_id = $1 AND organization_id = $2", [userId, orgId])
  ).rows[0]?.role ?? null;
}

export interface MembershipOrg {
  id: string;
  name: string;
  timezone: string;
  is_fixture: boolean;
  role: Role;
}

export async function listMemberOrganizations(db: Db, userId: string): Promise<MembershipOrg[]> {
  return (
    await db.query<MembershipOrg>(
      `SELECT o.id, o.name, o.timezone, o.is_fixture, m.role
       FROM organization_members m JOIN organizations o ON o.id = m.organization_id
       WHERE m.user_id = $1 ORDER BY o.is_fixture, o.name`,
      [userId],
    )
  ).rows;
}

/** Simple in-memory login throttle: at most `max` failures per key per window. */
export class LoginThrottle {
  private failures = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly max = 10, private readonly windowMs = 15 * 60_000) {}

  blocked(key: string): boolean {
    const f = this.failures.get(key);
    if (!f) return false;
    if (Date.now() > f.resetAt) {
      this.failures.delete(key);
      return false;
    }
    return f.count >= this.max;
  }

  fail(key: string): void {
    const f = this.failures.get(key);
    if (!f || Date.now() > f.resetAt) this.failures.set(key, { count: 1, resetAt: Date.now() + this.windowMs });
    else f.count++;
    if (this.failures.size > 10_000) this.failures.clear();
  }

  succeed(key: string): void {
    this.failures.delete(key);
  }
}
