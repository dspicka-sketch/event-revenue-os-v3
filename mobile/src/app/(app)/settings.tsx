import { Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { Card, Pill } from "../../components/ui";
import { useSession } from "../../lib/session";
import { useTheme } from "../../lib/theme";

export default function Settings() {
  const t = useTheme();
  const { me, org, serverUrl, selectOrg, signOut } = useSession();
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Card>
        <Text style={{ color: t.muted, fontSize: 12 }}>Signed in as</Text>
        <Text style={{ color: t.text, fontSize: 16, fontWeight: "600" }}>{me?.user.email}</Text>
        <Text style={{ color: t.muted, fontSize: 12, marginTop: 8 }}>Server</Text>
        <Text style={{ color: t.text }}>{serverUrl}</Text>
      </Card>
      <Text style={{ color: t.muted, fontWeight: "600", marginBottom: 8 }}>Organizations</Text>
      {me?.organizations.map((o) => (
        <Pressable key={o.id} onPress={() => { selectOrg(o.id); router.back(); }} accessibilityRole="button" accessibilityState={{ selected: o.id === org?.id }}>
          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <Text style={{ color: t.text, fontWeight: o.id === org?.id ? "700" : "400", flex: 1 }}>{o.name}{o.id === org?.id ? "  ✓" : ""}</Text>
              {o.is_fixture ? <Pill tone="fixture">FIXTURE</Pill> : <Pill tone="ok">LIVE</Pill>}
              <Pill tone="neutral">{o.role}</Pill>
            </View>
          </Card>
        </Pressable>
      ))}
      <Pressable onPress={async () => { await signOut(); router.replace("/sign-in"); }} accessibilityRole="button"
        style={{ marginTop: 12, borderWidth: 1, borderColor: t.badFg, borderRadius: 10, padding: 12, alignItems: "center" }}>
        <Text style={{ color: t.badFg, fontWeight: "700" }}>Sign out</Text>
      </Pressable>
      <Text style={{ color: t.muted, fontSize: 12, marginTop: 16 }}>Targets and integrations are managed in the RevOS desktop app.</Text>
    </ScrollView>
  );
}
