import { Text, View } from "react-native";
import type { ShowCard } from "@revos/domain/pulse";
import { ago, measureCompact, showDate, whenLabel } from "../lib/format";
import { useTheme } from "../lib/theme";
import { PaceBars } from "./PaceBars";
import { DriverRowView } from "./Drivers";
import { AttentionRow, Card, Pill, Stat, TargetMeter, s } from "./ui";

const PROVIDER: Record<string, string> = { eventbrite: "Eventbrite" };

export function ShowCardView({ card, onPress }: { card: ShowCard; onPress: () => void }) {
  const t = useTheme();
  const top = card.attention.find((a) => a.severity !== "info") ?? card.attention[0];
  const pace = card.pace;
  const trend = pace ? pace.last7DaysPaidTickets - pace.previous7DaysPaidTickets : 0;
  return (
    <Card onPress={onPress} label={`${card.name}, ${showDate(card.performanceStartUtc, card.venueTimezone)}. Open details.`}>
      <View style={s.rowBetween}>
        <Text style={{ color: t.muted, fontSize: 13, fontWeight: "600" }}>{whenLabel(card)}</Text>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {card.mode === "fixture" && <Pill tone="fixture">FIXTURE</Pill>}
          {card.freshness.stale && <Pill tone="warn">Stale</Pill>}
        </View>
      </View>
      <Text style={{ color: t.text, fontSize: 18, fontWeight: "700", marginTop: 2 }} numberOfLines={2}>{card.name}</Text>
      <Text style={{ color: t.muted, fontSize: 13 }}>{showDate(card.performanceStartUtc, card.venueTimezone)}</Text>

      {card.marketing && (
        <View style={{ marginTop: 12 }}>
          <View style={s.rowBetween}>
            <Text style={{ color: t.text, fontWeight: "700", fontSize: 12, letterSpacing: 0.6 }}>DRIVING SALES</Text>
            <Text style={{ color: t.muted, fontSize: 12 }}>{card.marketing.trackedShare}% of tickets tracked</Text>
          </View>
          {card.marketing.topDrivers.length === 0 ? (
            <Text style={{ color: t.muted, marginTop: 6 }}>No sales linked to marketing yet.</Text>
          ) : (
            card.marketing.topDrivers.map((d) => (
              <DriverRowView key={`${d.kind}:${d.campaign?.id ?? d.code}`} d={d} max={card.marketing!.topDrivers[0]!.paidTickets} />
            ))
          )}
        </View>
      )}

      {card.tickets ? (
        <View style={{ flexDirection: "row", gap: 12, marginTop: 12 }}>
          <Stat label="Paid tickets" value={`${card.tickets.paid.toLocaleString("en-US")}${card.tickets.partial ? "+" : ""}`} sub={card.tickets.comp ? `+${card.tickets.comp} comp` : undefined} />
          <Stat label="Gross sales" value={measureCompact(card.revenue?.grossAfterRefunds, card.currency)} sub="after refunds, pre-fees" />
          <Stat label="Last 7 days" value={pace ? `+${pace.last7DaysPaidTickets}` : "—"} sub={pace ? `${trend >= 0 ? "▲" : "▼"} ${Math.abs(trend)} vs prior 7` : undefined} />
        </View>
      ) : (
        <Text style={{ color: t.muted, marginTop: 12 }}>No sales data yet.</Text>
      )}

      {card.targets[0] && <View style={{ marginTop: 12 }}><TargetMeter target={card.targets[0]} /></View>}
      {pace && <View style={{ marginTop: 12 }}><PaceBars days={pace.days} /></View>}
      {top && <AttentionRow item={top} compact />}
      {card.attention.length > 1 && <Text style={{ color: t.muted, fontSize: 12, marginTop: 4 }}>+{card.attention.length - 1} more</Text>}
      <Text style={{ color: t.muted, fontSize: 12, marginTop: 10 }}>
        {PROVIDER[card.provider] ?? card.provider} · updated {ago(card.freshness.dataAsOf)}
      </Text>
    </Card>
  );
}
