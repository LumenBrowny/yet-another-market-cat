import { parseAppConfiguration } from "../packages/shared/src/app-config";
parseAppConfiguration({
  profile: process.env.EXPO_PUBLIC_BUILD_PROFILE,
  cluster: process.env.EXPO_PUBLIC_CLUSTER,
  rpcUrl: process.env.EXPO_PUBLIC_RPC_URL,
  apiUrl: process.env.EXPO_PUBLIC_API_URL,
  demoControls: process.env.EXPO_PUBLIC_DEMO_CONTROLS,
  standalone: true,
});
console.log(
  "Release configuration validated; no embedded credentials or emulator addresses",
);
