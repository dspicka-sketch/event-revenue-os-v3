import { redirect } from "next/navigation";
import { appMode } from "@/lib/config";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default function Login() {
  const mode = appMode();
  if (mode === "demo") redirect("/");
  if (mode === "setup") redirect("/setup");
  return (
    <main style={{ maxWidth: 420, margin: "10vh auto" }}>
      <div className="card stack">
        <h1>Protect 104 N. Main</h1>
        <p className="muted">Private project workspace. Access is by invitation only.</p>
        <LoginForm url={process.env.NEXT_PUBLIC_SUPABASE_URL!} anonKey={process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!} />
      </div>
    </main>
  );
}
