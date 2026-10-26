import { eveChannel } from "eve/channels/eve";
import type { AuthFn } from "eve/channels/auth";
import { createClient } from "@supabase/supabase-js";

// Accept only a valid Supabase user access token (Authorization: Bearer <jwt>).
// Project membership is checked again by every tool through the orchestrator.
const supabaseUser: AuthFn<Request> = async (request) => {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data } = await sb.auth.getUser(token);
  if (!data.user) return null;
  return { authenticator: "supabase", principalId: data.user.id, principalType: "user", attributes: {} };
};

export default eveChannel({ auth: [supabaseUser] });
