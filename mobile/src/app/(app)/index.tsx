import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import type { PulseResponse } from "@revos/shared/apiTypes";
import { ShowCardView } from "../../components/ShowCardView";
import { Card, FixtureBanner, Stat } from "../../components/ui";
import { formatMoneyCompact } from "../../lib/format";
import { useSession } from "../../lib/session";
import { useTheme } from "../../lib/theme";

export default function Shows() {
  const t = useTheme();
  const { org, me, client, handleAuthError, selectOrg } = useSession();
  const [data, setData] = useState<PulseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!org) return;
    setLoading(true);
    try {
      setData(await client.pulse(org.id));
      setError(null);
    } catch (e) {
      if (!handleAuthError(e)) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [org, client, handleAuthError]);
  useEffect(() => { void load(); }, [load]);

  const orgs = me?.organizations ?? [];
  const nextOrg = () => {
    const i = orgs.findIndex((o) => o.id === org?.id);
    const next = orgs[(i + 1) % orgs.length];
    if (next) { setData(null); selectOrg(next.id); }
  };

  const header = (
    <View>
      {orgs.length > 1 && (
        <Pressable onPress={nextOrg} accessibilityRole="button" accessibilityLabel={`Organization ${org?.name}. Tap to switch.`} style={{ paddingBottom: 8 }}>
          <Text style={{ color: t.accent, fontWeight: "600" }}>{org?.is_fixture ? "FIXTURE — " : ""}{org?.name} ⇄</Text>
        </Pressable>
      )}
      {data && (
        <Card>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Stat label="Upcoming shows" value={String(data.summary.upcomingShows)} />
            <Stat label="Sold, last 7 days" value={data.summary.paidTicketsLast7Days.toLocaleString("en-US")} sub="paid tickets" />
          </View>
          <View style={{ flexDirection: "row", gap: 12, marginTop: 12 }}>
            <Stat label="Upcoming gross" value={data.summary.upcomingGrossByCurrency.map((g) => (g.minor === null ? "—" : formatMoneyCompact(g.minor, g.currency) + (g.status === "partial" ? "*" : ""))).join(" · ") || "—"} sub="after refunds, before fees" />
            <Stat label="Need attention" value={String(data.summary.showsNeedingAttention)} sub={data.summary.showsNeedingAttention ? "shows" : "all clear"} />
          </View>
        </Card>
      )}
      {error && <Text style={{ color: t.badFg, marginBottom: 12 }} accessibilityRole="alert">{error}</Text>}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{
        title: org?.name ?? "Shows",
        headerRight: () => (
          <Pressable onPress={() => router.push("/settings")} accessibilityRole="button" accessibilityLabel="Account" hitSlop={12}>
            <Text style={{ color: t.accent, fontWeight: "600" }}>Account</Text>
          </Pressable>
        ),
      }} />
      {org?.is_fixture && <FixtureBanner />}
      <FlatList
        data={data?.shows ?? []}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: 16 }}
        ListHeaderComponent={header}
        ListEmptyComponent={data ? <Text style={{ color: t.muted, textAlign: "center", marginTop: 24 }}>No shows yet. Shows appear once an integration is connected on desktop.</Text> : undefined}
        renderItem={({ item }) => <ShowCardView card={item} onPress={() => router.push({ pathname: "/show/[id]", params: { id: item.id } })} />}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListFooterComponent={data ? <Text style={{ color: t.muted, fontSize: 12, textAlign: "center" }}>* partial: some amounts unknown. Pull to reload.</Text> : undefined}
      />
    </View>
  );
}
