// Manual sync of one marketing connection (e.g. Mailchimp): bounded read of
// sent campaigns and their event links, then persist. Organization-level, not
// per show; shows pick up campaigns through their Eventbrite event IDs.

import type { NormalizedCampaign } from "../domain/types.js";
import { claimSyncRun, completeConnectionSyncRun, failSyncRun, getConnection, persistCampaigns, type ConnectionRow } from "../db/repo.js";
import type { Db } from "../db/pool.js";
import { ProviderError } from "../providers/errors.js";
import { MailchimpAdapter } from "../providers/mailchimp/adapter.js";
import { createMailchimpFixtureTransport } from "../providers/mailchimp/fixtures.js";

export interface MarketingAdapter {
  validate(): Promise<{ ok: true }>;
  fetchCampaigns(): Promise<{ campaigns: NormalizedCampaign[]; requestsMade: number }>;
}

export type MarketingAdapterFactory = (connection: ConnectionRow) => MarketingAdapter;

export const defaultMarketingAdapterFactory: MarketingAdapterFactory = (connection) => {
  if (connection.provider !== "mailchimp") throw new ProviderError("not_configured", `No marketing adapter for provider '${connection.provider}'.`);
  if (connection.mode === "fixture") {
    const t = createMailchimpFixtureTransport();
    return new MailchimpAdapter({ apiKey: "fixture-us1", baseUrl: "https://us1.api.mailchimp.com/3.0/", accountId: connection.provider_account_id, fetchImpl: t.fetch, sleep: async () => {} }, () => new Date("2026-10-20T19:00:00Z"));
  }
  const apiKey = connection.secret_ref ? process.env[connection.secret_ref] : undefined;
  if (!apiKey) throw new ProviderError("not_configured", `Server secret ${connection.secret_ref ?? "(none)"} is not set.`);
  return new MailchimpAdapter({ apiKey, accountId: connection.provider_account_id });
};

export type MarketingSyncOutcome =
  | { ok: true; runId: string; campaigns: number }
  | { ok: false; runId: string | null; kind: string; message: string; retryAfterSeconds?: number };

export async function syncMarketingConnection(
  db: Db,
  orgId: string,
  connectionId: string,
  factory: MarketingAdapterFactory = defaultMarketingAdapterFactory,
  cooldownSeconds = 0,
): Promise<MarketingSyncOutcome> {
  const connection = await getConnection(db, orgId, connectionId);
  if (!connection) return { ok: false, runId: null, kind: "not_found", message: "Connection not found in this organization." };
  const claim = await claimSyncRun(db, orgId, connection.id, null, cooldownSeconds);
  if (!claim.ok) {
    return claim.kind === "busy"
      ? { ok: false, runId: null, kind: "busy", message: "A sync for this connection is already running." }
      : { ok: false, runId: null, kind: "cooldown", message: `Synced moments ago. Try again in ${claim.retryAfterSeconds} s.`, retryAfterSeconds: claim.retryAfterSeconds };
  }
  const runId = claim.runId;
  let read: { campaigns: NormalizedCampaign[]; requestsMade: number };
  try {
    read = await factory(connection).fetchCampaigns();
  } catch (err) {
    const kind = err instanceof ProviderError ? err.kind : "internal";
    const message = err instanceof Error ? err.message : String(err);
    await failSyncRun(db, orgId, connection.id, runId, kind, message);
    return { ok: false, runId, kind, message };
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await persistCampaigns(client, { orgId, connection, runId }, read.campaigns);
    await completeConnectionSyncRun(client, { orgId, connection, runId }, { requestsMade: read.requestsMade, campaignsSeen: read.campaigns.length });
    await client.query("COMMIT");
    return { ok: true, runId, campaigns: read.campaigns.length };
  } catch (err) {
    await client.query("ROLLBACK");
    const message = err instanceof Error ? err.message : String(err);
    await failSyncRun(db, orgId, connection.id, runId, "internal", message);
    return { ok: false, runId, kind: "internal", message };
  } finally {
    client.release();
  }
}
