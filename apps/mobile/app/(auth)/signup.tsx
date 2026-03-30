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
import { supabase } from "../../lib/supabase";

export default function SignupScreen() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSignup() {
    if (!fullName || !email || !password) {
      setError("Please fill in all fields.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    setError(null);
    const { error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    setLoading(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    setSuccess(true);
  }

  if (success) {
    return (
      <View className="flex-1 bg-white items-center justify-center px-6">
        <Text className="text-2xl font-bold text-gray-900 mb-3">Check your email</Text>
        <Text className="text-gray-500 text-center mb-6">
          We sent a confirmation link to {email}. Click it to activate your account, then sign in.
        </Text>
        <TouchableOpacity
          className="bg-primary rounded-lg py-3 px-8 items-center"
          onPress={() => router.replace("/(auth)/login")}
        >
          <Text className="text-white font-semibold">Go to sign in</Text>
        </TouchableOpacity>
      </View>
    );
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
          <Text className="text-3xl font-bold text-gray-900 mb-2">Create account</Text>
          <Text className="text-gray-500 mb-8">Join Scoutable</Text>

          {error && (
            <View className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              <Text className="text-red-700 text-sm">{error}</Text>
            </View>
          )}

          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 mb-1">Full name</Text>
            <TextInput
              className="border border-gray-300 rounded-lg px-4 py-3 text-gray-900 bg-white"
              placeholder="Your name"
              autoCapitalize="words"
              autoComplete="name"
              value={fullName}
              onChangeText={setFullName}
            />
          </View>

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
              placeholder="At least 8 characters"
              secureTextEntry
              autoComplete="new-password"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={handleSignup}
              returnKeyType="done"
            />
          </View>

          <TouchableOpacity
            className="bg-primary rounded-lg py-3 items-center mb-6"
            onPress={handleSignup}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white font-semibold text-base">Create account</Text>
            )}
          </TouchableOpacity>

          <View className="flex-row justify-center">
            <Text className="text-gray-500">Already have an account? </Text>
            <Link href="/(auth)/login">
              <Text className="text-primary font-medium">Sign in</Text>
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
