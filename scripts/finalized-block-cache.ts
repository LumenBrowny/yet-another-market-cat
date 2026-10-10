import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  stat,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";

// Only immutable finalized getBlock responses. No account state, checkpoints,
// signature listings or RPC failures are cached. Namespace includes endpoint,
// genesis and the exact response format; nothing is read from the accounting DB.
export class FinalizedBlockCache {
  private directory: string;
  constructor(root: string, endpoint: string, genesis: string) {
    this.directory = join(
      root,
      createHash("sha256")
        .update(
          JSON.stringify([endpoint, genesis, "full-v1-maxTransactionVersion1"]),
        )
        .digest("hex"),
    );
  }
  async get<T>(slot: number): Promise<T | undefined> {
    try {
      const bytes = await readFile(join(this.directory, `${slot}.gz`));
      const envelope = JSON.parse(
        gunzipSync(bytes, { maxOutputLength: 32 * 1024 * 1024 }).toString(),
      );
      if (
        envelope.slot !== slot ||
        typeof envelope.json !== "string" ||
        envelope.hash !==
          createHash("sha256").update(envelope.json).digest("hex")
      )
        return;
      return JSON.parse(envelope.json) as T;
    } catch {
      return;
    }
  }
  async put(slot: number, block: unknown) {
    const json = JSON.stringify(block);
    if (Buffer.byteLength(json) > 24 * 1024 * 1024) return;
    const bytes = gzipSync(
      JSON.stringify({
        slot,
        json,
        hash: createHash("sha256").update(json).digest("hex"),
      }),
    );
    await mkdir(this.directory, { recursive: true });
    const target = join(this.directory, `${slot}.gz`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, target);
    // Bound each provider/network namespace to 256 MiB. A cache miss always
    // returns to RPC; eviction cannot advance the accounting watermark.
    const files = await Promise.all(
      (await readdir(this.directory))
        .filter((n) => n.endsWith(".gz"))
        .map(async (name) => {
          try {
            const s = await stat(join(this.directory, name));
            return { name, size: s.size, time: s.mtimeMs };
          } catch {
            return { name, size: 0, time: 0 };
          }
        }),
    );
    let size = files.reduce((sum, f) => sum + f.size, 0);
    for (const file of files.sort((a, b) => a.time - b.time)) {
      if (size <= 256 * 1024 * 1024) break;
      await unlink(join(this.directory, file.name)).catch(() => {});
      size -= file.size;
    }
  }
}
