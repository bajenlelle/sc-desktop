import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Link, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { supabase } from "../../lib/supabase";

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    if (!email || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setLoading(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    router.replace("/");
  }

  async function handleOAuth(provider: "google" | "apple") {
    setLoading(true);
    setError(null);
    const redirectTo = Linking.createURL("/auth/callback");
    const { data, error: authError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (authError || !data.url) {
      setError(authError?.message ?? "OAuth failed.");
      setLoading(false);
      return;
    }
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type === "success") {
      const url = result.url;
      const params = new URLSearchParams(url.split("#")[1] ?? url.split("?")[1] ?? "");
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (accessToken && refreshToken) {
        await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      }
    }
    setLoading(false);
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerClassName="flex-grow items-center justify-center px-6 py-12"
        keyboardShouldPersistTaps="handled"
      >
        <View className="w-full max-w-sm">
          <Text className="text-3xl font-bold text-gray-900 mb-2">Welcome back</Text>
          <Text className="text-gray-500 mb-8">Sign in to your Scoutable account</Text>

          {error && (
            <View className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              <Text className="text-red-700 text-sm">{error}</Text>
            </View>
          )}

          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 mb-1">Email</Text>
            <TextInput
              className="border border-gray-300 rounded-lg px-4 py-3 text-gray-900 bg-white"
              placeholder="you@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              value={email}
              onChangeText={setEmail}
            />
          </View>

          <View className="mb-6">
            <Text className="text-sm font-medium text-gray-700 mb-1">Password</Text>
            <TextInput
              className="border border-gray-300 rounded-lg px-4 py-3 text-gray-900 bg-white"
              placeholder="••••••••"
              secureTextEntry
              autoComplete="password"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={handleLogin}
              returnKeyType="done"
            />
          </View>

          <TouchableOpacity
            className="bg-primary rounded-lg py-3 items-center mb-4"
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white font-semibold text-base">Sign in</Text>
            )}
          </TouchableOpacity>

          <View className="flex-row items-center mb-4">
            <View className="flex-1 h-px bg-gray-200" />
            <Text className="text-gray-400 text-sm mx-3">or continue with</Text>
            <View className="flex-1 h-px bg-gray-200" />
          </View>

          <View className="flex-row gap-3 mb-6">
            <TouchableOpacity
              className="flex-1 border border-gray-300 rounded-lg py-3 items-center"
              onPress={() => handleOAuth("google")}
              disabled={loading}
            >
              <Text className="text-gray-700 font-medium">Google</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="flex-1 border border-gray-300 rounded-lg py-3 items-center"
              onPress={() => handleOAuth("apple")}
              disabled={loading}
            >
              <Text className="text-gray-700 font-medium">Apple</Text>
            </TouchableOpacity>
          </View>

          <View className="flex-row justify-center">
            <Text className="text-gray-500">Don't have an account? </Text>
            <Link href="/(auth)/signup">
              <Text className="text-primary font-medium">Sign up</Text>
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
