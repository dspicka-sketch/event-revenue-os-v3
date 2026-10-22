// Daily paid tickets, one series, one hue. Compact on cards; with day labels
// on the show screen. Values are also given as an accessibility summary.
import { Text, View } from "react-native";
import Svg, { Line, Path } from "react-native-svg";
import type { DailySales } from "@revos/domain/revenue";
import { useTheme } from "../lib/theme";

function column(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return "";
  const r = Math.min(3, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function PaceBars({ days, height = 44, labels = false, width = 300 }: { days: DailySales[]; height?: number; labels?: boolean; width?: number }) {
  const t = useTheme();
  const max = Math.max(1, ...days.map((d) => d.paidTickets));
  const slot = width / days.length;
  const barW = Math.min(16, slot - 2);
  const total = days.reduce((a, d) => a + d.paidTickets, 0);
  const peak = days.reduce((a, d) => (d.paidTickets > a.paidTickets ? d : a), days[0] ?? { date: "", paidTickets: 0, grossAfterRefundsMinor: 0 });
  return (
    <View accessible accessibilityRole="image"
      accessibilityLabel={`Paid tickets per day, last ${days.length} days: ${total} total, peak ${peak.paidTickets} on ${peak.date}.`}>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <Line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} stroke={t.border} strokeWidth={1} />
        {days.map((d, i) => {
          const h = (d.paidTickets / max) * (height - 4);
          return <Path key={d.date} d={column(i * slot + (slot - barW) / 2, height - h, barW, h)} fill={t.chart} />;
        })}
      </Svg>
      {labels && (
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
          <Text style={{ color: t.muted, fontSize: 11 }}>{days[0]?.date.slice(5)}</Text>
          <Text style={{ color: t.muted, fontSize: 11 }}>peak {peak.paidTickets} · {peak.date.slice(5)}</Text>
          <Text style={{ color: t.muted, fontSize: 11 }}>today</Text>
        </View>
      )}
    </View>
  );
}
