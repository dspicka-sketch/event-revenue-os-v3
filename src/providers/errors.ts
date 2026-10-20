// Provider-neutral error classification so the UI can show a specific,
// actionable state for each failure.

export type ProviderErrorKind =
  | "not_configured" // missing secret / IDs
  | "auth" // 401: token invalid or revoked
  | "forbidden" // 403: token valid but lacks access to this org/event
  | "not_found" // 404: wrong event/org ID
  | "rate_limited" // 429 persisted after bounded retries
  | "timeout"
  | "network"
  | "server" // 5xx persisted after bounded retries
  | "bad_response" // unexpected payload shape
  | "limit_exceeded"; // our own page/request bound reached

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

const ACTIONS: Record<ProviderErrorKind, string> = {
  not_configured: "Add the required credential and IDs to the server's environment (see README → Live setup), then Refresh.",
  auth: "The access token was rejected. Create a new private token in the provider account and update the server secret.",
  forbidden: "The token cannot read this organization or event. Use a token from a user with access to the organization that owns the event.",
  not_found: "The configured organization or event ID was not found. Check the IDs in the server environment.",
  rate_limited: "The provider's rate limit was reached. Wait before refreshing again; last good data is retained.",
  timeout: "The provider did not respond in time. Try Refresh again later; last good data is retained.",
  network: "The provider could not be reached from the server. Check network access; last good data is retained.",
  server: "The provider returned server errors. Try again later; last good data is retained.",
  bad_response: "The provider returned an unexpected response. Report this; the adapter may need updating.",
  limit_exceeded: "The read exceeded RevOS's safety bounds for one sync. Raise the bound deliberately if the event is that large.",
};

export function actionFor(kind: string): string {
  return ACTIONS[kind as ProviderErrorKind] ?? "Unexpected error. Check server logs.";
}
