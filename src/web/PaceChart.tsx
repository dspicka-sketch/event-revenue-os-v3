// 14-day sales pace: one series (paid tickets per venue-local sale day).
// Single hue, columns from one baseline, hover tooltip, and a table view.
import { useState } from "react";
import type { DailySales } from "../domain/revenue.js";
import { formatMoney } from "./format.js";

const W = 560;
const H = 180;
const PAD = { top: 16, right: 8, bottom: 26, left: 32 };

function niceMax(v: number): number {
  if (v <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

function shortDate(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/** Column with a 4px rounded data-end and a square baseline. */
function columnPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function PaceChart({ days, currency }: { days: DailySales[]; currency: string | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...days.map((d) => d.paidTickets)));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / days.length;
  const barW = Math.min(24, slot - 2);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const total = days.reduce((a, d) => a + d.paidTickets, 0);
  const h = hover !== null ? days[hover] : null;

  return (
    <figure className="pace">
      <figcaption>
        <strong>Paid tickets per day, last 14 days</strong>
        <span className="muted small"> · by sale date, venue time · {total} total</span>
      </figcaption>
      <div className="pace-plot" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Paid tickets per day for the last 14 days, ${total} in total. Table view below.`}>
          {[0, max / 2, max].map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="grid" />
              <text x={PAD.left - 6} y={y(t)} className="axis" textAnchor="end" dominantBaseline="middle">{Number.isInteger(t) ? t : t.toFixed(1)}</text>
            </g>
          ))}
          {days.map((d, i) => {
            const x = PAD.left + i * slot + (slot - barW) / 2;
            return (
              <g key={d.date}>
                <path d={columnPath(x, y(d.paidTickets), barW, y(0) - y(d.paidTickets))} className={hover === i ? "bar hover" : "bar"} />
                {(i % 2 === 1 || days.length <= 7) && (
                  <text x={x + barW / 2} y={H - 8} className="axis" textAnchor="middle">{shortDate(d.date)}</text>
                )}
                {/* Hit target: the whole slot, taller than the mark. */}
                <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} fill="transparent"
                  onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}
                  aria-label={`${d.date}: ${d.paidTickets} paid tickets`} />
              </g>
            );
          })}
        </svg>
        {h && hover !== null && (
          <div className="tooltip" style={{ left: `${((PAD.left + hover * slot + slot / 2) / W) * 100}%` }} role="status">
            <strong>{h.date}</strong><br />
            {h.paidTickets} paid tickets
            {currency && <><br />{h.grossAfterRefundsMinor === null ? "Gross unknown" : `${formatMoney(h.grossAfterRefundsMinor, currency)} gross after refunds`}</>}
          </div>
        )}
      </div>
      <details className="small">
        <summary>Table view</summary>
        <table className="data compact">
          <thead><tr><th scope="col">Sale date</th><th scope="col" className="num">Paid tickets</th><th scope="col" className="num">Gross after refunds</th></tr></thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date}>
                <td>{d.date}</td>
                <td className="num">{d.paidTickets}</td>
                <td className="num">{d.grossAfterRefundsMinor === null || !currency ? "Unknown" : formatMoney(d.grossAfterRefundsMinor, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
