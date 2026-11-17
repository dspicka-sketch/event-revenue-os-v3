// Builds AutoRev's options from the server environment. A feature is on only
// when everything it needs is set; a half-configured pair stays off.

import { WAX_POETIC_RULES } from "../domain/discovery.js";
import { resendSender } from "../notify/email.js";
import { fetchAreaShows } from "../providers/bayshows/client.js";
import type { AutoRevOptions } from "./autorev.js";

const val = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

export function autoRevOptionsFromEnv(env: Record<string, string | undefined>): AutoRevOptions {
  const url = val(env.BAYSHOWS_SUPABASE_URL);
  const key = val(env.BAYSHOWS_SUPABASE_KEY);
  const apiKey = val(env.RESEND_API_KEY);
  const from = val(env.REVOS_DIGEST_FROM);
  return {
    cronSecret: val(env.CRON_SECRET),
    discoveryOrgId: val(env.REVOS_DISCOVERY_ORG_ID),
    areaShowsSource: url && key ? (now) => fetchAreaShows({ url, key, now, windowDays: WAX_POETIC_RULES.windowDays }) : undefined,
    emailSender: apiKey && from ? resendSender({ apiKey, from }) : undefined,
  };
}
