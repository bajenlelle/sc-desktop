import { Tabs } from "expo-router";
import { View, Text } from "react-native";

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <View className="items-center">
      <Text className={focused ? "text-primary text-xs font-semibold" : "text-gray-400 text-xs"}>
        {label}
      </Text>
    </View>
  );
}

export default function AppLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#2563eb",
        tabBarInactiveTintColor: "#9ca3af",
        tabBarStyle: { borderTopWidth: 1, borderTopColor: "#e5e7eb" },
      }}
    >
      <Tabs.Screen
        name="playlists"
        options={{
          title: "Playlists",
          tabBarIcon: ({ focused }) => <TabIcon label="Playlists" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ focused }) => <TabIcon label="Profile" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="onboarding"
        options={{ href: null }}
      />
    </Tabs>
  );
}
