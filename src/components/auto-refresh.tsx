"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-render the server page while a run is active. Durable state lives in the database; this only refreshes the view. */
export function AutoRefresh({ active, ms = 3000 }: { active: boolean; ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [active, ms, router]);
  return active ? <p className="small muted" role="status">Run in progress — updating…</p> : null;
}
