// "What's driving sales" (D13): paid tickets by the tracking link each order
// came through. Values come from the shared domain engine via the API.
import { Text, View } from "react-native";
import type { DriverRow } from "@revos/domain/marketing";
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
