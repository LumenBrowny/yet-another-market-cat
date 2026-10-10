import { parseAppConfiguration } from "@yac/shared/src/app-config";
export const appConfig = parseAppConfiguration({
  profile: process.env.EXPO_PUBLIC_BUILD_PROFILE,
  cluster: process.env.EXPO_PUBLIC_CLUSTER,
  rpcUrl: process.env.EXPO_PUBLIC_RPC_URL,
  apiUrl: process.env.EXPO_PUBLIC_API_URL,
  identity: process.env.EXPO_PUBLIC_APP_IDENTITY,
  demoControls: process.env.EXPO_PUBLIC_DEMO_CONTROLS,
  standalone: !__DEV__,
});
