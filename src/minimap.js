import { getMinimapState, projectMinimapPoint } from "./minimap-state.mjs";

export function createMinimap() {
  const root = document.createElement("section");
  root.id = "minimap";
  root.hidden = true;
  root.setAttribute("aria-label", "Navigation");
  root.innerHTML = `
    <canvas id="minimap-canvas" role="img" aria-label="Player, base and Colony 1 map"></canvas>
    <p id="minimap-target"></p>`;
  document.body.appendChild(root);
  const canvas = root.querySelector("#minimap-canvas");
  const label = root.querySelector("#minimap-target");
  const context = canvas.getContext("2d");
  const font = getComputedStyle(root).fontFamily;
  let size = 180, previousLabel = "", previousPhase = null;
  const resize = () => {
    size = canvas.getBoundingClientRect().width || 180;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * ratio); canvas.height = Math.round(size * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  const circle = (x, y, radius) => { context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); };
  return {
    update(input, visible = true) {
      const state = getMinimapState(input);
      root.hidden = !visible || !state;
      if (root.hidden) return;
      const text = `${state.target.name} - ${Math.round(state.distance)} m`;
      if (text !== previousLabel) { label.textContent = text; previousLabel = text; }
      if (previousPhase !== state.phase2) {
        canvas.setAttribute("aria-label", `North-up map: player, base, Colony 1${state.phase2 ? " and Colony 2" : ""}`);
        previousPhase = state.phase2;
      }
      const c = context, middle = size / 2;
      c.clearRect(0, 0, size, size);
      c.save(); circle(middle, middle, middle - 2); c.clip();
      const background = c.createRadialGradient(middle, middle, 0, middle, middle, middle);
      background.addColorStop(0, "#201b2c"); background.addColorStop(1, "#0b0d17");
      c.fillStyle = background; c.fillRect(0, 0, size, size);
      c.strokeStyle = "rgba(199,170,232,0.13)"; c.lineWidth = 1;
      for (const radius of [0.3, 0.6, 0.9]) { circle(middle, middle, middle * radius); c.stroke(); }
      c.beginPath(); c.moveTo(middle, 8); c.lineTo(middle, size - 8);
      c.moveTo(8, middle); c.lineTo(size - 8, middle); c.stroke();
      const projected = point => projectMinimapPoint(point, state, size);
      const player = projected(state.player), target = projected(state.target);
      // A destination guide, rather than a claim that a straight route avoids obstacles.
      c.setLineDash([3, 5]); c.strokeStyle = "rgba(213,185,245,0.75)";
      c.beginPath(); c.moveTo(player.x, player.y); c.lineTo(target.x, target.y); c.stroke(); c.setLineDash([]);
      for (const marker of state.markers) {
        const p = projected(marker), selected = marker.id === state.target.id;
        if (selected) { circle(p.x, p.y, 12); c.strokeStyle = "rgba(213,185,245,0.65)"; c.stroke(); }
        circle(p.x, p.y, 8); c.fillStyle = marker.id === "base" ? "#b8b8c4" : "#c7a0f1"; c.fill();
        c.fillStyle = "#17111f"; c.font = `700 10px ${font}`;
        c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(marker.label, p.x, p.y + 0.5);
      }
      c.save(); c.translate(player.x, player.y); c.rotate(Math.PI - state.player.yaw);
      c.beginPath(); c.moveTo(0, -8); c.lineTo(5.5, 6); c.lineTo(0, 3); c.lineTo(-5.5, 6); c.closePath();
      c.fillStyle = "#fffaff"; c.strokeStyle = "#352743"; c.lineWidth = 1.5; c.fill(); c.stroke(); c.restore();
      c.fillStyle = "#deccf1"; c.font = `600 10px ${font}`; c.textAlign = "center"; c.fillText("N", middle, 11);
      c.restore();
      circle(middle, middle, middle - 1.5); c.strokeStyle = "rgba(199,170,232,0.55)"; c.lineWidth = 1.5; c.stroke();
    },
    destroy() { observer.disconnect(); root.remove(); },
  };
}
