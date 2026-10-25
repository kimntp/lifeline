import * as THREE from "three";
import { AstronautAnimator, cloneAstronaut } from "./astronaut-animations.js";
import { applyAstronautSuit } from "./astronaut-suit.js";
import { equipTaserBaton } from "./ice-encounter.js";
import { createIceNavigator } from "./ice-navigation.js";

export function createAftermathActors({ scene, player, alienPosition, ground, obstacles = [], viewDirection }) {
  const group = new THREE.Group(); group.name = "IceAftermathActors"; scene.add(group);
  const owned = [], actors = [], occupied = [alienPosition.clone()];
  let disposed = false;
  function dispose() {
    if (disposed) return; disposed = true; group.removeFromParent();
    for (const actor of actors) {
      actor.animator.mixer.stopAllAction(); actor.animator.mixer.uncacheRoot(actor.visual);
      actor.visual.traverse(node => { if (node.isSkinnedMesh) node.skeleton.dispose(); });
    }
    for (const resource of owned) resource.dispose();
  }
  try {
    const axis = viewDirection.clone(); axis.y = 0; axis.normalize();
    if (axis.lengthSq() < 0.1) axis.set(0, 0, 1);
    const side = new THREE.Vector3(axis.z, 0, -axis.x);
    function clear(point) {
      const b = ground?.bounds;
      return (!b || (point.x > b.min.x + 0.6 && point.x < b.max.x - 0.6 && point.z > b.min.z + 0.6 && point.z < b.max.z - 0.6))
        && !obstacles.some(box => point.x > box.min.x - 0.45 && point.x < box.max.x + 0.45 && point.z > box.min.z - 0.45 && point.z < box.max.z + 0.45)
        && !occupied.some(other => Math.hypot(point.x - other.x, point.z - other.z) < 0.8);
    }
    function findClear(preferred) {
      for (let radius = 0; radius <= 7; radius += 0.7) for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
        const point = preferred.clone().add(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
        if (clear(point)) return point;
      }
      throw new Error("No clear ground is available for the guard arrival scene");
    }
    function actor(name, color, withBaton) {
      const visual = cloneAstronaut(player); visual.name = name; visual.visible = true;
      for (const tool of ["TaserBaton", "SurveyShovel", "IceMiningPick"]) visual.getObjectByName(tool)?.removeFromParent();
      visual.position.set(0, 0, 0); visual.rotation.set(0, 0, 0);
      owned.push(...applyAstronautSuit(visual, color));
      const animator = new AstronautAnimator(visual); animator.setPreview("Armação|Idle"); animator.mixer.update(0.25);
      visual.updateMatrixWorld(true); group.add(visual);
      let baton;
      if (withBaton) {
        baton = equipTaserBaton(visual);
        baton.traverse(node => { if (node.isMesh) owned.push(node.geometry, ...(Array.isArray(node.material) ? node.material : [node.material])); });
      }
      const result = { visual, animator, baton }; actors.push(result); return result;
    }
    function pose(actor, clip, time) {
      if (actor.clip !== clip) {
        actor.animator.mixer.stopAllAction(); actor.animator.current = null;
        actor.animator.setPreview(`Armação|${clip}`); actor.animator.current.setEffectiveTimeScale(0); actor.clip = clip;
      }
      const action = actor.animator.current, duration = action.getClip().duration;
      action.time = ["Idle", "Walk", "PistolIdle"].includes(clip) ? time % duration : Math.min(duration, Math.max(0, time));
      actor.animator.mixer.update(0);
      const p = actor.visual.position, floor = ground?.heightAt(p.x, p.z) ?? 0;
      p.y = floor; actor.visual.updateMatrixWorld(true);
      p.y += floor - new THREE.Box3().setFromObject(actor.visual, true).min.y;
      actor.visual.updateMatrixWorld(true);
    }
    const target = findClear(alienPosition.clone().addScaledVector(axis, 1.8)); occupied.push(target);
    const astronaut = actor("Aftermath white astronaut", "white", false); astronaut.visual.position.copy(target);
    astronaut.visual.rotation.y = Math.atan2(alienPosition.x - target.x, alienPosition.z - target.z); pose(astronaut, "Idle", 0);
    const navigate = createIceNavigator(obstacles, alienPosition);
    const guards = [];
    for (let i = 0; i < 4; i++) {
      const preferred = target.clone().addScaledVector(axis, i === 0 ? 0.85 : 2 + Math.floor(i / 2) * 1.2)
        .addScaledVector(side, i === 0 ? -0.1 : i % 2 ? -1.25 : 1.25);
      const end = findClear(preferred); occupied.push(end);
      const start = findClear(end.clone().addScaledVector(axis, 6));
      let route = navigate(start, end);
      if (!route.length) route = [end.clone(), end.clone()];
      const guard = actor(`Aftermath black guard ${i + 1}`, "black", true);
      guard.route = route; guards.push(guard);
    }
    function placeOnRoute(guard, progress) {
      const lengths = guard.route.slice(1).map((point, i) => Math.hypot(point.x - guard.route[i].x, point.z - guard.route[i].z));
      let distance = lengths.reduce((sum, length) => sum + length, 0) * progress;
      let index = 0;
      while (index < lengths.length - 1 && distance > lengths[index]) { distance -= lengths[index]; index++; }
      const a = guard.route[index], b = guard.route[index + 1];
      guard.visual.position.lerpVectors(a, b, lengths[index] ? distance / lengths[index] : 1);
      guard.visual.rotation.y = progress < 1 ? Math.atan2(b.x - a.x, b.z - a.z)
        : Math.atan2(target.x - guard.visual.position.x, target.z - guard.visual.position.z);
    }
    return {
      group, astronaut, guards, target, axis, side,
      update(phase, time, elapsed) {
        astronaut.visual.visible = phase !== "pain";
        const progress = phase === "pain" ? 0 : phase === "march" ? THREE.MathUtils.clamp(time / 5, 0, 1) : 1;
        for (const [i, guard] of guards.entries()) {
          guard.visual.visible = phase !== "pain";
          placeOnRoute(guard, progress);
          pose(guard, phase === "march" ? "Walk" : phase === "strike" && i === 0 ? "Minering" : "PistolIdle",
            phase === "strike" && i === 0 ? Math.max(0, time - 0.5) * 0.9 : elapsed);
        }
        const down = ["down", "glitch", "dialogue"].includes(phase);
        pose(astronaut, down || (phase === "strike" && time >= 1.05) ? "Die" : "Idle",
          down ? 10 : phase === "strike" ? Math.max(0, time - 1.05) : elapsed);
        astronaut.visual.userData.knockedDown = down || (phase === "strike" && time >= 1.05);
      },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
