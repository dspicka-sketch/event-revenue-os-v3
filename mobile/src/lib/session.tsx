import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MeResponse, Organization } from "@revos/shared/apiTypes";
import { ApiError, createClient, normalizeServerUrl, type Client } from "./api";
import { getItem, setItem } from "./storage";

const K_TOKEN = "revos.session";
const K_SERVER = "revos.server";
const K_ORG = "revos.org";

export const DEFAULT_SERVER = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8787";

interface SessionState {
  ready: boolean;
  serverUrl: string;
  me: MeResponse | null;
  org: Organization | null;
  client: Client;
  signIn(serverUrl: string, email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  selectOrg(id: string): void;
  /** Call when any request returns 401: the session is gone. */
  handleAuthError(e: unknown): boolean;
}

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const token = useRef<string | null>(null);
  const client = useMemo(() => createClient(serverUrl, () => token.current), [serverUrl]);

  const clear = useCallback(async () => {
    token.current = null;
    setMe(null);
    await setItem(K_TOKEN, null);
  }, []);

  // Restore a saved session on launch.
  useEffect(() => {
    (async () => {
      const [t, s, o] = await Promise.all([getItem(K_TOKEN), getItem(K_SERVER), getItem(K_ORG)]);
      const url = s ?? DEFAULT_SERVER;
      setServerUrl(url);
      setOrgId(o);
      if (t) {
        token.current = t;
        try {
          setMe(await createClient(url, () => t).me());
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) await clear();
          // Network errors keep the token so the user can retry when back online.
        }
      }
      setReady(true);
    })();
  }, [clear]);

  const signIn = useCallback(async (url: string, email: string, password: string) => {
    const base = normalizeServerUrl(url);
    const c = createClient(base, () => null);
    const { token: t } = await c.login(email.trim(), password);
    token.current = t;
    const profile = await createClient(base, () => t).me();
    await Promise.all([setItem(K_TOKEN, t), setItem(K_SERVER, base)]);
    setServerUrl(base);
    setMe(profile);
  }, []);

  const signOut = useCallback(async () => {
    try { await client.logout(); } catch { /* revoke best-effort */ }
    await clear();
  }, [client, clear]);

  const selectOrg = useCallback((id: string) => {
    setOrgId(id);
    void setItem(K_ORG, id);
  }, []);

  const handleAuthError = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) { void clear(); return true; }
    return false;
  }, [clear]);

  const orgs = me?.organizations ?? [];
  const org = orgs.find((o) => o.id === orgId) ?? orgs.find((o) => !o.is_fixture) ?? orgs[0] ?? null;

  const value = useMemo<SessionState>(
    () => ({ ready, serverUrl, me, org, client, signIn, signOut, selectOrg, handleAuthError }),
    [ready, serverUrl, me, org, client, signIn, signOut, selectOrg, handleAuthError],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
