function distanceToFootprint(position, bounds) {
  return Math.hypot(Math.max(bounds.min.x - position.x, 0, position.x - bounds.max.x),
    Math.max(bounds.min.z - position.z, 0, position.z - bounds.max.z));
}

const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

export function colonyInterferenceStrength({ completed, active, position, colonyBounds, baseBounds }) {
  if (!completed || !active || !position || !colonyBounds) return 0;
  const proximity = smooth(1 - distanceToFootprint(position, colonyBounds) / 24);
  // The report/reset point remains clear even if the garden is near the base.
  const outsideBase = baseBounds ? smooth(distanceToFootprint(position, baseBounds) / 6) : 1;
  return proximity * outsideBase;
}

export function createColonyInterference(canvas) {
  const grain = document.createElement("div");
  grain.id = "colony-interference";
  grain.setAttribute("aria-hidden", "true");
  grain.hidden = true;
  document.body.appendChild(grain);
  let previous = -1;
  return {
    update(state) {
      const strength = colonyInterferenceStrength(state);
      if (strength === 0 ? previous === 0 : Math.abs(strength - previous) < 0.001) return;
      previous = strength;
      canvas.style.filter = strength > 0 ? `blur(${(strength * 6).toFixed(2)}px) contrast(${(1 - strength * 0.12).toFixed(3)})` : "";
      grain.hidden = strength <= 0;
      grain.style.opacity = String(strength * 0.24);
    },
  };
}
