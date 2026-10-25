import * as THREE from "three";

// Index static terrain triangles in X/Z so grounding does not raycast the
// entire high-resolution landscape for every character on every frame.
export class TerrainGround {
  constructor(root, cells = 64) {
    root.updateWorldMatrix(true, true);
    this.bounds = new THREE.Box3().setFromObject(root);
    this.cells = cells;
    this.bins = Array.from({ length: cells * cells }, () => []);
    this.width = Math.max(this.bounds.max.x - this.bounds.min.x, 1e-6);
    this.depth = Math.max(this.bounds.max.z - this.bounds.min.z, 1e-6);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    root.traverse(mesh => {
      if (!mesh.isMesh || mesh.isSkinnedMesh) return;
      mesh.userData.walkableTerrain = true;
      const positions = mesh.geometry.attributes.position;
      if (!positions) return;
      const index = mesh.geometry.index;
      const count = index ? index.count : positions.count;
      for (let i = 0; i < count; i += 3) {
        a.fromBufferAttribute(positions, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(positions, index ? index.getX(i + 1) : i + 1).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(positions, index ? index.getX(i + 2) : i + 2).applyMatrix4(mesh.matrixWorld);
        const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
        if (Math.abs(denominator) < 1e-10) continue;
        const triangle = [a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, denominator,
          mesh, index ? index.getX(i) : i, index ? index.getX(i + 1) : i + 1, index ? index.getX(i + 2) : i + 2];
        const minX = this.cellX(Math.min(a.x, b.x, c.x));
        const maxX = this.cellX(Math.max(a.x, b.x, c.x));
        const minZ = this.cellZ(Math.min(a.z, b.z, c.z));
        const maxZ = this.cellZ(Math.max(a.z, b.z, c.z));
        for (let z = minZ; z <= maxZ; z++) {
          for (let x = minX; x <= maxX; x++) this.bins[z * cells + x].push(triangle);
        }
      }
    });
  }

  cellX(x) {
    return THREE.MathUtils.clamp(Math.floor((x - this.bounds.min.x) / this.width * this.cells), 0, this.cells - 1);
  }

  cellZ(z) {
    return THREE.MathUtils.clamp(Math.floor((z - this.bounds.min.z) / this.depth * this.cells), 0, this.cells - 1);
  }

  heightAt(x, z) {
    return this.surfaceAt(x, z)?.height ?? 0;
  }

  surfaceAt(x, z) {
    if (x < this.bounds.min.x || x > this.bounds.max.x || z < this.bounds.min.z || z > this.bounds.max.z) return null;
    let height = -Infinity;
    let surface = null;
    for (const t of this.bins[this.cellZ(z) * this.cells + this.cellX(x)]) {
      const u = ((t[5] - t[8]) * (x - t[6]) + (t[6] - t[3]) * (z - t[8])) / t[9];
      const v = ((t[8] - t[2]) * (x - t[6]) + (t[0] - t[6]) * (z - t[8])) / t[9];
      const w = 1 - u - v;
      if (u >= -1e-7 && v >= -1e-7 && w >= -1e-7) {
        const y = u * t[1] + v * t[4] + w * t[7];
        if (y > height) {
          height = y;
          surface = { height, triangle: t, weights: [u, v, w] };
        }
      }
    }
    return surface;
  }
}

export function measureFootOffset(actor) {
  // Skinned mesh bounds need the current bone matrices, not the last render's.
  actor.updateWorldMatrix(true, true);
  return actor.position.y - new THREE.Box3().setFromObject(actor, true).min.y;
}

export function advanceGroundedActor(actor, state, footOffset, groundHeight, delta, { snapDown = true } = {}) {
  state.groundY = groundHeight;
  const floorY = groundHeight + footOffset;
  const gap = actor.position.y - floorY;
  // Follow small changes on a continuous slope, but release the character
  // when a platform ends or the ground drops away beneath their feet.
  if (state.grounded && state.velocity.y <= 0 && gap <= (snapDown ? 0.12 : 1e-4)) {
    actor.position.y = floorY;
    state.velocity.y = 0;
    return;
  }
  state.grounded = false;
  const gravity = 28;
  // Integrate displacement before changing velocity for consistent jump and
  // fall arcs across frame rates: y += v*dt + 0.5*a*dt².
  const nextY = actor.position.y + state.velocity.y * delta - 0.5 * gravity * delta * delta;
  state.velocity.y -= gravity * delta;
  if (nextY <= floorY) {
    actor.position.y = floorY;
    state.velocity.y = 0;
    state.grounded = true;
  } else {
    actor.position.y = nextY;
    state.grounded = false;
  }
}
