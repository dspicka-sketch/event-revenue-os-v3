import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import type { AttentionItem, TargetProgress } from "@revos/domain/pulse";
import { formatMoneyCompact } from "@revos/domain/money";
import { useTheme, type Theme } from "../lib/theme";

export function FixtureBanner() {
  const t = useTheme();
  return (
    <View style={[s.banner, { backgroundColor: t.fixtureBg }]} accessibilityRole="alert">
      <Text style={[s.bannerTag, { backgroundColor: t.fixtureFg, color: t.fixtureBg }]}>FIXTURE DATA</Text>
      <Text style={{ color: t.fixtureFg, flex: 1, fontSize: 13 }}>Synthetic records for testing — not live data.</Text>
    </View>
  );
}

type Tone = "ok" | "warn" | "bad" | "info" | "neutral" | "fixture";
function toneColors(t: Theme, tone: Tone): { bg: string; fg: string } {
  switch (tone) {
    case "ok": return { bg: t.okBg, fg: t.okFg };
    case "warn": return { bg: t.warnBg, fg: t.warnFg };
    case "bad": return { bg: t.badBg, fg: t.badFg };
    case "info": return { bg: t.infoBg, fg: t.infoFg };
    case "fixture": return { bg: t.fixtureBg, fg: t.fixtureFg };
    default: return { bg: t.border, fg: t.text };
  }
}

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  const t = useTheme();
  const c = toneColors(t, tone);
  return <Text style={[s.pill, { backgroundColor: c.bg, color: c.fg }]}>{children}</Text>;
}

const SEVERITY: Record<AttentionItem["severity"], { tone: Tone; icon: string; label: string }> = {
  error: { tone: "bad", icon: "⛔", label: "Error" },
  warning: { tone: "warn", icon: "⚠", label: "Warning" },
  info: { tone: "info", icon: "ℹ", label: "Info" },
};

export function AttentionRow({ item, compact }: { item: AttentionItem; compact?: boolean }) {
  const t = useTheme();
  const sev = SEVERITY[item.severity];
  const c = toneColors(t, sev.tone);
  return (
    <View style={[s.attention, { backgroundColor: c.bg }]} accessible accessibilityLabel={`${sev.label}: ${item.title}. ${compact ? "" : item.detail}`}>
      <Text style={{ color: c.fg, fontWeight: "600" }}>{sev.icon} {item.title}</Text>
      {!compact && <Text style={{ color: c.fg, fontSize: 13, marginTop: 2 }}>{item.detail}</Text>}
    </View>
  );
}

const TARGET_TONE: Record<TargetProgress["status"], { tone: Tone; label: string }> = {
  met: { tone: "ok", label: "Met" },
  on_track: { tone: "ok", label: "On track" },
  behind: { tone: "warn", label: "Behind" },
  missed: { tone: "warn", label: "Missed" },
  unknown: { tone: "neutral", label: "Not judged" },
};

export function targetValue(tp: TargetProgress, v: number | null): string {
  if (v === null) return "Unavailable";
  return tp.unit === "count" ? v.toLocaleString("en-US") : formatMoneyCompact(v, tp.currency ?? "USD");
}

export function TargetMeter({ target }: { target: TargetProgress }) {
  const t = useTheme();
  const st = TARGET_TONE[target.status];
  const fill = target.status === "met" || target.status === "on_track" ? t.okFg : target.status === "unknown" ? t.muted : t.warnFg;
  const pct = Math.max(0, Math.min(100, target.percent ?? 0));
  return (
    <View accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: target.percent ?? undefined }}
      accessibilityLabel={`${target.label} target: ${targetValue(target, target.actual)} of ${targetValue(target, target.target)}, ${st.label}`}>
      <View style={s.rowBetween}>
        <Text style={{ color: t.text, fontWeight: "600" }}>{target.label}</Text>
        <Pill tone={st.tone}>{st.label}</Pill>
      </View>
      <View style={[s.track, { backgroundColor: t.infoBg }]}>
        <View style={[s.fill, { width: `${pct}%`, backgroundColor: fill }]} />
      </View>
      <Text style={{ color: t.muted, fontSize: 12 }}>
        {targetValue(target, target.actual)} of {targetValue(target, target.target)}{target.percent !== null ? ` · ${target.percent}%` : ""}
      </Text>
    </View>
  );
}

export function Card({ children, style, onPress, label }: { children: ReactNode; style?: ViewStyle; onPress?: () => void; label?: string }) {
  const t = useTheme();
  const base = [s.card, { backgroundColor: t.surface, borderColor: t.border }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [...base, pressed && { opacity: 0.85 }]}>
      {children}
    </Pressable>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={{ color: t.muted, fontSize: 12 }} numberOfLines={1}>{label}</Text>
      <Text style={{ color: t.text, fontSize: 22, fontWeight: "700" }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {sub ? <Text style={{ color: t.muted, fontSize: 12 }} numberOfLines={1}>{sub}</Text> : null}
    </View>
  );
}

export const s = StyleSheet.create({
  banner: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  bannerTag: { fontWeight: "800", fontSize: 12, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3, overflow: "hidden" },
  pill: { fontSize: 12, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: "hidden" },
  attention: { borderRadius: 8, padding: 10, marginTop: 8 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  track: { height: 8, borderRadius: 4, overflow: "hidden", marginVertical: 6 },
  fill: { height: "100%", borderRadius: 4 },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 16, marginBottom: 12 },
});
