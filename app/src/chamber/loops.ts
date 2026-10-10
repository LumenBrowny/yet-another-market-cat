// Millisecond timeline shared by the sparse native-image loops and tests.
// One timeout at the next actual frame boundary, never a per-frame ticker.
export function loopFrame(elapsed: number, durations: readonly number[]) {
  if (!durations.length || durations.some((n) => !Number.isFinite(n) || n <= 0))
    throw new Error("Loop durations must be finite positive milliseconds");
  const total = durations.reduce((a, b) => a + b, 0);
  let phase = Math.max(0, elapsed) % total;
  for (let index = 0; index < durations.length; index++) {
    if (phase < durations[index])
      return { index, remaining: durations[index] - phase };
    phase -= durations[index];
  }
  return { index: 0, remaining: durations[0] };
}
