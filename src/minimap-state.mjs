const valid = point => Number.isFinite(point?.x) && Number.isFinite(point?.z);

export function getMinimapState({ player, yaw = 0, base, colony1, colony2, phase2 = false, returning = false }) {
  if (!valid(player) || !valid(base) || !valid(colony1)) return null;
  const markers = [
    { id: "base", label: "B", name: "Base", x: base.x, z: base.z },
    { id: "colony1", label: "1", name: "Colony 1", x: colony1.x, z: colony1.z },
  ];
  // Locked destinations never influence markers, map bounds, zoom, or route hints.
  if (phase2 && valid(colony2)) markers.push({ id: "colony2", label: "2", name: "Colony 2", x: colony2.x, z: colony2.z });
  const target = markers.find(marker => marker.id === (returning ? "base" : phase2 && valid(colony2) ? "colony2" : "colony1"));
  const points = [...markers, player];
  const center = {
    x: (Math.min(...points.map(point => point.x)) + Math.max(...points.map(point => point.x))) / 2,
    z: (Math.min(...points.map(point => point.z)) + Math.max(...points.map(point => point.z))) / 2,
  };
  const radius = Math.max(22, ...points.map(point => Math.hypot(point.x - center.x, point.z - center.z))) + 8;
  return { markers, player: { x: player.x, z: player.z, yaw: Number.isFinite(yaw) ? yaw : 0 }, center, radius,
    target, distance: Math.hypot(target.x - player.x, target.z - player.z), phase2: Boolean(phase2) };
}

export function projectMinimapPoint(point, state, size) {
  const scale = (size / 2 - 24) / state.radius;
  return { x: size / 2 + (point.x - state.center.x) * scale,
    y: size / 2 + (point.z - state.center.z) * scale };
}
