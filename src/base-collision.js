// Sweep a character's radius against the solid base footprint. This also
// blocks open door geometry and movement large enough to cross the whole base.
export function resolveBaseCollision(position, previous, bounds, radius = 0.35) {
  const min = [bounds.min.x - radius, bounds.min.z - radius];
  const max = [bounds.max.x + radius, bounds.max.z + radius];
  const start = [previous.x, previous.z];
  const delta = [position.x - start[0], position.z - start[1]];
  const epsilon = 1e-4;
  if (start[0] > min[0] && start[0] < max[0] && start[1] > min[1] && start[1] < max[1]) {
    const distances = [start[0] - min[0], max[0] - start[0], start[1] - min[1], max[1] - start[1]];
    const face = distances.indexOf(Math.min(...distances));
    const axis = Math.floor(face / 2);
    start[axis] = face % 2 ? max[axis] + epsilon : min[axis] - epsilon;
  }
  for (let iteration = 0; iteration < 2; iteration++) {
    let enter = -Infinity, exit = Infinity, hitAxis = -1;
    for (let axis = 0; axis < 2; axis++) {
      if (Math.abs(delta[axis]) < 1e-12) {
        if (start[axis] < min[axis] || start[axis] > max[axis]) exit = -Infinity;
        continue;
      }
      const a = (min[axis] - start[axis]) / delta[axis];
      const b = (max[axis] - start[axis]) / delta[axis];
      const near = Math.min(a, b);
      if (near > enter) { enter = near; hitAxis = axis; }
      exit = Math.min(exit, Math.max(a, b));
    }
    if (hitAxis < 0 || enter < 0 || enter > 1 || exit < enter) {
      start[0] += delta[0];
      start[1] += delta[1];
      break;
    }
    start[0] += delta[0] * enter;
    start[1] += delta[1] * enter;
    start[hitAxis] -= Math.sign(delta[hitAxis]) * epsilon;
    delta[0] *= 1 - enter;
    delta[1] *= 1 - enter;
    delta[hitAxis] = 0;
  }
  position.x = start[0];
  position.z = start[1];
}

export function resolvePlatformCollision(position, previous, bounds, footOffset, radius = 0.35) {
  // A platform supports feet from above, but its sides are solid. Walking
  // into its footprint must not let the ground solver lift the character.
  if (position.y - footOffset >= bounds.max.y - 1e-4) return;
  resolveBaseCollision(position, previous, bounds, radius);
}
