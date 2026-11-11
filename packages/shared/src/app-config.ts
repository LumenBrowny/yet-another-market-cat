export type AppConfiguration = {
  profile: "local" | "devnet" | "staging" | "mainnet";
  cluster: "localnet" | "devnet" | "mainnet-beta";
  rpcUrl: string;
  apiUrl: string;
  identity: string;
  demoControls: boolean;
  rehearsalGenesis?: string;
  programId?: string;
  tokenMint?: string;
};
export function parseAppConfiguration(input: {
  profile?: string;
  cluster?: string;
  rpcUrl?: string;
  apiUrl?: string;
  identity?: string;
  demoControls?: string;
  standalone?: boolean;
  rehearsalGenesis?: string;
  programId?: string;
  tokenMint?: string;
}): AppConfiguration {
  const profile = input.profile ?? "local",
    cluster = input.cluster ?? "devnet";
  if (
    !["local", "devnet", "staging", "mainnet"].includes(profile) ||
    !["localnet", "devnet", "mainnet-beta"].includes(cluster)
  )
    throw new Error("Unsupported build profile or cluster");
  if ((profile === "mainnet") !== (cluster === "mainnet-beta"))
    throw new Error(
      "Mainnet requires an explicit matching profile and cluster",
    );
  if (
    profile === "mainnet" &&
    (!input.rpcUrl ||
      !input.apiUrl ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input.programId ?? "") ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input.tokenMint ?? "") ||
      input.demoControls === "true" ||
      input.rehearsalGenesis)
  )
    throw new Error(
      "Mainnet requires explicit endpoints, program and mint; demo/rehearsal are forbidden",
    );
  const rpcUrl = input.rpcUrl ?? "https://api.devnet.solana.com",
    apiUrl = input.apiUrl ?? "";
  if (
    input.rehearsalGenesis &&
    (profile !== "local" ||
      cluster !== "devnet" ||
      rpcUrl !== "http://127.0.0.1:8929" ||
      apiUrl !== "http://localhost:5088" ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input.rehearsalGenesis))
  )
    throw new Error(
      "Rehearsal requires pinned local USB endpoints and genesis",
    );
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
      (input.standalone || profile === "mainnet") &&
      !input.rehearsalGenesis &&
      ["10.0.2.2", "localhost", "127.0.0.1", "::1", "[::1]"].includes(
        url.hostname,
      )
    )
      throw new Error(
        "Standalone builds need device-reachable URLs, not emulator or localhost addresses",
      );
    if (profile !== "local" && url.protocol !== "https:")
      throw new Error("Devnet/staging require HTTPS public endpoints");
  }
  if (["devnet", "staging"].includes(profile) && cluster !== "devnet")
    throw new Error("Devnet/staging must use devnet");
  if (profile === "staging" && input.demoControls === "true")
    throw new Error("Staging excludes demo controls");
  return {
    profile: profile as AppConfiguration["profile"],
    cluster: cluster as AppConfiguration["cluster"],
    rpcUrl,
    apiUrl: apiUrl.replace(/\/$/, ""),
    identity: input.identity ?? "Yet Another Market Cat 💩",
    demoControls: input.demoControls === "true",
    rehearsalGenesis: input.rehearsalGenesis,
    programId: input.programId,
    tokenMint: input.tokenMint,
  };
}
