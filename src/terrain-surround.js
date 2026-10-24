import * as THREE from "three";

// Low-detail mirrored tiles continue the landscape past the playable area.
// Fine source-border vertices are retained to avoid cracks against the GLB.
export function createTerrainSurround(root, ground, { radius = 3, segments = 48 } = {}) {
  const { min, max } = ground.bounds;
  const width = max.x - min.x, depth = max.z - min.z;
  const centerX = (min.x + max.x) / 2, centerZ = (min.z + max.z) / 2;
  const edgeX = new Set([min.x, max.x]);
  const edgeZ = new Set([min.z, max.z]);
  const point = new THREE.Vector3();
  let material;
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    material ??= Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const positions = mesh.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
      if (Math.abs(point.z - min.z) < 0.001 || Math.abs(point.z - max.z) < 0.001) edgeX.add(point.x);
      if (Math.abs(point.x - min.x) < 0.001 || Math.abs(point.x - max.x) < 0.001) edgeZ.add(point.z);
    }
  });
  const borderX = [...edgeX].sort((a, b) => a - b);
  const borderZ = [...edgeZ].sort((a, b) => a - b);
  const positions = [], uvs = [], indices = [];
  const vertices = new Map();
  function vertex(x, z) {
    const key = `${x.toFixed(7)},${z.toFixed(7)}`;
    if (vertices.has(key)) return vertices.get(key);
    // Imported edge coordinates vary by a few floating-point units. Sample
    // just inside the footprint while retaining the exact border positions.
    const surface = ground.surfaceAt(
      THREE.MathUtils.clamp(x, min.x + width * 1e-6, max.x - width * 1e-6),
      THREE.MathUtils.clamp(z, min.z + depth * 1e-6, max.z - depth * 1e-6),
    );
    if (!surface) throw new Error(`Terrain continuation has no source surface at ${x}, ${z}`);
    const uv = surface.triangle[10].geometry.attributes.uv;
    const t = surface.triangle, weights = surface.weights;
    const id = positions.length / 3;
    positions.push(x, surface.height, z);
    let u = 0, v = 0;
    for (let i = 0; i < 3; i++) {
      u += weights[i] * (uv ? uv.getX(t[11 + i]) : (x - min.x) / width);
      v += weights[i] * (uv ? uv.getY(t[11 + i]) : (z - min.z) / depth);
    }
    uvs.push(u, v);
    vertices.set(key, id);
    return id;
  }
  for (let row = 0; row < segments; row++) {
    for (let col = 0; col < segments; col++) {
      const x0 = min.x + col / segments * width, x1 = min.x + (col + 1) / segments * width;
      const z0 = min.z + row / segments * depth, z1 = min.z + (row + 1) / segments * depth;
      const ring = [[x0, z0]];
      if (row === 0) for (const x of borderX) if (x > x0 + 1e-6 && x < x1 - 1e-6) ring.push([x, z0]);
      ring.push([x1, z0]);
      if (col === segments - 1) for (const z of borderZ) if (z > z0 + 1e-6 && z < z1 - 1e-6) ring.push([x1, z]);
      ring.push([x1, z1]);
      if (row === segments - 1) for (const x of [...borderX].reverse()) if (x > x0 + 1e-6 && x < x1 - 1e-6) ring.push([x, z1]);
      ring.push([x0, z1]);
      if (col === 0) for (const z of [...borderZ].reverse()) if (z > z0 + 1e-6 && z < z1 - 1e-6) ring.push([x0, z]);
      const ids = ring.map(([x, z]) => vertex(x, z));
      if (ids.length === 4) indices.push(ids[0], ids[2], ids[1], ids[0], ids[3], ids[2]);
      else {
        const middle = vertex((x0 + x1) / 2, (z0 + z1) / 2);
        for (let i = 0; i < ids.length; i++) indices.push(middle, ids[(i + 1) % ids.length], ids[i]);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const surround = new THREE.Group();
  surround.name = "TerrainHorizon";
  for (let z = -radius; z <= radius; z++) {
    for (let x = -radius; x <= radius; x++) {
      if (x === 0 && z === 0) continue;
      const tile = new THREE.Mesh(geometry, material);
      tile.scale.set(x % 2 ? -1 : 1, 1, z % 2 ? -1 : 1);
      tile.position.set(centerX + x * width - tile.scale.x * centerX, 0,
        centerZ + z * depth - tile.scale.z * centerZ);
      surround.add(tile);
    }
  }
  return surround;
}
