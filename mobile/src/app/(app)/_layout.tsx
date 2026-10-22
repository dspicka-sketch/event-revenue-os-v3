import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSession } from "../../lib/session";
import { useTheme } from "../../lib/theme";

export default function AppLayout() {
  const { ready, me } = useSession();
  const t = useTheme();
  if (!ready) return <View style={{ flex: 1, justifyContent: "center", backgroundColor: t.bg }}><ActivityIndicator /></View>;
  if (!me) return <Redirect href="/sign-in" />;
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: t.surface }, headerTintColor: t.text, contentStyle: { backgroundColor: t.bg } }}>
      <Stack.Screen name="index" options={{ title: "Shows" }} />
      <Stack.Screen name="show/[id]" options={{ title: "Show" }} />
      <Stack.Screen name="settings" options={{ title: "Account", presentation: "modal" }} />
    </Stack>
  );
}
