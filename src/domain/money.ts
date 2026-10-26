// Money primitives. All amounts are integer minor units (e.g. cents) tagged with
// an ISO 4217 currency. Floating point is never used for totals, and different
// currencies are never added together. A missing amount is `null` (unknown),
// never zero.

export type MinorUnits = number;

export interface Money {
  currency: string;
  minor: MinorUnits;
}

const scaleCache = new Map<string, number>();

/** Number of minor-unit digits for a currency (USD 2, JPY 0, BHD 3). */
export function currencyScale(currency: string): number {
  const code = currency.toUpperCase();
  const cached = scaleCache.get(code);
  if (cached !== undefined) return cached;
  const scale = new Intl.NumberFormat("en", { style: "currency", currency: code })
    .resolvedOptions().maximumFractionDigits ?? 2;
  scaleCache.set(code, scale);
  return scale;
}

export function assertMinor(value: unknown, context: string): MinorUnits {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${context}: expected integer minor units, got ${String(value)}`);
  }
  return value;
}

export function addMinor(a: MinorUnits, b: MinorUnits): MinorUnits {
  const r = a + b;
  if (!Number.isSafeInteger(r)) throw new Error("Money overflow");
  return r;
}

export function subMinor(a: MinorUnits, b: MinorUnits): MinorUnits {
  return addMinor(a, -b);
}

export type MeasureStatus = "complete" | "partial" | "unavailable";

/**
 * A summed measure that tracks how many inputs were unknown. If any input is
 * unknown the result is `partial` and its value is a lower bound over the known
 * inputs only; if all are unknown (or none exist and the measure is not
 * supported) it is `unavailable`.
 */
export interface Measure {
  status: MeasureStatus;
  minor: MinorUnits | null;
  knownCount: number;
  unknownCount: number;
  note?: string;
}

export class MeasureSum {
  private minor: MinorUnits = 0;
  private known = 0;
  private unknown = 0;

  add(value: MinorUnits | null | undefined): this {
    if (value === null || value === undefined) this.unknown++;
    else {
      this.minor = addMinor(this.minor, value);
      this.known++;
    }
    return this;
  }

  subtract(value: MinorUnits | null | undefined): this {
    return this.add(value === null || value === undefined ? value : -value);
  }

  result(note?: string): Measure {
    const status: MeasureStatus =
      this.unknown === 0 ? "complete" : this.known === 0 ? "unavailable" : "partial";
    return {
      status,
      minor: status === "unavailable" ? null : this.minor,
      knownCount: this.known,
      unknownCount: this.unknown,
      ...(note ? { note } : {}),
    };
  }
}

export function unavailable(note: string): Measure {
  return { status: "unavailable", minor: null, knownCount: 0, unknownCount: 0, note };
}

/** Combine measures arithmetically (a - b ...), propagating the weakest status. */
export function combine(parts: { sign: 1 | -1; m: Measure }[], note?: string): Measure {
  let minor = 0;
  let known = 0;
  let unknown = 0;
  let anyUnavailable = false;
  let anyPartial = false;
  for (const { sign, m } of parts) {
    known += m.knownCount;
    unknown += m.unknownCount;
    if (m.status === "unavailable") anyUnavailable = true;
    if (m.status === "partial") anyPartial = true;
    if (m.minor !== null) minor = addMinor(minor, sign * m.minor);
  }
  if (anyUnavailable) return { status: "unavailable", minor: null, knownCount: known, unknownCount: unknown, ...(note ? { note } : {}) };
  return {
    status: anyPartial ? "partial" : "complete",
    minor,
    knownCount: known,
    unknownCount: unknown,
    ...(note ? { note } : {}),
  };
}

/** Format minor units for display, e.g. 123456 USD -> "$1,234.56". */
export function formatMoney(minor: MinorUnits, currency: string, locale = "en-US"): string {
  const scale = currencyScale(currency);
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const divisor = 10 ** scale;
  const major = Math.trunc(abs / divisor);
  const frac = abs % divisor;
  // Build the string from integers so no floating-point rounding is involved.
  const parts = new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: scale, maximumFractionDigits: scale })
    .formatToParts(0);
  const symbol = parts.filter((p) => p.type === "currency").map((p) => p.value).join("");
  const majorStr = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(major);
  const fracStr = scale > 0 ? "." + String(frac).padStart(scale, "0") : "";
  return `${negative ? "-" : ""}${symbol}${majorStr}${fracStr}`;
}

/**
 * Compact display for glanceable surfaces, e.g. 1389885 USD -> "$13.9K".
 * Integer arithmetic only; below 1,000 major units shows whole units ("$812").
 */
export function formatMoneyCompact(minor: MinorUnits, currency: string, locale = "en-US"): string {
  const scale = currencyScale(currency);
  const negative = minor < 0;
  const major = Math.trunc(Math.abs(minor) / 10 ** scale);
  const symbol = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 })
    .formatToParts(0).filter((p) => p.type === "currency").map((p) => p.value).join("");
  let body: string;
  if (major < 1000) body = String(major);
  else {
    // Pick the unit after rounding so 999,950 becomes "1M", not "1000K".
    const units: [number, string][] = [[100, "K"], [100_000, "M"], [100_000_000, "B"]];
    let i = 0;
    let tenths = Math.floor((major + units[0]![0] / 2) / units[0]![0]); // round half up, in tenths of the unit
    while (tenths >= 10_000 && i < units.length - 1) {
      i++;
      tenths = Math.floor((major + units[i]![0] / 2) / units[i]![0]);
    }
    const whole = Math.floor(tenths / 10);
    const frac = tenths % 10;
    body = `${whole}${frac && whole < 100 ? `.${frac}` : ""}${units[i]![1]}`;
  }
  return `${negative ? "-" : ""}${symbol}${body}`;
}

/**
 * Parse a typed amount ("300", "1,250.50") in major units into integer minor
 * units for `currency`, without floating point. Returns null if invalid.
 */
export function parseMoneyInput(text: string, currency: string): MinorUnits | null {
  const scale = currencyScale(currency);
  const t = text.trim().replace(/[,\s]/g, "").replace(/^[$€£¥]/, "");
  const m = t.match(scale > 0 ? new RegExp(`^(\\d{1,12})(?:\\.(\\d{1,${scale}}))?$`) : /^(\d{1,12})$/);
  if (!m) return null;
  const minor = Number(m[1]) * 10 ** scale + (scale > 0 ? Number((m[2] ?? "").padEnd(scale, "0")) : 0);
  return Number.isSafeInteger(minor) ? minor : null;
}
