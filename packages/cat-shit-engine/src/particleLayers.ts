import type { PoopParticle } from "./types";
/** Higher z is closer to the camera. Does not mutate simulation particles. */
export function particleLayers(
  particles: readonly PoopParticle[],
  catZ: number,
) {
  const behind: PoopParticle[] = [],
    front: PoopParticle[] = [];
  for (const p of particles) {
    const dz = p.position.z - catZ;
    // The painted body has thickness: don't flip layers on tiny z drift.
    // Keep the short plume and first 350ms of ejection on their birth side.
    const near =
      p.age < 0.35 || Math.abs(dz) <= 0.1 ? p.emittedInFront : dz > 0;
    (near ? front : behind).push(p);
  }
  const order = (a: PoopParticle, b: PoopParticle) =>
    a.position.z - b.position.z || a.id - b.id;
  behind.sort(order);
  front.sort(order);
  return { behind, front };
}
