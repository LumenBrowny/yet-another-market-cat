import process from "node:process";
// Loaded before web3.js. Count transport attempts, never endpoint/params/response data.
const upstream = globalThis.fetch;
globalThis.fetch = async function (...args) {
  let method;
  try {
    const body = JSON.parse(args[1]?.body);
    if (body.jsonrpc === "2.0") method = body.method;
  } catch {
    /* Other fetches pass through. */
  }
  try {
    return await upstream.apply(this, args);
  } finally {
    if (method && process.env.YAC_RPC_METRICS === "true")
      process.stderr.write(
        "YAC_RPC_ATTEMPT " +
          JSON.stringify({
            component: process.env.YAC_RPC_COMPONENT || "operator",
            method,
            reason: process.env.YAC_RPC_REASON || "manual",
            cycleId: process.env.YAC_RPC_CYCLE || null,
            cache: "miss",
            count: 1,
          }) +
          "\n",
      );
  }
};
