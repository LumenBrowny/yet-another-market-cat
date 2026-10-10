import { clamp, project } from "./math";
import { anchorWorld, YAMC_VIEW, type YamcSprite } from "./yamc";
import type { CatBodyState } from "./types";
/** Project the contact onto the drawn floor, not the airborne image plane. */
export function floorShadow(body: CatBodyState, sprite: YamcSprite) {
  const contact = project(anchorWorld(body, sprite, sprite.shadowAnchor));
  const depth = clamp(body.position.z, 0, 1);
  const height = clamp((0.8 - contact.y) / 0.6, 0, 1);
  const rx = (25 + depth * 16) * (1 - 0.3 * height),
    ry = 4 + depth * 4;
  // At the rear wall the oval's far edge touches the floor seam.
  // At the viewer the centre reaches the viewport edge (half the oval clips).
  const rearContactY = 235 + ry;
  const floorY = rearContactY + (YAMC_VIEW.height - rearContactY) * depth;
  const left = 65 * (1 - depth),
    right = YAMC_VIEW.width - left;
  return {
    x: clamp(contact.x * YAMC_VIEW.width, left + rx, right - rx),
    y: floorY,
    rx,
    ry,
    opacity: (0.18 + depth * 0.24) * (1 - 0.45 * height),
  };
}
