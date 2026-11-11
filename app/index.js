import "./polyfill";
import { registerRootComponent } from "expo";
const App =
  process.env.EXPO_PUBLIC_ADMISSION_LAB === "true"
    ? require("./src/AdmissionLab").default
    : require("./src/App").default;
registerRootComponent(App);
