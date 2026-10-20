import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { CurrencyRevenue, ReconciliationRow, RevenueException } from "../domain/revenue.js";
import type { Measure } from "../domain/money.js";
import { api, ApiError, setToken, type EventDetail, type EventDto, type Organization } from "./api.js";
import { fmtDateTime, fmtMeasure, fmtRelative, formatMoney } from "./format.js";

// ------------------------------------------------------------------ routing

type Route = { page: "home" } | { page: "org"; orgId: string } | { page: "event"; orgId: string; eventId: string };

function parseRoute(path: string): Route {
  const m = path.match(/^\/orgs\/([^/]+)(?:\/events\/([^/]+))?\/?$/);
  if (!m) return { page: "home" };
  return m[2] ? { page: "event", orgId: m[1]!, eventId: m[2] } : { page: "org", orgId: m[1]! };
}

function useRoute(): [Route, (to: string, replace?: boolean) => void] {
  const [route, setRoute] = useState(() => parseRoute(location.pathname));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.pathname));
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  const go = useCallback((to: string, replace = false) => {
    if (replace) history.replaceState(null, "", to);
    else history.pushState(null, "", to);
    setRoute(parseRoute(to));
    scrollTo(0, 0);
  }, []);
  return [route, go];
}

function Link({ to, go, children, className }: { to: string; go: (to: string) => void; children: ReactNode; className?: string }) {
  return (
    <a href={to} className={className} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); go(to); }}>
      {children}
    </a>
  );
}

// ------------------------------------------------------------------ app shell

export function App() {
  const [route, go] = useRoute();
  const [orgs, setOrgs] = useState<Organization[] | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOrgs = useCallback(() => {
    api.orgs().then((r) => { setOrgs(r.organizations); setNeedsAuth(false); setError(null); }).catch((e) => {
      if (e instanceof ApiError && e.status === 401) setNeedsAuth(true);
      else setError(e instanceof Error ? e.message : String(e));
    });
  }, []);
  useEffect(loadOrgs, [loadOrgs]);

  useEffect(() => {
    if (route.page === "home" && orgs && orgs.length > 0) {
      const preferred = orgs.find((o) => !o.is_fixture) ?? orgs[0]!;
      go(`/orgs/${preferred.id}`, true);
    }
  }, [route, orgs, go]);

  const orgId = route.page === "home" ? null : route.orgId;
  const org = orgs?.find((o) => o.id === orgId) ?? null;

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
      </header>
      {org?.is_fixture && <FixtureBanner />}
      {org && !org.is_fixture && <div className="mode-strip live" role="note">LIVE organization — data read from connected sources</div>}
      <main id="main">
        {needsAuth ? <TokenForm onDone={loadOrgs} />
          : error ? <ErrorBox title="Could not reach the RevOS server" detail={error} />
          : orgs === null ? <p className="muted">Loading…</p>
          : orgs.length === 0 ? <EmptySetup />
          : route.page === "org" ? <EventList orgId={route.orgId} go={go} onAuth={() => setNeedsAuth(true)} />
          : route.page === "event" ? <EventPage orgId={route.orgId} eventId={route.eventId} go={go} onAuth={() => setNeedsAuth(true)} />
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

function TokenForm({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState("");
  const submit = (e: FormEvent) => { e.preventDefault(); setToken(value.trim() || null); onDone(); };
  return (
    <form className="card narrow" onSubmit={submit}>
      <h1>Private access</h1>
      <p>This RevOS server requires an access token. It is kept only for this browser tab.</p>
      <label htmlFor="tok">Access token</label>
      <input id="tok" type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} />
      <button type="submit" className="primary">Continue</button>
    </form>
  );
}

function EmptySetup() {
  return (
    <div className="card narrow">
      <h1>No organizations yet</h1>
      <p>Create the isolated fixture demo with <code>npm run seed:fixture</code>, or register the live pilot event with <code>npm run setup:live</code> (see README).</p>
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

// ------------------------------------------------------------------ status badges

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

// ------------------------------------------------------------------ event list

function EventList({ orgId, go, onAuth }: { orgId: string; go: (to: string) => void; onAuth: () => void }) {
  const { data, error } = useLoad(() => api.events(orgId), onAuth, [orgId]);
  if (error) return <ErrorBox title="Could not load events" detail={error} />;
  if (!data) return <p className="muted">Loading…</p>;
  const tz = data.organization.timezone;
  return (
    <section>
      <div className="page-head">
        <h1>{data.organization.name}</h1>
        <p className="muted">Performance dates in {tz}. "Last 7 days" uses transaction (sales) date. Totals are per currency and never combined.</p>
      </div>
      {data.events.length === 0 ? (
        <div className="card"><p>No events mapped for this organization yet.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <caption className="sr-only">Events</caption>
            <thead>
              <tr>
                <th scope="col">Show / performance</th>
                <th scope="col">Performance date</th>
                <th scope="col" className="num">Net paid tickets</th>
                <th scope="col" className="num">Gross after refunds</th>
                <th scope="col" className="num">Organizer proceeds</th>
                <th scope="col" className="num">Last 7 days (paid tickets)</th>
                <th scope="col">Data freshness</th>
              </tr>
            </thead>
            <tbody>
              {data.events.flatMap((e) => eventRows(e, tz, go, orgId))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function eventRows(e: EventDto, tz: string, go: (to: string) => void, orgId: string) {
  const currencies = e.revenue?.currencies ?? [];
  const link = <Link to={`/orgs/${orgId}/events/${e.id}`} go={go}>{e.source.sourceName ?? e.name}</Link>;
  const fresh = <Freshness e={e} />;
  if (currencies.length === 0) {
    return [
      <tr key={e.id}>
        <th scope="row">{link}</th>
        <td>{fmtDateTime(e.performanceStartUtc, tz)}</td>
        <td colSpan={4} className="muted">No data yet — open the show and use Refresh.</td>
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
      <td className="num">{c.last7Days.paidTickets}</td>
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

// ------------------------------------------------------------------ event detail

function EventPage({ orgId, eventId, go, onAuth }: { orgId: string; eventId: string; go: (to: string) => void; onAuth: () => void }) {
  const { data, error, reload } = useLoad(() => api.event(orgId, eventId), onAuth, [orgId, eventId]);
  const [busy, setBusy] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<{ ok: boolean; text: string; action?: string } | null>(null);

  const refresh = async () => {
    setBusy(true);
    setRefreshMsg(null);
    try {
      await api.refresh(orgId, eventId);
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
  const { event: e, organization: org } = data;
  const tz = e.venueTimezone;

  return (
    <section>
      <nav className="crumbs" aria-label="Breadcrumb"><Link to={`/orgs/${orgId}`} go={go}>← {org.name}</Link></nav>
      <div className="page-head with-action">
        <div>
          <h1>{e.source.sourceName ?? e.name}</h1>
          <p className="muted">Performance: {fmtDateTime(e.performanceStartUtc, tz)} · Eventbrite event {e.source.sourceEventId}</p>
        </div>
        <button className="primary" onClick={refresh} disabled={busy} aria-busy={busy}>{busy ? "Refreshing…" : "Refresh"}</button>
      </div>
      <div aria-live="polite">
        {refreshMsg && (refreshMsg.ok
          ? <div className="callout ok">{refreshMsg.text}</div>
          : <ErrorBox title={refreshMsg.text} action={refreshMsg.action} />)}
      </div>

      <SyncStatus e={e} tz={tz} />

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

function CurrencySection({ c, defs, stale, comparison }: { c: CurrencyRevenue; defs: EventDetail["definitions"]; stale: boolean; comparison: ReconciliationRow[] | null }) {
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

function TicketClasses({ rows }: { rows: EventDetail["ticketClasses"] }) {
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

function SyncHistory({ runs, tz }: { runs: EventDetail["syncRuns"]; tz: string }) {
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
