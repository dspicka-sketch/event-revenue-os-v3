// Eventbrite connector: validation/health, bounded reads, normalization.

import type { NormalizedSnapshot } from "../../domain/types.js";
import { ProviderError } from "../errors.js";
import { EventbriteClient, type EventbriteClientOptions } from "./client.js";
import { normalizeAttendee, normalizeEvent, normalizeOrder, type EbAttendee, type EbEvent, type EbOrder } from "./normalize.js";

export interface EventbriteAdapterConfig extends EventbriteClientOptions {
  /** Eventbrite organization ID the connection is authorized for. */
  organizationId: string;
}

export class EventbriteAdapter {
  readonly provider = "eventbrite";

  constructor(private readonly config: EventbriteAdapterConfig) {}

  private client(): EventbriteClient {
    return new EventbriteClient(this.config);
  }

  /** Cheap authenticated read proving the token works. */
  async validate(): Promise<{ ok: true; userId: string }> {
    const me = await this.client().get<{ id?: string }>("users/me/");
    if (!me.id) throw new ProviderError("bad_response", "users/me returned no id.");
    return { ok: true, userId: String(me.id) };
  }

  /**
   * Full bounded read of one event (one performance). The pilot reconciles the
   * whole event on every refresh instead of relying on an unverified
   * incremental mechanism.
   */
  async fetchEventSnapshot(eventId: string): Promise<NormalizedSnapshot> {
    const client = this.client();
    const rawEvent = await client.get<EbEvent>(`events/${encodeURIComponent(eventId)}/`);
    if (rawEvent.organization_id && String(rawEvent.organization_id) !== this.config.organizationId) {
      throw new ProviderError(
        "forbidden",
        `Event ${eventId} belongs to Eventbrite organization ${rawEvent.organization_id}, not the configured organization ${this.config.organizationId}.`,
      );
    }
    const event = normalizeEvent(rawEvent);
    const rawOrders = await client.listAll<EbOrder>(`events/${encodeURIComponent(eventId)}/orders/`, "orders", { status: "all_not_deleted" });
    const rawAttendees = await client.listAll<EbAttendee>(`events/${encodeURIComponent(eventId)}/attendees/`, "attendees");

    const orders = dedupeById(rawOrders.map((o) => normalizeOrder(o, event.currency)));
    const lines = dedupeById(rawAttendees.map((a) => normalizeAttendee(a, event.currency)));
    for (const r of [...orders, ...lines]) {
      if (r.sourceEventId !== event.sourceId) {
        throw new ProviderError("bad_response", `Record ${r.sourceId} belongs to event ${r.sourceEventId}, not ${event.sourceId}.`);
      }
    }
    return { event, orders, lines, pagesFetched: client.pagesFetched, requestsMade: client.requestsMade };
  }
}

/** A record can appear on two pages if the listing shifts mid-read; keep the latest. */
function dedupeById<T extends { sourceId: string; sourceUpdatedAt: string | null }>(rows: T[]): T[] {
  const m = new Map<string, T>();
  for (const r of rows) {
    const prev = m.get(r.sourceId);
    if (!prev || (r.sourceUpdatedAt ?? "") >= (prev.sourceUpdatedAt ?? "")) m.set(r.sourceId, r);
  }
  return [...m.values()];
}
