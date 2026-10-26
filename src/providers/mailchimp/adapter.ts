// Mailchimp connector: health, bounded reads of sent campaigns and their link
// clicks, normalization to campaigns linked to ticketing events.

import type { NormalizedCampaign } from "../../domain/types.js";
import { ProviderError } from "../errors.js";
import { MailchimpClient, type MailchimpClientOptions } from "./client.js";
import { normalizeCampaign, type McClickedUrl, type McReport } from "./normalize.js";

export interface MailchimpAdapterConfig extends MailchimpClientOptions {
  /** Mailchimp account the connection is authorized for. */
  accountId: string;
  /** Only campaigns sent within this many days are read. */
  lookbackDays?: number;
  /** Hard bound on campaigns per sync. */
  maxCampaigns?: number;
}

export class MailchimpAdapter {
  readonly provider = "mailchimp";
  constructor(private readonly config: MailchimpAdapterConfig, private readonly now: () => Date = () => new Date()) {}

  async validate(): Promise<{ ok: true }> {
    const root = await new MailchimpClient(this.config).get<{ account_id?: string }>("");
    if (root.account_id && root.account_id !== this.config.accountId) {
      throw new ProviderError("forbidden", `API key belongs to Mailchimp account ${root.account_id}, not the configured ${this.config.accountId}.`);
    }
    return { ok: true };
  }

  async fetchCampaigns(): Promise<{ campaigns: NormalizedCampaign[]; requestsMade: number }> {
    const client = new MailchimpClient(this.config);
    const root = await client.get<{ account_id?: string }>("");
    if (root.account_id && root.account_id !== this.config.accountId) {
      throw new ProviderError("forbidden", `API key belongs to Mailchimp account ${root.account_id}, not the configured ${this.config.accountId}.`);
    }
    const since = new Date(this.now().getTime() - (this.config.lookbackDays ?? 180) * 86400_000).toISOString();
    const reports = await client.listAll<McReport>("reports", "reports", { since_send_time: since });
    const max = this.config.maxCampaigns ?? 200;
    if (reports.length > max) throw new ProviderError("limit_exceeded", `${reports.length} campaigns in the lookback window exceed the bound of ${max}.`);
    const campaigns: NormalizedCampaign[] = [];
    for (const r of reports) {
      const clicked = await client.listAll<McClickedUrl>(`reports/${encodeURIComponent(r.id)}/click-details`, "urls_clicked");
      campaigns.push(normalizeCampaign(r, clicked));
    }
    return { campaigns, requestsMade: client.requestsMade };
  }
}
