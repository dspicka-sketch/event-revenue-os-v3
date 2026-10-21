import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Redirect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../lib/session";
import { useTheme } from "../lib/theme";

export default function SignIn() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { me, ready, serverUrl, signIn } = useSession();
  const [server, setServer] = useState(serverUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (ready && me) return <Redirect href="/" />;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(server, email, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const input = { borderWidth: 1, borderColor: t.border, borderRadius: 10, padding: 12, fontSize: 16, color: t.text, backgroundColor: t.surface, marginTop: 6, marginBottom: 14 } as const;
  const label = { color: t.text, fontWeight: "600" as const };
  const insecure = server.startsWith("http://") && !/^http:\/\/(127\.0\.0\.1|localhost|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(server);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: insets.top + 48 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: t.text, fontSize: 32, fontWeight: "800" }}>RevOS</Text>
        <Text style={{ color: t.muted, marginBottom: 28 }}>Show performance across your ticketing and marketing tools.</Text>

        <Text style={label}>Email</Text>
        <TextInput style={input} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" accessibilityLabel="Email" />
        <Text style={label}>Password</Text>
        <TextInput style={input} value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" accessibilityLabel="Password" onSubmitEditing={submit} />
        <Text style={label}>RevOS server</Text>
        <TextInput style={input} value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel="RevOS server address" />
        {insecure && <Text style={{ color: t.warnFg, marginTop: -8, marginBottom: 12 }}>This address is not encrypted. Use https:// outside your local network.</Text>}
        {error && <Text style={{ color: t.badFg, marginBottom: 12 }} accessibilityRole="alert">{error}</Text>}

        <Pressable onPress={submit} disabled={busy || !email || !password} accessibilityRole="button"
          style={({ pressed }) => ({ backgroundColor: t.accent, borderRadius: 10, padding: 14, alignItems: "center", opacity: busy || !email || !password ? 0.6 : pressed ? 0.85 : 1 })}>
          {busy ? <ActivityIndicator color={t.accentText} /> : <Text style={{ color: t.accentText, fontWeight: "700", fontSize: 16 }}>Sign in</Text>}
        </Pressable>
        <View style={{ height: 16 }} />
        <Text style={{ color: t.muted, fontSize: 13 }}>Use the same account as the RevOS desktop app.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
