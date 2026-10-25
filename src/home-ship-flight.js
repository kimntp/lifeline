import * as THREE from "three";

export function createHomeShipFlight({ width, height, menuBounds, radiusRatio, initial = true, random = Math.random }) {
  const padding = width < 768 ? 18 : 32;
  let shipWidth = Math.min(width * (width < 768 ? 0.12 : 0.15), height * 0.32);
  let radius, top, bottom, left, right, below;
  for (let attempt = 0; attempt < 20; attempt++) {
    radius = shipWidth * radiusRatio * 1.25;
    top = Math.max(height * 0.3, menuBounds.bottom + padding + radius);
    bottom = height - padding - radius;
    left = padding + radius;
    right = Math.min(width * 0.64, menuBounds.left - padding - radius);
    below = bottom - top > Math.max(32, radius * 0.6);
    if (below || right - left > Math.max(32, radius * 0.8)) break;
    shipWidth *= 0.85;
  }
  const variation = random() * 0.12 - 0.06;
  const depth = random() * 0.02 + 0.025;
  const outside = radius * 2.5;
  let points;
  if (below) {
    const altitude = fraction => top + (bottom - top) * fraction;
    points = [
      [initial ? width * 0.23 : -outside, altitude(0.5 + variation), 0],
      [width * 0.36, altitude(0.32 + variation), depth],
      [width * 0.61, altitude(0.66 - variation), -depth],
      [width * 0.84, altitude(0.48 + variation), depth * 0.4],
      [width + outside, altitude(0.55 - variation), 0],
    ];
  } else {
    const altitude = fraction => padding + radius + (height - 2 * (padding + radius)) * fraction;
    const span = right - left;
    points = [
      [initial ? left + span * 0.25 : -outside, altitude(0.25 + variation), 0],
      [left + span * 0.6, altitude(0.22), depth],
      [right - span * 0.08, altitude(0.48), -depth],
      [left + span * 0.55, altitude(0.76), depth * 0.4],
      [-outside, altitude(0.7 - variation), 0],
    ];
  }
  const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)), false, "centripetal");
  curve.arcLengthDivisions = 600;
  return { curve, duration: 35 + random() * 15, shipWidth, radius, width, height, padding };
}

export function homeShipWorldPoint(route, progress, cameraDistance, target = new THREE.Vector3()) {
  route.curve.getPointAt(THREE.MathUtils.clamp(progress, 0, 1), target);
  const depth = target.z;
  return target.set((target.x - route.width / 2) * (1 - depth),
    (route.height / 2 - target.y) * (1 - depth), depth * cameraDistance);
}

export function homeShipRouteClearsMenu(route, menuBounds) {
  const point = new THREE.Vector3();
  for (let step = 0; step <= 160; step++) {
    route.curve.getPointAt(step / 160, point);
    if (point.x + route.radius > menuBounds.left - route.padding
      && point.x - route.radius < menuBounds.right + route.padding
      && point.y + route.radius > menuBounds.top - route.padding
      && point.y - route.radius < menuBounds.bottom + route.padding) return false;
  }
  return true;
}
