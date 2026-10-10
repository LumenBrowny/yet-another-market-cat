import "react-native-get-random-values";
import "react-native-url-polyfill/auto";
import { Buffer } from "buffer";
import { installBufferSubarray } from "./src/bufferCompat";
installBufferSubarray(Buffer);
globalThis.Buffer = Buffer;
