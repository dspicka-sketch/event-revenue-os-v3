"use client";
import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/** Email one-time link. shouldCreateUser=false: only invited accounts can sign in. */
export function LoginForm({ url, anonKey }: { url: string; anonKey: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "");
    setState("sending");
    const sb = createBrowserClient(url, anonKey);
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setState("error");
      setMessage(error.message);
    } else {
      setState("sent");
      setMessage("If this address is invited, a sign-in link is on its way.");
    }
  }
  return (
    <form onSubmit={submit}>
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="email" required />
      <p style={{ marginTop: 12 }}>
        <button type="submit" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Email me a sign-in link"}</button>
      </p>
      {message ? <p role={state === "error" ? "alert" : "status"} className={`notice ${state === "error" ? "danger" : ""}`}>{message}</p> : null}
    </form>
  );
}
