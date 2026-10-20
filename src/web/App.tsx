import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { CurrencyRevenue, ReconciliationRow, RevenueException } from "../domain/revenue.js";
import { currencyScale, type Measure } from "../domain/money.js";
import { TARGET_LABELS, type AttentionItem, type ShowCard, type TargetProgress } from "../domain/pulse.js";
import {
  api, ApiError, getToken, setToken,
  type ConnectionsResponse, type EventDetailResponse, type EventDto, type MeResponse, type Organization, type PulseResponse, type TargetMeasure,
} from "./api.js";
import { fmtDateTime, fmtMeasure, fmtRelative, formatMoney } from "./format.js";
import { PaceChart } from "./PaceChart.js";

// ------------------------------------------------------------------ routing

type Route =
  | { page: "home" }
  | { page: "org"; orgId: string }
  | { page: "integrations"; orgId: string }
  | { page: "event"; orgId: string; eventId: string };

function parseRoute(path: string): Route {
  let m = path.match(/^\/orgs\/([^/]+)\/integrations\/?$/);
  if (m) return { page: "integrations", orgId: m[1]! };
  m = path.match(/^\/orgs\/([^/]+)(?:\/events\/([^/]+))?\/?$/);
  if (!m) return { page: "home" };
  return m[2] ? { page: "event", orgId: m[1]!, eventId: m[2] } : { page: "org", orgId: m[1]! };
}

type Go = (to: string, replace?: boolean) => void;

function useRoute(): [Route, Go] {
  const [route, setRoute] = useState(() => parseRoute(location.pathname));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.pathname));
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  const go = useCallback<Go>((to, replace = false) => {
    if (replace) history.replaceState(null, "", to);
    else history.pushState(null, "", to);
    setRoute(parseRoute(to));
    scrollTo(0, 0);
  }, []);
  return [route, go];
}

function Link({ to, go, children, className, current }: { to: string; go: Go; children: ReactNode; className?: string; current?: boolean }) {
  return (
    <a href={to} className={className} aria-current={current ? "page" : undefined}
      onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); go(to); }}>
      {children}
    </a>
  );
}

// ------------------------------------------------------------------ app shell

export function App() {
  const [route, go] = useRoute();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [signedOut, setSignedOut] = useState(!getToken());
  const [error, setError] = useState<string | null>(null);

  const loadMe = useCallback(() => {
    api.me().then((r) => { setMe(r); setSignedOut(false); setError(null); }).catch((e) => {
      if (e instanceof ApiError && e.status === 401) { setToken(null); setSignedOut(true); }
      else setError(e instanceof Error ? e.message : String(e));
    });
  }, []);
  useEffect(() => { if (!signedOut) loadMe(); }, [signedOut, loadMe]);
  const onAuthLost = useCallback(() => { setToken(null); setMe(null); setSignedOut(true); }, []);

  const orgs = me?.organizations ?? null;
  useEffect(() => {
    if (route.page === "home" && orgs && orgs.length > 0) {
      const preferred = orgs.find((o) => !o.is_fixture) ?? orgs[0]!;
      go(`/orgs/${preferred.id}`, true);
    }
  }, [route, orgs, go]);

  const signOut = async () => {
    await api.logout().catch(() => undefined);
    onAuthLost();
  };

  const orgId = route.page === "home" ? null : route.orgId;
  const org = orgs?.find((o) => o.id === orgId) ?? null;

  if (signedOut) return <div className="shell"><header className="topbar"><span className="brand">RevOS</span></header><main><LoginForm onDone={() => setSignedOut(false)} /></main></div>;

  return (
    <div className={org?.is_fixture ? "shell fixture" : "shell"}>
      <header className="topbar">
        <Link to="/" go={go} className="brand">RevOS</Link>
        {orgs && orgs.length > 0 && (
          <label className="org-picker">
            <span className="sr-only">Organization</span>
            <select value={orgId ?? ""} onChange={(e) => go(`/orgs/${e.target.value}`)}>
              {orgId === null && <option value="">Select organization…</option>}
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.is_fixture ? `FIXTURE — ${o.name}` : o.name}</option>)}
            </select>
          </label>
        )}
        {org && (
          <nav className="tabs" aria-label="Sections">
            <Link to={`/orgs/${org.id}`} go={go} current={route.page === "org" || route.page === "event"}>Shows</Link>
            <Link to={`/orgs/${org.id}/integrations`} go={go} current={route.page === "integrations"}>Integrations</Link>
          </nav>
        )}
        <span className="spacer" />
        {me && <span className="small muted user">{me.user.email}</span>}
        <button className="link" onClick={signOut}>Sign out</button>
      </header>
      {org?.is_fixture && <FixtureBanner />}
      {org && !org.is_fixture && <div className="mode-strip live" role="note">LIVE organization — data read from connected sources</div>}
      <main id="main">
        {error ? <ErrorBox title="Could not reach the RevOS server" detail={error} />
          : orgs === null ? <p className="muted">Loading…</p>
          : orgs.length === 0 ? <EmptySetup />
          : !org && route.page !== "home" ? <ErrorBox title="Organization not found" detail="It does not exist or you are not a member." />
          : route.page === "org" ? <EventList org={org!} go={go} onAuth={onAuthLost} />
          : route.page === "event" ? <EventPage org={org!} eventId={route.eventId} go={go} onAuth={onAuthLost} />
          : route.page === "integrations" ? <IntegrationsPage org={org!} onAuth={onAuthLost} />
          : null}
      </main>
    </div>
  );
}

function FixtureBanner() {
  return (
    <div className="fixture-banner" role="alert">
      <strong>FIXTURE DATA</strong> — synthetic records for testing. Not from a live source; not a live verification.
    </div>
  );
}

function LoginForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.login(email, password);
      setToken(r.token);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card narrow" onSubmit={submit}>
      <h1>Sign in</h1>
      <p className="muted small">The same account works in the RevOS mobile app.</p>
      <label htmlFor="email">Email</label>
      <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="pw">Password</label>
      <input id="pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

function EmptySetup() {
  return (
    <div className="card narrow">
      <h1>No organizations yet</h1>
      <p>Your account is not a member of any organization. An administrator can grant access with <code>npm run user -- grant</code> (see README).</p>
    </div>
  );
}

function ErrorBox({ title, detail, action }: { title: string; detail?: string | null; action?: string | null }) {
  return (
    <div className="callout error" role="alert">
      <strong>{title}</strong>
      {detail && <p>{detail}</p>}
      {action && <p className="action">{action}</p>}
    </div>
  );
}

function useLoad<T>(load: () => Promise<T>, onAuth: () => void, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    load().then((d) => { setData(d); setError(null); }).catch((e) => {
      if (e instanceof ApiError && e.status === 401) onAuth();
      else setError(e instanceof Error ? e.message : String(e));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

// ------------------------------------------------------------------ shared bits

const STATUS_LABEL: Record<string, string> = {
  not_configured: "Not configured",
  verifying: "Verifying",
  verified: "Verified (live)",
  stale: "Stale",
  error: "Error",
  fixture: "Fixture read OK",
};

function ConnectionBadge({ status }: { status: string }) {
  return <span className={`badge s-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

function MeasureStatusTag({ m }: { m: Measure }) {
  if (m.status === "complete") return null;
  return (
    <span className={`tag ${m.status}`} title={m.note}>
      {m.status === "partial" ? (m.unknownCount > 0 ? `Partial (${m.unknownCount} unknown)` : "Partial") : "Unavailable"}
    </span>
  );
}

const SEVERITY_ICON: Record<AttentionItem["severity"], string> = { error: "⛔", warning: "⚠", info: "ℹ" };

function AttentionList({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return <p className="muted small">Nothing needs attention.</p>;
  return (
    <ul className="attention">
      {items.map((a, i) => (
        <li key={i} className={`sev-${a.severity}`}>
          <span className={`tag sev ${a.severity}`}><span aria-hidden="true">{SEVERITY_ICON[a.severity]}</span> {a.severity}</span>{" "}
          <strong>{a.title}</strong>
          <div className="small">{a.detail}</div>
        </li>
      ))}
    </ul>
  );
}

const TARGET_STATUS: Record<TargetProgress["status"], string> = { met: "Met", on_track: "On track", behind: "Behind", missed: "Missed", unknown: "Not judged" };

function fmtTargetValue(t: { unit: "count" | "money"; currency: string | null }, v: number | null): string {
  if (v === null) return "Unavailable";
  return t.unit === "count" ? v.toLocaleString("en-US") : formatMoney(v, t.currency ?? "USD");
}

function TargetBar({ t }: { t: TargetProgress }) {
  const pct = Math.min(100, t.percent ?? 0);
  return (
    <div className="target">
      <div className="target-head">
        <span>{t.label}</span>
        <span className={`tag t-${t.status}`}>{TARGET_STATUS[t.status]}</span>
      </div>
      <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={t.percent ?? undefined} aria-label={`${t.label}: ${t.percent ?? "unknown"} percent of target`}>
        <div className={`meter-fill t-${t.status}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="small muted">
        {fmtTargetValue(t, t.actual)} of {fmtTargetValue(t, t.target)}{t.percent !== null ? ` · ${t.percent}%` : ""}
        {t.actualStatus === "partial" ? " · actual partial" : ""} · manual target
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ show list

function EventList({ org, go, onAuth }: { org: Organization; go: Go; onAuth: () => void }) {
  const { data, error } = useLoad(() => Promise.all([api.events(org.id), api.pulse(org.id)]), onAuth, [org.id]);
  if (error) return <ErrorBox title="Could not load shows" detail={error} />;
  if (!data) return <p className="muted">Loading…</p>;
  const [ev, pulse] = data;
  const cards = new Map(pulse.shows.map((s) => [s.id, s]));
  const tz = org.timezone;
  return (
    <section>
      <div className="page-head">
        <h1>{org.name}</h1>
        <p className="muted">Performance dates in {tz}. "Last 7 days" uses sale date. Totals are per currency and never combined.</p>
      </div>
      <PulseSummary pulse={pulse} />
      {ev.events.length === 0 ? (
        <div className="card"><p>No shows are mapped for this organization yet. See Integrations.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <caption className="sr-only">Shows</caption>
            <thead>
              <tr>
                <th scope="col">Show / performance</th>
                <th scope="col">Performance date</th>
                <th scope="col" className="num">Net paid tickets</th>
                <th scope="col" className="num">Gross after refunds</th>
                <th scope="col" className="num">Organizer proceeds</th>
                <th scope="col">Target</th>
                <th scope="col" className="num">Last 7 days</th>
                <th scope="col">Attention</th>
                <th scope="col">Data freshness</th>
              </tr>
            </thead>
            <tbody>{ev.events.flatMap((e) => eventRows(e, cards.get(e.id), tz, go, org.id))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PulseSummary({ pulse }: { pulse: PulseResponse }) {
  const s = pulse.summary;
  return (
    <div className="tiles summary">
      <Tile label="Upcoming shows" value={String(s.upcomingShows)} />
      <Tile label="Paid tickets, last 7 days" value={s.paidTicketsLast7Days.toLocaleString("en-US")} hint="All shows, by sale date" />
      {s.upcomingGrossByCurrency.map((g) => (
        <Tile key={g.currency} label={`Upcoming gross after refunds (${g.currency})`} value={g.minor === null ? "Unavailable" : formatMoney(g.minor, g.currency)} hint={g.status === "complete" ? "Before fees and tax" : `${g.status}; before fees and tax`} />
      ))}
      <Tile label="Shows needing attention" value={String(s.showsNeedingAttention)} hint="Warnings or errors" />
    </div>
  );
}

function eventRows(e: EventDto, card: ShowCard | undefined, tz: string, go: Go, orgId: string) {
  const currencies = e.revenue?.currencies ?? [];
  const link = <Link to={`/orgs/${orgId}/events/${e.id}`} go={go}>{e.source.sourceName ?? e.name}</Link>;
  const fresh = <Freshness e={e} />;
  const top = card?.attention.find((a) => a.severity !== "info") ?? card?.attention[0];
  const attention = top ? <span className={`tag sev ${top.severity}`} title={top.detail}><span aria-hidden="true">{SEVERITY_ICON[top.severity]}</span> {top.title}{card!.attention.length > 1 ? ` +${card!.attention.length - 1}` : ""}</span> : <span className="muted small">—</span>;
  const target = card?.targets[0] ? <span className={`tag t-${card.targets[0].status}`}>{card.targets[0].percent ?? "?"}% · {TARGET_STATUS[card.targets[0].status]}</span> : <span className="muted small">None</span>;
  if (currencies.length === 0) {
    return [
      <tr key={e.id}>
        <th scope="row">{link}</th>
        <td>{fmtDateTime(e.performanceStartUtc, tz)}</td>
        <td colSpan={5} className="muted">No data yet — open the show and use Refresh.</td>
        <td>{attention}</td>
        <td>{fresh}</td>
      </tr>,
    ];
  }
  return currencies.map((c, i) => (
    <tr key={`${e.id}-${c.currency}`}>
      <th scope="row">{i === 0 ? link : <span className="muted">↳ {c.currency}</span>}</th>
      <td>{i === 0 ? fmtDateTime(e.performanceStartUtc, tz) : ""}</td>
      <td className="num">{c.tickets.paid}{c.tickets.partial ? "+" : ""}</td>
      <td className="num">{fmtMeasure(c.measures.grossAfterRefunds, c.currency)} <MeasureStatusTag m={c.measures.grossAfterRefunds} /></td>
      <td className="num">{fmtMeasure(c.measures.organizerProceeds, c.currency)} <MeasureStatusTag m={c.measures.organizerProceeds} /></td>
      <td>{i === 0 ? target : ""}</td>
      <td className="num">{c.last7Days.paidTickets}</td>
      <td>{i === 0 ? attention : ""}</td>
      <td>{i === 0 ? fresh : ""}</td>
    </tr>
  ));
}

function Freshness({ e }: { e: EventDto }) {
  return (
    <span className="freshness">
      <ConnectionBadge status={e.freshness.stale ? "stale" : e.connection.status} />
      <span className="muted small"> as of {fmtRelative(e.freshness.dataAsOf)}</span>
    </span>
  );
}

// ------------------------------------------------------------------ show detail

function EventPage({ org, eventId, go, onAuth }: { org: Organization; eventId: string; go: Go; onAuth: () => void }) {
  const { data, error, reload } = useLoad(() => api.event(org.id, eventId), onAuth, [org.id, eventId]);
  const [busy, setBusy] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<{ ok: boolean; text: string; action?: string } | null>(null);

  const refresh = async () => {
    setBusy(true);
    setRefreshMsg(null);
    try {
      await api.refresh(org.id, eventId);
      setRefreshMsg({ ok: true, text: "Refresh completed." });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuth();
      const body = e instanceof ApiError ? e.body : {};
      setRefreshMsg({ ok: false, text: `Refresh failed: ${String(body.message ?? (e as Error).message)}`, action: body.action as string | undefined });
    } finally {
      setBusy(false);
      reload();
    }
  };

  if (error) return <ErrorBox title="Could not load this show" detail={error} />;
  if (!data) return <p className="muted">Loading…</p>;
  const { event: e, card } = data;
  const tz = e.venueTimezone;

  return (
    <section>
      <nav className="crumbs" aria-label="Breadcrumb"><Link to={`/orgs/${org.id}`} go={go}>← {org.name}</Link></nav>
      <div className="page-head with-action">
        <div>
          <h1>{e.source.sourceName ?? e.name}</h1>
          <p className="muted">Performance: {fmtDateTime(e.performanceStartUtc, tz)}{card.daysUntil !== null && card.daysUntil > 0 ? ` · in ${card.daysUntil} days` : ""} · Eventbrite event {e.source.sourceEventId}</p>
        </div>
        <button className="primary" onClick={refresh} disabled={busy} aria-busy={busy}>{busy ? "Refreshing…" : "Refresh"}</button>
      </div>
      <div aria-live="polite">
        {refreshMsg && (refreshMsg.ok
          ? <div className="callout ok">{refreshMsg.text}</div>
          : <ErrorBox title={refreshMsg.text} action={refreshMsg.action} />)}
      </div>

      <SyncStatus e={e} tz={tz} />

      <div className="two-col">
        <section className="card" aria-labelledby="att-h">
          <h2 id="att-h" className="card-title">Needs attention</h2>
          <AttentionList items={card.attention} />
        </section>
        <TargetsPanel org={org} eventId={eventId} card={card} onSaved={reload} onAuth={onAuth} />
      </div>

      {card.pace && <div className="card"><PaceChart days={card.pace.days} currency={card.currency} /></div>}

      {!e.revenue ? (
        <div className="card"><p>No data has been read for this show yet. Use <strong>Refresh</strong> to run the first read.</p></div>
      ) : (
        e.revenue.currencies.map((c) => <CurrencySection key={c.currency} c={c} defs={data.definitions} stale={e.freshness.stale} comparison={e.reportComparison} />)
      )}

      {e.revenue && <Exceptions list={e.revenue.exceptions} />}
      <TicketClasses rows={data.ticketClasses} />
      <SyncHistory runs={data.syncRuns} tz={tz} />
    </section>
  );
}

function TargetsPanel({ org, eventId, card, onSaved, onAuth }: { org: Organization; eventId: string; card: ShowCard; onSaved: () => void; onAuth: () => void }) {
  const [editing, setEditing] = useState(false);
  const [measure, setMeasure] = useState<TargetMeasure>("paidTickets");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const currency = card.currency ?? "USD";
  const isCount = measure === "paidTickets";

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    // Parse money as a decimal string into integer minor units (no floats).
    const trimmed = value.trim().replace(/,/g, "");
    let minor: number;
    if (isCount) {
      if (!/^\d+$/.test(trimmed)) return setError("Enter a whole number of tickets.");
      minor = Number(trimmed);
    } else {
      const scale = currencyScale(currency);
      const m = trimmed.match(scale > 0 ? new RegExp(`^(\\d+)(?:\\.(\\d{1,${scale}}))?$`) : /^(\d+)$/);
      if (!m) return setError(scale > 0 ? "Enter an amount like 18000 or 18000.50." : "Enter a whole amount.");
      minor = Number(m[1]) * 10 ** scale + Number((m[2] ?? "").padEnd(scale, "0") || "0");
    }
    try {
      await api.setTarget(org.id, eventId, { measure, value: minor, currency: isCount ? null : currency });
      setEditing(false);
      setValue("");
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onAuth();
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const remove = async (m: TargetMeasure) => {
    await api.deleteTarget(org.id, eventId, m).catch(() => undefined);
    onSaved();
  };

  return (
    <section className="card" aria-labelledby="tgt-h">
      <div className="card-title-row">
        <h2 id="tgt-h" className="card-title">Targets</h2>
        {org.role === "admin" && !editing && <button className="link" onClick={() => setEditing(true)}>Set target</button>}
      </div>
      {card.targets.length === 0 && !editing && <p className="muted small">No targets set. Targets are plan values entered here until a planning integration (Airtable, M5) supplies them.</p>}
      {card.targets.map((t) => (
        <div key={t.measure} className="target-row">
          <TargetBar t={t} />
          {org.role === "admin" && <button className="link small" onClick={() => remove(t.measure)} aria-label={`Remove ${t.label} target`}>Remove</button>}
        </div>
      ))}
      {editing && (
        <form className="target-form" onSubmit={save}>
          <label htmlFor="tm">Measure</label>
          <select id="tm" value={measure} onChange={(e) => setMeasure(e.target.value as TargetMeasure)}>
            {(Object.keys(TARGET_LABELS) as TargetMeasure[]).map((m) => <option key={m} value={m}>{TARGET_LABELS[m]}</option>)}
          </select>
          <label htmlFor="tv">{isCount ? "Tickets" : `Amount (${currency})`}</label>
          <input id="tv" inputMode={isCount ? "numeric" : "decimal"} value={value} onChange={(e) => setValue(e.target.value)} required />
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="row">
            <button type="submit" className="primary">Save target</button>
            <button type="button" className="link" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}

function SyncStatus({ e, tz }: { e: EventDto; tz: string }) {
  const c = e.connection;
  const run = e.freshness.latestRun;
  return (
    <div className={`card status-card ${e.freshness.stale ? "is-stale" : ""}`}>
      <div className="status-grid">
        <div><span className="k">Connection</span><span className="v"><ConnectionBadge status={c.status} /> {c.mode === "fixture" && <span className="tag fixture-tag">FIXTURE</span>}</span></div>
        <div><span className="k">Last attempt</span><span className="v">{fmtDateTime(c.lastAttemptAt, tz)}</span></div>
        <div><span className="k">Last success</span><span className="v">{fmtDateTime(c.lastSuccessAt, tz)}</span></div>
        <div><span className="k">Totals computed</span><span className="v">{fmtDateTime(e.freshness.dataAsOf, tz)}</span></div>
        <div><span className="k">Source event last changed</span><span className="v">{fmtDateTime(e.source.sourceUpdatedAt, tz)}</span></div>
        <div><span className="k">Last sync</span><span className="v">{run ? `${run.status}${run.error_kind ? ` (${run.error_kind})` : ""}` : "none"}</span></div>
      </div>
      {e.freshness.stale && (
        <p className="stale-note"><strong>Stale:</strong> the most recent refresh failed. Figures below are the last successful read and may be out of date.</p>
      )}
      {c.statusDetail && <p className="small">{c.statusDetail}</p>}
      {c.action && <p className="small action">{c.action}</p>}
    </div>
  );
}

const MEASURE_ORDER = ["grossSales", "refunds", "grossAfterRefunds", "ticketFaceValue", "platformFees", "paymentFees", "tax", "discounts", "organizerProceeds", "cashRemitted"] as const;

function CurrencySection({ c, defs, stale, comparison }: { c: CurrencyRevenue; defs: EventDetailResponse["definitions"]; stale: boolean; comparison: ReconciliationRow[] | null }) {
  const reportRows = (comparison ?? []).filter((r) => r.key.startsWith("report_"));
  return (
    <section className="currency" aria-labelledby={`cur-${c.currency}`}>
      <h2 id={`cur-${c.currency}`}>{c.currency} {stale && <span className="tag partial">stale</span>}</h2>

      <div className="tiles">
        <Tile label="Paid tickets" value={`${c.tickets.paid}${c.tickets.partial ? "+" : ""}`} hint={c.tickets.partial ? "Some orders lack ticket detail" : "Active, priced tickets in completed orders"} />
        <Tile label="Comp tickets" value={String(c.tickets.comp)} hint="Zero-price active tickets" />
        <Tile label="Refunded tickets" value={String(c.tickets.refunded)} />
        <Tile label="Cancelled tickets" value={String(c.tickets.cancelled)} />
        <Tile label="Unpaid / pending" value={String(c.tickets.unpaid)} hint="Not counted as sales" />
        <Tile label="Paid tickets, last 7 days" value={String(c.last7Days.paidTickets)} hint="By transaction date" />
      </div>

      <h3>Revenue components</h3>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th scope="col">Measure</th><th scope="col" className="num">Value</th><th scope="col">Definition and provenance</th></tr></thead>
          <tbody>
            {MEASURE_ORDER.map((k) => {
              const m = c.measures[k];
              return (
                <tr key={k} className={k === "organizerProceeds" ? "emph" : undefined}>
                  <th scope="row">{defs[k]?.label ?? k}</th>
                  <td className="num">{fmtMeasure(m, c.currency)} <MeasureStatusTag m={m} /></td>
                  <td className="small">{defs[k]?.definition}{m.note && m.note !== defs[k]?.definition ? <><br /><em>{m.note}</em></> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">Orders: {c.orders.completed} completed, {c.orders.refunded} refunded, {c.orders.cancelled} cancelled, {c.orders.unpaid} unpaid{c.orders.other ? `, ${c.orders.other} unrecognised` : ""}. Source: Eventbrite order and attendee reads. Time window: all transactions for this performance.</p>

      <h3>Reconciliation</h3>
      <ReconTable rows={[...c.reconciliation, ...reportRows]} currency={c.currency} />
      {reportRows.length === 0 && <p className="small muted">No source report has been entered for comparison yet. Live verification requires comparing against Eventbrite's own sales report with identical filters (see README).</p>}
    </section>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      {hint && <span className="tile-hint">{hint}</span>}
    </div>
  );
}

function ReconTable({ rows, currency }: { rows: ReconciliationRow[]; currency: string }) {
  if (rows.length === 0) return <p className="small muted">No comparable rows (e.g. all orders have refunds or no ticket detail).</p>;
  const v = (r: ReconciliationRow, n: number | null) => (n === null ? "Unknown" : r.unit === "count" ? String(n) : formatMoney(n, currency));
  return (
    <div className="table-wrap">
      <table className="data">
        <thead><tr><th scope="col">Check</th><th scope="col" className="num">Left</th><th scope="col" className="num">Right</th><th scope="col" className="num">Difference</th><th scope="col">Result</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.label}</th>
              <td className="num">{r.left.label}: {v(r, r.left.minor)}</td>
              <td className="num">{r.right.label}: {v(r, r.right.minor)}</td>
              <td className="num">{v(r, r.difference)}</td>
              <td><span className={`tag ${r.explained ? "ok" : "bad"}`}>{r.explained ? "Reconciled" : "Unexplained"}</span> <span className="small">{r.explanation}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Exceptions({ list }: { list: RevenueException[] }) {
  const [open, setOpen] = useState(false);
  if (list.length === 0) return <section><h2>Exceptions</h2><p className="muted">None.</p></section>;
  const shown = open ? list : list.slice(0, 8);
  return (
    <section>
      <h2>Exceptions <span className="muted small">({list.length})</span></h2>
      <ul className="exceptions">
        {shown.map((x, i) => (
          <li key={i} className={`sev-${x.severity}`}>
            <span className={`tag sev ${x.severity}`}>{x.severity}</span> <code>{x.code}</code>
            {x.orderSourceId && <> · order <code>{x.orderSourceId}</code></>} — {x.message}
          </li>
        ))}
      </ul>
      {list.length > 8 && <button className="link" onClick={() => setOpen(!open)}>{open ? "Show fewer" : `Show all ${list.length}`}</button>}
    </section>
  );
}

function TicketClasses({ rows }: { rows: EventDetailResponse["ticketClasses"] }) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h2>Ticket lines by class</h2>
      <p className="small muted">Ticket-line gross from sales orders (completed or refunded), by line status. Informational; headline totals use order-level values.</p>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th scope="col">Ticket class</th><th scope="col">Line status</th><th scope="col" className="num">Tickets</th><th scope="col" className="num">Line gross</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <th scope="row">{r.ticket_class_name ?? "(unnamed)"}</th>
                <td>{r.status}</td>
                <td className="num">{r.quantity}</td>
                <td className="num">{r.gross_minor === null ? "Unknown" : formatMoney(r.gross_minor, r.currency.trim())}{r.unknown_gross ? ` (+${r.unknown_gross} unknown)` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SyncHistory({ runs, tz }: { runs: EventDetailResponse["syncRuns"]; tz: string }) {
  if (runs.length === 0) return null;
  return (
    <section>
      <h2>Sync history</h2>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th scope="col">Started</th><th scope="col">Result</th><th scope="col" className="num">Pages / requests</th><th scope="col" className="num">Orders (new / updated / missing)</th><th scope="col">Detail</th></tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{fmtDateTime(r.started_at, tz)}</td>
                <td><span className={`tag ${r.status === "succeeded" ? "ok" : r.status === "failed" ? "bad" : ""}`}>{r.status}</span></td>
                <td className="num">{r.pages_fetched ?? "—"} / {r.requests_made ?? "—"}</td>
                <td className="num">{r.orders_seen ?? "—"} ({r.orders_inserted ?? 0} / {r.orders_updated ?? 0} / {r.orders_missing ?? 0})</td>
                <td className="small">{r.error_kind ? `${r.error_kind}: ${r.error_message ?? ""}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ integrations

function IntegrationsPage({ org, onAuth }: { org: Organization; onAuth: () => void }) {
  const { data, error, reload } = useLoad(() => api.connections(org.id), onAuth, [org.id]);
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string }>>({});
  if (error) return <ErrorBox title="Could not load integrations" detail={error} />;
  if (!data) return <p className="muted">Loading…</p>;

  const test = async (id: string) => {
    setResults((r) => ({ ...r, [id]: { ok: true, text: "Testing…" } }));
    try {
      const out = await api.testConnection(org.id, id);
      setResults((r) => ({ ...r, [id]: { ok: true, text: out.message } }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onAuth();
      const body = e instanceof ApiError ? e.body : {};
      setResults((r) => ({ ...r, [id]: { ok: false, text: `${String(body.message ?? (e as Error).message)} ${String(body.action ?? "")}` } }));
    } finally {
      reload();
    }
  };

  return (
    <section>
      <div className="page-head">
        <h1>Integrations</h1>
        <p className="muted">All connections are read-only. Credentials live in the server's secret store; RevOS stores only the name of the secret.</p>
      </div>
      <ConnectionsTable data={data} results={results} canTest={org.role === "admin"} onTest={test} tz={org.timezone} />
      <h2>Planned</h2>
      <div className="planned">
        {data.planned.map((p) => (
          <div key={p.provider} className="card planned-card">
            <strong>{p.label}</strong> <span className="tag">{p.milestone}</span>
            <div className="small muted">{p.role}</div>
            <div className="small">Not yet available</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ConnectionsTable({ data, results, canTest, onTest, tz }: {
  data: ConnectionsResponse; results: Record<string, { ok: boolean; text: string }>; canTest: boolean; onTest: (id: string) => void; tz: string;
}) {
  if (data.connections.length === 0) return <div className="card"><p>No connections yet. Register the Eventbrite pilot with <code>npm run setup:live</code>.</p></div>;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th scope="col">Provider</th><th scope="col">Account</th><th scope="col">Status</th><th scope="col">Credential</th>
            <th scope="col">Last attempt</th><th scope="col">Last success</th><th scope="col" className="num">Shows</th><th scope="col">Proceeds rule</th><th scope="col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {data.connections.map((c) => (
            <tr key={c.id}>
              <th scope="row">{c.provider === "eventbrite" ? "Eventbrite" : c.provider} {c.mode === "fixture" && <span className="tag fixture-tag">FIXTURE</span>}</th>
              <td><code>{c.providerAccountId}</code></td>
              <td>
                <ConnectionBadge status={c.status} />
                {c.action && <div className="small action">{c.action}</div>}
              </td>
              <td className="small">{c.mode === "fixture" ? "n/a (fixture)" : c.secretPresent ? <>Set on server (<code>{c.secretRef}</code>)</> : <span className="tag bad">Missing: {c.secretRef}</span>}</td>
              <td className="small">{fmtDateTime(c.lastAttemptAt, tz)}</td>
              <td className="small">{fmtDateTime(c.lastSuccessAt, tz)}</td>
              <td className="num">{c.mappedEvents}</td>
              <td className="small">{c.proceedsPolicy === "unverified" ? "Not derived (fee ownership unverified)" : "Gross − fees − tax"}</td>
              <td>
                {canTest && <button className="secondary" onClick={() => onTest(c.id)}>Test connection</button>}
                {results[c.id] && <div className={`small ${results[c.id]!.ok ? "" : "form-error"}`} role="status">{results[c.id]!.text}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
