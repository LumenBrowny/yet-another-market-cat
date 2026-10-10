// All placements use the engine's 340 x 290 scene space, not device pixels.
// Painted room is an interchangeable plate; these registered props stay separate.
export const CHAMBER_LAYOUT = {
  room: { x: 0, y: 0, width: 340, height: 290 },
  rearWall: { x: 65, y: 55, width: 210, height: 180 },
  monitor: { x: 52, y: 155, width: 32, height: 27 },
  indicator: { x: 294, y: 127, width: 17, height: 53 },
  bowl: { x: 254, y: 246 },
  // Opaque bottom edge of the existing 1024px loaf PNGs (alpha > 32).
  // Asset bounds, not replacements for the user's anatomical anchors.
  loafBottom: { left: 864 / 1024, right: 876 / 1024 },
  character: {
    normal: { x: 75, y: 158, width: 57, height: 94 },
    notice: { x: 77, y: 158, width: 62, height: 94 },
    panic: { x: 79, y: 151, width: 63, height: 101 },
    disaster: { x: 57, y: 223, width: 116, height: 44 },
  },
} as const;
