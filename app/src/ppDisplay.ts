// Non-authoritative display reconciliation. Never used for rewards or transaction amounts.
export function reconcilePointDisplay(
  previous: number,
  target: number,
  rate: number,
  ready: boolean,
  catchingUp: boolean,
  reset = false,
  elapsedSeconds = 0.1,
) {
  const largeCorrection =
    ready &&
    !reset &&
    !catchingUp &&
    Math.abs(target - previous) > Math.max(100, rate * 120);
  if (!ready || reset || largeCorrection)
    return { value: target, largeCorrection };
  // Keep following the last finalized rate while a new stake is being indexed.
  // A lagging target must not rewind an active counter.
  if (rate > 0 && target < previous)
    return { value: previous, largeCorrection: false };
  const delta = target - previous;
  const dt = Math.max(0, Math.min(0.25, elapsedSeconds));
  // Bound catch-up speed as well as easing: a 26 PP reconciliation must not
  // become a visible jump in a handful of 100 ms frames.
  const step = Math.min(
    Math.abs(delta) * (1 - Math.exp(-2.23 * dt)),
    Math.max(2.5, rate * 2) * dt,
  );
  return {
    value: previous + Math.sign(delta) * step,
    largeCorrection: false,
  };
}
