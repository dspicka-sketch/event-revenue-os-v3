// Manage RevOS accounts (no public sign-up in the pilot).
//   npm run user -- create <email> [--name "Display Name"]   prints a one-time generated password
//   npm run user -- grant <email> <organizationId> <admin|viewer>
//   npm run user -- reset-password <email>                   prints a new generated password
import { createPool } from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";
import { createUser, findUserId, setMembership } from "../src/auth/accounts.js";
import { generatePassword, hashPassword } from "../src/auth/password.js";

const [cmd, email, ...rest] = process.argv.slice(2);
const usage = () => { console.error("Usage: npm run user -- create <email> [--name N] | grant <email> <orgId> <admin|viewer> | reset-password <email>"); process.exit(1); };
if (!cmd || !email) usage();

const db = createPool();
try {
  await migrate(db);
  if (cmd === "create") {
    const nameIdx = rest.indexOf("--name");
    const password = generatePassword();
    const id = await createUser(db, { email: email!, password, displayName: nameIdx >= 0 ? rest[nameIdx + 1] : undefined });
    console.log(`Created user ${id}.\nOne-time password (shown once, not stored): ${password}`);
  } else if (cmd === "grant") {
    const [orgId, role] = rest;
    if (!orgId || (role !== "admin" && role !== "viewer")) usage();
    const id = await findUserId(db, email!);
    if (!id) throw new Error("No such user.");
    await setMembership(db, orgId!, id, role as "admin" | "viewer");
    console.log(`Granted ${role} on ${orgId}.`);
  } else if (cmd === "reset-password") {
    const id = await findUserId(db, email!);
    if (!id) throw new Error("No such user.");
    const password = generatePassword();
    await db.query("UPDATE users SET password_hash = $2 WHERE id = $1", [id, await hashPassword(password)]);
    await db.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [id]);
    console.log(`New one-time password (shown once): ${password}\nExisting sessions revoked.`);
  } else usage();
} finally {
  await db.end();
}
