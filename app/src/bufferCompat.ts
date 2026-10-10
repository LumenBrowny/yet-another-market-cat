import type { Buffer } from "buffer";

/** Anchor uses subarray() during Borsh decoding. The browser Buffer polyfill
 * otherwise returns a plain Uint8Array on Hermes, losing readUIntLE etc.
 * See https://docs.solanamobile.com/react-native/polyfill-guides/anchor
 */
export function installBufferSubarray(BufferType: typeof Buffer) {
  if (BufferType.isBuffer(BufferType.alloc(1).subarray(0))) return;
  BufferType.prototype.subarray = function (
    start?: number,
    end?: number,
  ): Buffer {
    const view = Uint8Array.prototype.subarray.call(this, start, end);
    return Object.setPrototypeOf(view, BufferType.prototype) as Buffer;
  };
}
