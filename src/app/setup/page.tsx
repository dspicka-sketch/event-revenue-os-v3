import { redirect } from "next/navigation";
import { appMode } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function Setup() {
  if (appMode() !== "setup") redirect("/");
  return (
    <main style={{ maxWidth: 680, margin: "6vh auto", padding: 16 }}>
      <div className="card stack">
        <h1>Setup required</h1>
        <p>This deployment has no database connection, so no records are shown. Nothing here is fake data.</p>
        <ol>
          <li>Create a dedicated Supabase project and apply <code>supabase/migrations</code>.</li>
          <li>Set <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, <code>DATABASE_URL</code> and <code>CRON_SECRET</code>.</li>
          <li>Invite Daniel in Supabase Auth, then add the owner membership (see README).</li>
          <li>Optionally set <code>AGENT_MODEL</code> and an AI Gateway credential to enable agent runs.</li>
        </ol>
        <p className="small muted">For an isolated walkthrough with synthetic data, run locally with <code>DEMO_MODE=1</code>.</p>
      </div>
    </main>
  );
}
