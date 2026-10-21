// "What's driving sales" (D13): paid tickets by the tracking link each order
// came through. Values come from the shared domain engine via the API.
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { CHANNEL_LABELS, type Channel, type DriverRow, type MoneyByCurrency } from "@revos/domain/marketing";
import type { OrgMarketing } from "@revos/domain/pulse";
import { Card } from "./ui";
import { formatMoney, formatMoneyCompact } from "@revos/domain/money";
import { useTheme } from "../lib/theme";

function Bar({ value, max, muted }: { value: number; max: number; muted?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: t.infoBg, overflow: "hidden", marginTop: 4 }}>
      <View style={{ height: "100%", width: `${Math.max(2, (value / Math.max(1, max)) * 100)}%`, backgroundColor: muted ? t.muted : t.chart, opacity: muted ? 0.45 : 1, borderRadius: 3 }} />
    </View>
  );
}

export function DriverRowView({ d, max, detailed }: { d: DriverRow; max: number; detailed?: boolean }) {
  const t = useTheme();
  const gross = d.grossAfterRefunds.map((g) => (g.minor === null ? "?" : formatMoneyCompact(g.minor, g.currency))).join(" · ");
  const spend = d.spend.length ? ` · ${moneyList(d.spend)} spent${d.costPerPaidTicket.some((c) => c.minor !== null) ? `, ${moneyList(d.costPerPaidTicket)}/ticket` : ", no sales"}` : "";
  return (
    <View style={{ marginTop: 10 }} accessible
      accessibilityLabel={`${d.label}: ${d.paidTickets} paid tickets, ${d.ticketShare} percent of tickets${d.kind === "campaign" ? ", email campaign" : ", tracking link"}`}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Text style={{ color: t.text, fontWeight: "600", flex: 1 }} numberOfLines={1}>
          {d.label}
        </Text>
        <Text style={{ color: t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{d.paidTickets}</Text>
      </View>
      <Bar value={d.paidTickets} max={max} />
      <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }} numberOfLines={detailed ? undefined : 1}>
        {d.channel ? CHANNEL_LABELS[d.channel] : "Unassigned"} · {d.ticketShare}% of tickets
        {detailed ? ` · ${d.orders} orders · ${gross || "—"}${d.ordersPer100Clicks !== null ? ` · ${d.ordersPer100Clicks} per 100 clicks` : ""}${spend}` : ""}
      </Text>
    </View>
  );
}

function moneyList(list: MoneyByCurrency[]): string {
  return list.map((m) => (m.minor === null ? `? ${m.currency}` : formatMoney(m.minor, m.currency))).join(" · ");
}

export function PeriodSwitch({ value, onChange, weekAvailable }: { value: "week" | "all"; onChange: (v: "week" | "all") => void; weekAvailable: boolean }) {
  const t = useTheme();
  const opt = (v: "week" | "all", label: string, disabled = false) => (
    <Pressable key={v} onPress={() => !disabled && onChange(v)} accessibilityRole="button" accessibilityState={{ selected: value === v, disabled }}
      style={{ paddingHorizontal: 10, paddingVertical: 5, backgroundColor: value === v ? t.accent : "transparent", opacity: disabled ? 0.5 : 1 }}>
      <Text style={{ color: value === v ? t.accentText : t.muted, fontWeight: "600", fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", borderWidth: 1, borderColor: t.border, borderRadius: 8, overflow: "hidden", alignSelf: "flex-start", marginTop: 8 }}>
      {opt("week", "Last 7 days", !weekAvailable)}
      {opt("all", "To date")}
    </View>
  );
}

export function ChannelLine({ items }: { items: { channel: Channel | "unassigned"; ticketShare: number }[] }) {
  const t = useTheme();
  if (items.length === 0) return null;
  return (
    <Text style={{ color: t.muted, fontSize: 12, marginTop: 8 }}>
      {items.map((c) => `${CHANNEL_LABELS[c.channel]} ${c.ticketShare}%`).join("  ·  ")}
    </Text>
  );
}

export function UnattributedRow({ tickets, total, max }: { tickets: number; total: number; max: number }) {
  const t = useTheme();
  return (
    <View style={{ marginTop: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: t.muted }}>No tracking link</Text>
        <Text style={{ color: t.muted, fontVariant: ["tabular-nums"] }}>{tickets}</Text>
      </View>
      <Bar value={tickets} max={max} muted />
      <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>{total ? Math.floor((tickets * 100) / total) : 0}% of tickets · unattributed</Text>
    </View>
  );
}

/** Home-screen board: top sources across upcoming shows. */
export function WhatsWorkingCard({ all, week }: { all: OrgMarketing; week: OrgMarketing | null }) {
  const t = useTheme();
  const [period, setPeriod] = useState<"week" | "all">(week && week.paidTickets > 0 ? "week" : "all");
  const m = period === "week" && week ? week : all;
  const top = m.drivers.slice(0, 4);
  const max = Math.max(1, ...top.map((d) => d.paidTickets), m.unattributedTickets);
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontSize: 20, fontWeight: "800" }}>What's working</Text>
          <Text style={{ color: t.muted, fontSize: 12 }}>{m.scope}</Text>
          <PeriodSwitch value={period} onChange={setPeriod} weekAvailable={Boolean(week)} />
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: t.text, fontSize: 24, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{m.trackedShare}%</Text>
          <Text style={{ color: t.muted, fontSize: 11 }}>of tickets tracked</Text>
        </View>
      </View>
      <ChannelLine items={m.byChannel} />
      {top.length === 0 ? (
        <Text style={{ color: t.muted, marginTop: 10 }}>No sales linked to marketing{period === "week" ? " in the last 7 days" : " yet"}. Use Eventbrite tracking links in emails, posts and ads.</Text>
      ) : (
        top.map((d, i) => (
          <View key={d.key} style={{ marginTop: 10 }} accessible
            accessibilityLabel={`${i + 1}. ${d.label}: ${d.paidTickets} paid tickets, ${d.ticketShare} percent, across ${d.shows} shows`}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <Text style={{ color: t.text, fontWeight: "600", flex: 1 }} numberOfLines={1}>{i + 1}. {d.label}</Text>
              <Text style={{ color: t.text, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{d.paidTickets}</Text>
            </View>
            <Bar value={d.paidTickets} max={max} />
            <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>
              {d.channel ? CHANNEL_LABELS[d.channel] : "Unassigned"} · {d.ticketShare}% of tickets · {d.shows} show{d.shows === 1 ? "" : "s"}
              {d.spend.length ? ` · ${moneyList(d.spend)} spent` : ""}
            </Text>
          </View>
        ))
      )}
      <UnattributedRow tickets={m.unattributedTickets} total={m.paidTickets} max={max} />
    </Card>
  );
}
