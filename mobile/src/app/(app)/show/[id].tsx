import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import type { EventDetailResponse } from "@revos/shared/apiTypes";
import { PaceBars } from "../../../components/PaceBars";
import { AttentionRow, Card, FixtureBanner, Pill, Stat, TargetMeter, s } from "../../../components/ui";
import { ago, formatMoney, showDate, whenLabel } from "../../../lib/format";
import { ApiError } from "../../../lib/api";
import { useSession } from "../../../lib/session";
import { useTheme } from "../../../lib/theme";

export default function ShowScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { org, client, handleAuthError } = useSession();
  const [data, setData] = useState<EventDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!org || !id) return;
    try {
      setData(await client.event(org.id, id));
      setError(null);
    } catch (e) {
      if (!handleAuthError(e)) setError(e instanceof Error ? e.message : String(e));
    }
  }, [org, id, client, handleAuthError]);
  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    if (!org || !id) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      await client.refresh(org.id, id);
      setSyncMsg({ ok: true, text: "Updated from source." });
    } catch (e) {
      if (handleAuthError(e)) return;
      const body = e instanceof ApiError ? e.body : {};
      setSyncMsg({ ok: false, text: `${String(body.message ?? (e as Error).message)}${body.action ? `\n${String(body.action)}` : ""}` });
    } finally {
      setSyncing(false);
      void load();
    }
  };

  if (error) return <Text style={{ color: t.badFg, padding: 16 }}>{error}</Text>;
  if (!data) return <ActivityIndicator style={{ marginTop: 32 }} />;
  const { card } = data;
  const cur = card.currency;
  const rev = cur ? data.event.revenue?.currencies.find((c) => c.currency === cur) : undefined;
  const money = (m: { status: string; minor: number | null } | undefined) =>
    !m || m.status === "unavailable" || m.minor === null || !cur ? "Unavailable" : formatMoney(m.minor, cur) + (m.status === "partial" ? " (partial)" : "");

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: whenLabel(card) }} />
      {card.mode === "fixture" && <FixtureBanner />}
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
        <Text style={{ color: t.text, fontSize: 22, fontWeight: "800" }}>{card.name}</Text>
        <Text style={{ color: t.muted, marginBottom: 12 }}>{showDate(card.performanceStartUtc, card.venueTimezone)}</Text>

        {card.attention.length > 0 && (
          <Card>
            <Text style={{ color: t.text, fontWeight: "700" }}>Needs attention</Text>
            {card.attention.map((a, i) => <AttentionRow key={i} item={a} />)}
          </Card>
        )}

        <Card>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Stat label="Paid tickets" value={card.tickets ? card.tickets.paid.toLocaleString("en-US") : "—"} sub={card.tickets ? `${card.tickets.comp} comp · ${card.tickets.refunded} refunded` : undefined} />
            <Stat label="Last 7 days" value={card.pace ? `+${card.pace.last7DaysPaidTickets}` : "—"} sub={card.pace ? `prior 7: ${card.pace.previous7DaysPaidTickets}` : undefined} />
          </View>
          {card.pace && (
            <View style={{ marginTop: 14 }}>
              <Text style={{ color: t.muted, fontSize: 12, marginBottom: 4 }}>Paid tickets per day · last 14 days · sale date</Text>
              <PaceBars days={card.pace.days} height={72} labels />
            </View>
          )}
        </Card>

        {card.targets.length > 0 && (
          <Card>
            <Text style={{ color: t.text, fontWeight: "700", marginBottom: 8 }}>Targets</Text>
            {card.targets.map((tp) => <View key={tp.measure} style={{ marginBottom: 12 }}><TargetMeter target={tp} /></View>)}
            <Text style={{ color: t.muted, fontSize: 12 }}>Manual plan values. "Behind" compares the last 7 days' average with what's needed per remaining day — not a forecast.</Text>
          </Card>
        )}

        <Card>
          <Text style={{ color: t.text, fontWeight: "700", marginBottom: 8 }}>Revenue {cur ? `(${cur})` : ""}</Text>
          {[
            ["Gross buyer payments", rev?.measures.grossSales],
            ["Refunds", rev?.measures.refunds],
            ["Gross after refunds", rev?.measures.grossAfterRefunds],
            ["Organizer proceeds", rev?.measures.organizerProceeds],
          ].map(([label, m]) => (
            <View key={label as string} style={[s.rowBetween, { paddingVertical: 6 }]}>
              <Text style={{ color: t.text }}>{label as string}</Text>
              <Text style={{ color: t.text, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{money(m as never)}</Text>
            </View>
          ))}
          <Text style={{ color: t.muted, fontSize: 12, marginTop: 4 }}>
            Gross includes fees and tax. Proceeds are shown only when fee ownership is verified for the source. Full definitions and reconciliation are on desktop.
          </Text>
          {card.otherCurrencies.length > 0 && <Text style={{ color: t.muted, fontSize: 12 }}>Also sold in {card.otherCurrencies.join(", ")} (not combined).</Text>}
        </Card>

        <Card>
          <View style={s.rowBetween}>
            <Text style={{ color: t.text, fontWeight: "700" }}>Data</Text>
            {card.freshness.stale ? <Pill tone="warn">Stale</Pill> : card.mode === "fixture" ? <Pill tone="fixture">Fixture</Pill> : <Pill tone={card.freshness.connectionStatus === "verified" ? "ok" : "neutral"}>{card.freshness.connectionStatus}</Pill>}
          </View>
          <Text style={{ color: t.muted, marginTop: 6 }}>Eventbrite · figures from {ago(card.freshness.dataAsOf)}</Text>
          {syncMsg && <Text style={{ color: syncMsg.ok ? t.okFg : t.badFg, marginTop: 8 }} accessibilityRole="alert">{syncMsg.text}</Text>}
          <Pressable onPress={refresh} disabled={syncing} accessibilityRole="button" accessibilityLabel="Refresh from source"
            style={({ pressed }) => ({ marginTop: 12, borderWidth: 1, borderColor: t.accent, borderRadius: 10, padding: 12, alignItems: "center", opacity: syncing ? 0.6 : pressed ? 0.85 : 1 })}>
            {syncing ? <ActivityIndicator /> : <Text style={{ color: t.accent, fontWeight: "700" }}>Refresh from source</Text>}
          </Pressable>
        </Card>
      </ScrollView>
    </View>
  );
}
