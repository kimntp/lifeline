import * as THREE from "three";

// A small static walk grid keeps miners circulating around scattered ice.
export function createIceNavigator(obstacles, center) {
  const radius = 35, size = radius * 2 + 1;
  const originX = center.x - radius, originZ = center.z - radius;
  const blocked = Array.from({ length: size * size }, (_, index) => {
    const x = originX + index % size, z = originZ + Math.floor(index / size);
    return obstacles.some(box => x > box.min.x - 0.35 && x < box.max.x + 0.35 && z > box.min.z - 0.35 && z < box.max.z + 0.35);
  });
  function nearest(position) {
    const x = THREE.MathUtils.clamp(Math.round(position.x - originX), 0, size - 1);
    const z = THREE.MathUtils.clamp(Math.round(position.z - originZ), 0, size - 1);
    let best = -1, distance = Infinity;
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const px = x + dx, pz = z + dz;
      if (px < 0 || px >= size || pz < 0 || pz >= size) continue;
      const id = pz * size + px;
      const d = Math.hypot(originX + px - position.x, originZ + pz - position.z);
      if (!blocked[id] && d < distance) { best = id; distance = d; }
    }
    return best;
  }
  return (from, to) => {
    const start = nearest(from), end = nearest(to);
    if (start < 0 || end < 0) return [];
    const queue = [start], parents = new Map([[start, -1]]);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor];
      if (current === end) break;
      const x = current % size, z = Math.floor(current / size);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz, id = nz * size + nx;
        if (nx < 0 || nx >= size || nz < 0 || nz >= size || blocked[id] || parents.has(id)) continue;
        parents.set(id, current); queue.push(id);
      }
    }
    if (!parents.has(end)) return [];
    const points = [];
    for (let id = end; id !== -1; id = parents.get(id)) points.push(new THREE.Vector3(originX + id % size, 0, originZ + Math.floor(id / size)));
    return points.reverse().concat(to.clone());
  };
}
