import Link from "next/link";
import type { ReactNode } from "react";
import { EVIDENCE_LABELS, type EvidenceClass } from "@/lib/domain/evidence";
import { formatCents } from "@/lib/domain/funding";
import { PROJECT_TIMEZONE } from "@/lib/config";

type Tone = "neutral" | "ok" | "warn" | "danger" | "info" | "accent";

export function Pill({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`pill ${tone}`} title={title}>
      {children}
    </span>
  );
}

const EVIDENCE_TONE: Record<EvidenceClass, Tone> = {
  verified_current: "ok",
  documented_historical: "info",
  user_reported: "accent",
  proposed: "neutral",
  inferred: "warn",
  unknown: "danger",
};

export function EvidenceBadge({ cls }: { cls: string }) {
  const c = cls as EvidenceClass;
  return <Pill tone={EVIDENCE_TONE[c] ?? "neutral"}>{EVIDENCE_LABELS[c] ?? cls}</Pill>;
}

const STATE_TONE: Record<string, Tone> = {
  accepted: "ok", completed: "ok", done: "ok", connected: "ok", applied: "ok", approved: "ok", established: "ok", succeeded: "ok", available: "ok",
  needs_review: "warn", partial: "warn", blocked: "warn", in_progress: "info", running: "info", queued: "neutral", pending: "neutral",
  waiting_for_approval: "warn", waiting_for_input: "warn", requested: "warn", configured_unverified: "warn", pending_retrieval: "warn",
  deferred: "neutral", open: "neutral", draft: "neutral", proposed: "neutral", not_established: "neutral", under_review: "neutral", identified: "neutral",
  failed: "danger", rejected: "danger", cancelled: "neutral", invalid: "danger", invalidated: "danger", error: "danger", unavailable: "danger",
  disputed: "danger", skipped_budget: "warn", not_configured: "neutral", disabled: "neutral", superseded: "neutral",
};

export function StatePill({ state }: { state: string | null | undefined }) {
  if (!state) return <Unset />;
  return <Pill tone={STATE_TONE[state] ?? "neutral"}>{state.replaceAll("_", " ")}</Pill>;
}

export function Unset({ label = "Not established" }: { label?: string }) {
  return <span className="unset">{label}</span>;
}

export function Money({ cents, comparator }: { cents: number | string | null | undefined; comparator?: string }) {
  if (cents === null || cents === undefined) return <Unset />;
  return <span>{formatCents(Number(cents), { comparator })}</span>;
}

/** Date-only values are displayed exactly as stored: no timezone conversion. */
export function DateOnly({ value, tz }: { value: string | null | undefined; tz?: string | null }) {
  if (!value) return <Unset label="Unset" />;
  const d = String(value).slice(0, 10);
  return (
    <span>
      {d}
      {tz ? <span className="muted small"> ({tz})</span> : null}
    </span>
  );
}

export function Timestamp({ value }: { value: string | null | undefined }) {
  if (!value) return <Unset label="—" />;
  const d = new Date(value);
  return (
    <time dateTime={d.toISOString()} title={d.toISOString()}>
      {d.toLocaleString("en-US", { timeZone: PROJECT_TIMEZONE, dateStyle: "medium", timeStyle: "short" })} PT
    </time>
  );
}

export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head row between">
      <div>
        <h1>{title}</h1>
        {sub ? <p className="muted">{sub}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function SourceLink({ id, code, title }: { id: string; code?: string | null; title?: string }) {
  return (
    <Link href={`/evidence/sources/${id}`}>
      {code ? `${code}` : "source"}
      {title ? ` — ${title}` : ""}
    </Link>
  );
}

export function roleLabel(role: string | null | undefined) {
  return role ? role.replaceAll("_", " ") : "unassigned";
}
