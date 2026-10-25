// Fixed placements on city.glb. The base sits clear of the sealed garden.
// Heights follow the terrain
// and foundation; X/Z and facing remain the same on every load and respawn.
export const LEVEL_LAYOUT = Object.freeze({
  base: Object.freeze({ x: -72, z: -56, yaw: 0, foundationDrop: 1 }),
  garden: Object.freeze({ x: -80, z: 32 }),
  ice: Object.freeze({ x: 64, z: -52 }),
  spawn: Object.freeze({ x: -72, z: -49.16156257902425, yaw: Math.PI, cameraYaw: 0 }),
});
