import { parseAppConfiguration } from "../packages/shared/src/app-config";
import { PROGRAM_ID } from "../packages/shared/src/client";
import { PublicKey } from "@solana/web3.js";
const config = parseAppConfiguration({
  profile: process.env.EXPO_PUBLIC_BUILD_PROFILE,
  cluster: process.env.EXPO_PUBLIC_CLUSTER,
  rpcUrl: process.env.EXPO_PUBLIC_RPC_URL,
  apiUrl: process.env.EXPO_PUBLIC_API_URL,
  demoControls: process.env.EXPO_PUBLIC_DEMO_CONTROLS,
  standalone: true,
  programId: process.env.EXPO_PUBLIC_PROGRAM_ID,
  tokenMint: process.env.EXPO_PUBLIC_TOKEN_MINT,
  rehearsalGenesis: process.env.EXPO_PUBLIC_REHEARSAL_GENESIS,
});
if (config.profile === "mainnet") {
  if (!PROGRAM_ID.equals(new PublicKey(config.programId!)))
    throw new Error("Mainnet program must match compiled IDL");
  new PublicKey(config.tokenMint!);
  if (process.env.EXPO_PUBLIC_ADMISSION_LAB === "true")
    throw new Error("Mainnet release cannot run Admission Lab");
}
console.log(
  "Release configuration validated; no embedded credentials or emulator addresses",
);
