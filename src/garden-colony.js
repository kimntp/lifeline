import * as THREE from "three";
import { createAlienFarmer } from "./alien-farmers.js";

export const GARDEN_COLONY = {
  name: "Gale Crater — Garden Colony",
  ability: "Regenerate soil and accelerate plant growth",
  objective: "Enslave farmers and export crops to Earth",
};

const CONVERSATIONS = [
  { name: "Iri", role: "Soilkeeper", lines: [
    "Welcome to Gale Crater, our Garden Colony. These beds were barren dust before we arrived.",
    "We regenerate the soil and guide the roots. Tomatoes and wheat grow in days when we tend them together.",
    "The company promised us a home. Now its guards say we cannot leave until the harvest quotas are met.",
  ] },
  { name: "Vela", role: "Grower", lines: [
    "Watch the young shoots. Our touch helps them grow, but even living soil needs rest.",
    "The hab dome is our shelter. We go inside to rest and collect supplies, then return to the crops.",
    "Every cargo shipment goes to Earth. The company calls us partners, but forcing farmers to work without freedom is slavery.",
  ] },
  { name: "Naru", role: "Seedkeeper", lines: [
    "I save seeds from the wheat and tomatoes. A colony needs more than a single harvest to survive.",
    "The company wants our ability, not our well-being: enslave the farmers, export the crops, keep Earth supplied.",
    "Please remember that this garden belongs to the people who make it live.",
  ] },
];

function normalizedModel(source, height) {
  const model = source.clone(true);
  let bounds = new THREE.Box3().setFromObject(model);
  model.scale.multiplyScalar(height / bounds.getSize(new THREE.Vector3()).y);
  bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  model.position.add(new THREE.Vector3(-center.x, -bounds.min.y, -center.z));
  model.traverse(mesh => { if (mesh.isMesh) mesh.castShadow = mesh.receiveShadow = true; });
  const pivot = new THREE.Group();
  pivot.add(model);
  return pivot;
}

export function findColonySite(ground, baseBounds) {
  const baseCenter = baseBounds.getCenter(new THREE.Vector3());
  const bounds = ground?.bounds ?? new THREE.Box3(new THREE.Vector3(-100, 0, -100), new THREE.Vector3(100, 0, 100));
  let best;
  for (let x = Math.ceil((bounds.min.x + 13) / 8) * 8; x <= bounds.max.x - 13; x += 8) {
    for (let z = Math.ceil((bounds.min.z + 15) / 8) * 8; z <= bounds.max.z - 15; z += 8) {
      const distance = Math.hypot(x - baseCenter.x, z - baseCenter.z);
      if (distance < 22 || distance > 60) continue;
      if (x + 11 > baseBounds.min.x - 3 && x - 11 < baseBounds.max.x + 3
        && z + 14 > baseBounds.min.z - 3 && z - 14 < baseBounds.max.z + 3) continue;
      let low = Infinity, high = -Infinity;
      for (let ix = -2; ix <= 2; ix++) {
        for (let iz = -2; iz <= 2; iz++) {
          const y = ground?.heightAt(x + ix * 5, z + iz * 6) ?? 0;
          low = Math.min(low, y); high = Math.max(high, y);
        }
      }
      const score = high - low + distance * 0.055;
      if (!best || score < best.score) best = { x, z, score };
    }
  }
  if (!best) throw new Error("No terrain patch is available for the garden colony");
  return best;
}

function surfaceRange(ground, x, z, halfX, halfZ) {
  let low = Infinity, high = -Infinity;
  for (let ix = 0; ix <= 8; ix++) {
    for (let iz = 0; iz <= 8; iz++) {
      const y = ground?.heightAt(x - halfX + ix / 8 * halfX * 2, z - halfZ + iz / 8 * halfZ * 2) ?? 0;
      low = Math.min(low, y); high = Math.max(high, y);
    }
  }
  return { low, high };
}

export class GardenWorker {
  constructor({ index, visual, plots, entrance, interior, groundHeight }) {
    this.index = index;
    this.visual = visual;
    this.plots = plots;
    this.entrance = entrance;
    this.interior = interior;
    this.groundHeight = groundHeight;
    this.profile = CONVERSATIONS[index % CONVERSATIONS.length];
    this.plotIndex = index % plots.length;
    this.phase = "toCrop";
    this.timer = 0;
    this.elapsed = 0;
    this.talking = false;
    visual.position.copy(entrance);
    visual.position.x += (index - 1) * 0.7;
    visual.position.y = groundHeight(visual.position.x, visual.position.z);
  }

  moveTo(target, delta) {
    const pos = this.visual.position;
    const dx = target.x - pos.x, dz = target.z - pos.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.12) return true;
    const step = Math.min(distance, 1.3 * delta);
    pos.x += dx / distance * step;
    pos.z += dz / distance * step;
    pos.y = this.groundHeight(pos.x, pos.z);
    this.visual.rotation.y = Math.atan2(dx, dz);
    return false;
  }

  pose(walking, tending, delta) {
    this.visual.userData.animator.update(delta, walking, tending);
  }

  update(delta) {
    this.elapsed += delta;
    if (this.talking) { this.pose(false, false, delta); return; }
    let walking = false, tending = false;
    if (this.phase === "toCrop") {
      walking = true;
      if (this.moveTo(this.plots[this.plotIndex].workPosition, delta)) {
        this.phase = "tend"; this.timer = 6 + this.index;
      }
    } else if (this.phase === "tend") {
      tending = true;
      const plot = this.plots[this.plotIndex];
      this.visual.rotation.y = Math.atan2(plot.center.x - this.visual.position.x, plot.center.z - this.visual.position.z);
      plot.growth = Math.min(1, plot.growth + delta * 0.055);
      plot.active = true;
      this.timer -= delta;
      if (this.timer <= 0) this.phase = "toDome";
    } else if (this.phase === "toDome") {
      walking = true;
      if (this.moveTo(this.entrance, delta)) this.phase = "enter";
    } else if (this.phase === "enter") {
      walking = true;
      if (this.moveTo(this.interior, delta)) {
        this.phase = "inside"; this.timer = 4 + this.index;
        this.visual.visible = false;
      }
    } else if (this.phase === "inside") {
      this.timer -= delta;
      if (this.timer <= 0) {
        this.visual.position.copy(this.interior);
        this.visual.visible = true;
        this.phase = "exit";
      }
    } else if (this.phase === "exit") {
      walking = true;
      if (this.moveTo(this.entrance, delta)) {
        this.plotIndex = (this.plotIndex + 1) % this.plots.length;
        this.phase = "toCrop";
      }
    }
    this.pose(walking, tending, delta);
  }
}

export function nearestGardenWorker(workers, position, range = 3) {
  let nearest = null, distance = range;
  for (const worker of workers) {
    if (!worker.visual.visible || ["inside", "enter", "exit"].includes(worker.phase)) continue;
    const p = worker.visual.position;
    const d = Math.hypot(p.x - position.x, p.z - position.z);
    if (d <= distance && Math.abs(p.y - position.y) < 3) { nearest = worker; distance = d; }
  }
  return nearest;
}

export function buildGardenColony({ tomato, wheat, dome, aliens, ground, baseBounds, location = null }) {
  let site;
  if (location) {
    const { x, z } = location;
    const bounds = ground?.bounds;
    if (!Number.isFinite(x) || !Number.isFinite(z) || (bounds && (x - 13 < bounds.min.x
      || x + 13 > bounds.max.x || z - 15 < bounds.min.z || z + 15 > bounds.max.z))) {
      throw new Error("Move farther inland so the entire colony fits on the terrain.");
    }
    if (x + 11 > baseBounds.min.x - 3 && x - 11 < baseBounds.max.x + 3
      && z + 14 > baseBounds.min.z - 3 && z - 14 < baseBounds.max.z + 3) {
      throw new Error("Choose a spot farther from the base so the colony does not overlap it.");
    }
    site = { x, z, score: 0 };
  } else site = findColonySite(ground, baseBounds);
  const group = new THREE.Group();
  group.name = "GaleCraterGardenColony";
  const terrainHeight = (x, z) => ground?.heightAt(x, z) ?? 0;
  const habitat = normalizedModel(dome, 6.4);
  const domeX = site.x, domeZ = site.z - 8;
  const domeSurface = surfaceRange(ground, domeX, domeZ, 4.5, 4.5);
  const domeFloor = domeSurface.high + 0.04;
  habitat.position.set(domeX, domeFloor, domeZ);
  habitat.name = "GardenHabDome";
  const padHeight = domeFloor - domeSurface.low + 0.2;
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.6, padHeight, 32),
    new THREE.MeshStandardMaterial({ color: 0x5d6265, roughness: 0.9 }));
  pad.position.set(domeX, domeFloor - padHeight / 2, domeZ);
  pad.receiveShadow = true;
  group.add(habitat, pad);
  const domeBounds = new THREE.Box3().setFromObject(habitat);
  // Include the opaque plinth, but only player/hostile collision uses this box.
  domeBounds.union(new THREE.Box3().setFromObject(pad));

  const tomatoTemplate = normalizedModel(tomato, 1.05);
  const wheatTemplate = normalizedModel(wheat, 0.95);
  const plots = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      const x = site.x + (col ? 4 : -4), z = site.z + 2 + row * 6;
      const surface = surfaceRange(ground, x, z, 2.5, 2);
      const top = surface.high + 0.08;
      const soilMaterial = new THREE.MeshStandardMaterial({ color: 0x493226, roughness: 1 });
      const bed = new THREE.Mesh(new THREE.BoxGeometry(5, top - surface.low + 0.15, 4), soilMaterial);
      bed.position.set(x, (top + surface.low - 0.15) / 2, z);
      bed.receiveShadow = true;
      group.add(bed);
      const plants = [];
      const template = col ? wheatTemplate : tomatoTemplate;
      for (let iz = 0; iz < 3; iz++) {
        for (let ix = 0; ix < 4; ix++) {
          const plant = template.clone(true);
          plant.position.set(x - 1.8 + ix * 1.2, top, z - 1.2 + iz * 1.2);
          plant.rotation.y = (ix + iz) * 0.65;
          plant.scale.setScalar(0.65);
          group.add(plant); plants.push(plant);
        }
      }
      const pulse = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.43, 32),
        new THREE.MeshBasicMaterial({ color: 0xa3ffac, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
      pulse.rotation.x = -Math.PI / 2;
      pulse.position.set(x, top + 0.025, z);
      group.add(pulse);
      plots.push({ center: new THREE.Vector3(x, top, z), plants, soilMaterial, pulse, growth: 0, active: false,
        bounds: new THREE.Box3(new THREE.Vector3(x - 2.5, surface.low, z - 2), new THREE.Vector3(x + 2.5, top, z + 2)),
        workPosition: new THREE.Vector3(x, terrainHeight(x, z - 2.5), z - 2.5), crop: col ? "wheat" : "tomato" });
    }
  }
  const heightAt = (x, z) => {
    let height = terrainHeight(x, z);
    for (const plot of plots) {
      if (x >= plot.bounds.min.x && x <= plot.bounds.max.x && z >= plot.bounds.min.z && z <= plot.bounds.max.z) height = Math.max(height, plot.bounds.max.y);
    }
    if (x >= domeBounds.min.x && x <= domeBounds.max.x && z >= domeBounds.min.z && z <= domeBounds.max.z) height = Math.max(height, domeFloor);
    return height;
  };
  const entrance = new THREE.Vector3(domeX, heightAt(domeX, domeZ + 5.2), domeZ + 5.2);
  const interior = new THREE.Vector3(domeX, domeFloor, domeZ);
  const workers = [];
  for (let index = 0; index < 3; index++) {
    const variant = index % 2 ? "gray" : "green";
    const visual = createAlienFarmer(aliens[variant], variant);
    visual.name = CONVERSATIONS[index].name;
    group.add(visual);
    workers.push(new GardenWorker({ index, visual, plots, entrance, interior, groundHeight: heightAt }));
  }
  const bounds = new THREE.Box3(new THREE.Vector3(site.x - 11, 0, site.z - 14), new THREE.Vector3(site.x + 11, 100, site.z + 14));
  let elapsed = 0;
  const dry = new THREE.Color(0x493226), fertile = new THREE.Color(0x456b3a);
  return {
    group, site, plots, workers, domeBounds, bounds, heightAt,
    dispose() {
      // The source FBX geometry/materials are reused when relocating the colony.
      const sourceGeometry = new Set(), sourceMaterials = new Set();
      for (const source of [tomato, wheat, dome, ...Object.values(aliens)]) source.traverse(node => {
        if (!node.isMesh) return;
        sourceGeometry.add(node.geometry);
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) sourceMaterials.add(material);
      });
      const geometry = new Set(), materials = new Set();
      group.traverse(node => {
        if (!node.isMesh) return;
        if (!sourceGeometry.has(node.geometry)) geometry.add(node.geometry);
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          if (!sourceMaterials.has(material)) materials.add(material);
        }
      });
      for (const worker of workers) worker.visual.userData.animator.dispose();
      for (const item of geometry) item.dispose();
      for (const item of materials) item.dispose();
    },
    update(delta) {
      elapsed += delta;
      for (const plot of plots) plot.active = false;
      for (const worker of workers) worker.update(delta);
      for (const plot of plots) {
        for (const plant of plot.plants) plant.scale.setScalar(0.65 + plot.growth * 0.35);
        plot.soilMaterial.color.lerpColors(dry, fertile, plot.growth);
        plot.pulse.material.opacity = plot.active ? 0.3 + Math.sin(elapsed * 3) * 0.15 : 0;
        plot.pulse.scale.setScalar(1 + (elapsed % 2) * 2);
      }
    },
  };
}
