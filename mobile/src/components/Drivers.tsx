// "What's driving sales" (D13): paid tickets by the tracking link each order
// came through. Values come from the shared domain engine via the API.
import { Text, View } from "react-native";
import type { DriverRow } from "@revos/domain/marketing";
import type { OrgMarketing } from "@revos/domain/pulse";
import { Card } from "./ui";
import { formatMoneyCompact } from "@revos/domain/money";
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
        {d.kind === "campaign" ? "Email" : "Tracking link"} · {d.ticketShare}% of tickets
        {detailed ? ` · ${d.orders} orders · ${gross || "—"}${d.ordersPer100Clicks !== null ? ` · ${d.ordersPer100Clicks} per 100 clicks` : ""}` : ""}
      </Text>
    </View>
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
export function WhatsWorkingCard({ m }: { m: OrgMarketing }) {
  const t = useTheme();
  const top = m.drivers.slice(0, 4);
  const max = Math.max(1, ...top.map((d) => d.paidTickets), m.unattributedTickets);
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontSize: 20, fontWeight: "800" }}>What's working</Text>
          <Text style={{ color: t.muted, fontSize: 12 }}>{m.scope}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: t.text, fontSize: 24, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{m.trackedShare}%</Text>
          <Text style={{ color: t.muted, fontSize: 11 }}>of tickets tracked</Text>
        </View>
      </View>
      {top.length === 0 ? (
        <Text style={{ color: t.muted, marginTop: 10 }}>No sales linked to marketing yet. Use Eventbrite tracking links in emails, posts and ads.</Text>
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
              {d.kind === "campaign" ? "Email" : "Tracking link"} · {d.ticketShare}% of tickets · {d.shows} show{d.shows === 1 ? "" : "s"}
            </Text>
          </View>
        ))
      )}
      <UnattributedRow tickets={m.unattributedTickets} total={m.paidTickets} max={max} />
    </Card>
  );
}
