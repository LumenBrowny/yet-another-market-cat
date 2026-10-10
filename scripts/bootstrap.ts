import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Keypair } from "@solana/web3.js";

async function main() {
  // Local program deployment key only. Never reuse for a wallet or commit it.
  await mkdir("target/deploy", { recursive: true });
  const path = "target/deploy/cat_shit_mining-keypair.json";
  let key: Keypair;
  try {
    key = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(await readFile(path, "utf8"))),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    key = Keypair.generate();
    await writeFile(path, JSON.stringify([...key.secretKey]), {
      mode: 0o600,
      flag: "wx",
    });
  }
  const id = key.publicKey.toBase58();
  for (const path of ["Anchor.toml", "programs/cat_shit_mining/src/lib.rs"]) {
    const content = await readFile(path, "utf8");
    await writeFile(
      path,
      path.endsWith(".rs")
        ? content.replace(/declare_id!\("[^"]+"\)/, `declare_id!("${id}")`)
        : content.replace(
            /cat_shit_mining = "[^"]+"/g,
            `cat_shit_mining = "${id}"`,
          ),
    );
  }
  console.log(
    `Program ID: ${id}. Build after bootstrap; deploy with the matching keypair.`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
