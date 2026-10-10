export type AppConfiguration = {
  profile: "local" | "devnet" | "staging";
  cluster: "localnet" | "devnet";
  rpcUrl: string;
  apiUrl: string;
  identity: string;
  demoControls: boolean;
};
export function parseAppConfiguration(input: {
  profile?: string;
  cluster?: string;
  rpcUrl?: string;
  apiUrl?: string;
  identity?: string;
  demoControls?: string;
  standalone?: boolean;
}): AppConfiguration {
  const profile = input.profile ?? "local",
    cluster = input.cluster ?? "devnet";
  if (
    !["local", "devnet", "staging"].includes(profile) ||
    !["localnet", "devnet"].includes(cluster)
  )
    throw new Error(
      "Unsupported build profile or cluster; mainnet is not enabled",
    );
  const rpcUrl = input.rpcUrl ?? "https://api.devnet.solana.com",
    apiUrl = input.apiUrl ?? "";
  if (input.standalone && !apiUrl)
    throw new Error("Standalone build requires API URL");
  for (const value of [rpcUrl, apiUrl].filter(Boolean)) {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("Public app URLs must be HTTP(S) without credentials");
    if (
      input.standalone &&
      ["10.0.2.2", "localhost", "127.0.0.1", "::1"].includes(url.hostname)
    )
      throw new Error(
        "Standalone builds need device-reachable URLs, not emulator or localhost addresses",
      );
    if (profile !== "local" && url.protocol !== "https:")
      throw new Error("Devnet/staging require HTTPS public endpoints");
  }
  if (profile !== "local" && cluster !== "devnet")
    throw new Error("Devnet/staging must use devnet");
  if (profile === "staging" && input.demoControls === "true")
    throw new Error("Staging excludes demo controls");
  return {
    profile: profile as AppConfiguration["profile"],
    cluster: cluster as AppConfiguration["cluster"],
    rpcUrl,
    apiUrl: apiUrl.replace(/\/$/, ""),
    identity: input.identity ?? "Yet Another Cat 💩",
    demoControls: input.demoControls === "true",
  };
}
