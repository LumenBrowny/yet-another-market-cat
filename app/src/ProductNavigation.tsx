import React from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { appConfig } from "./config";
export function ProductNavigation({
  wallet,
  onCycles,
}: {
  wallet?: string;
  onCycles: () => void;
}) {
  const [error, setError] = React.useState("");
  async function open(path: string) {
    try {
      if (!appConfig.apiUrl) throw new Error("Public explorer unavailable");
      await Linking.openURL(appConfig.apiUrl + path);
    } catch {
      setError("Explorer unavailable. Check your network.");
    }
  }
  return (
    <View>
      <View style={styles.nav}>
        <Text style={styles.active}>MINE</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show completed cycles and claims"
          onPress={onCycles}
          style={styles.link}
        >
          <Text style={styles.text}>CYCLES</Text>
        </Pressable>
        {[
          ["VERIFY THE SHIT", "/verify"],
          ["ABOUT", "/about"],
        ].map(([label, path]) => (
          <Pressable
            key={label}
            accessibilityRole="link"
            accessibilityLabel={`Open ${label.toLowerCase()}`}
            onPress={() => void open(path)}
            style={styles.link}
          >
            <Text style={styles.text}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {wallet && (
        <Pressable
          accessibilityRole="link"
          onPress={() => void open(`/shitter/${wallet}`)}
          style={styles.link}
        >
          <Text style={styles.text}>YOUR PUBLIC CYCLE HISTORY ↗</Text>
        </Pressable>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}
const styles = StyleSheet.create({
  nav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginVertical: 8,
  },
  active: { color: "#d2ee9b", fontSize: 11, fontWeight: "900", padding: 8 },
  link: { padding: 8, minHeight: 44, justifyContent: "center" },
  text: { color: "#afc394", fontSize: 10, fontWeight: "700" },
  error: { color: "#edb18c", fontSize: 12 },
});
