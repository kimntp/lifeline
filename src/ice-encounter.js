import * as THREE from "three";
import { createAlienFarmer } from "./alien-farmers.js";
import { resolveBaseCollision } from "./base-collision.js";
import { createIceNavigator } from "./ice-navigation.js";

const TASER_FLASH = new THREE.Color(0x24a8d1);

export class IceEncounter {
  constructor({ source, ground, iceBase, onPlayerDown = () => {} }) {
    this.group = new THREE.Group();
    this.group.name = "Colony2GrayAliens";
    this.base = iceBase;
    this.ground = ground;
    this.onPlayerDown = onPlayerDown;
    this.phase = "neutral";
    this.directContact = false;
    this.units = [];
    this.batonCooldown = 0;
    this.miningCooldown = 0;
    this.miningProgress = new Map();
    this.damageCooldown = 0;
    this.recovering = false;
    this.feedback = "";
    this.feedbackTime = 0;
    this.occluders = [];
    this.navigate = createIceNavigator(iceBase.obstacles, iceBase.location);
    this.miningSites = [];
    iceBase.group.updateMatrixWorld(true);
    iceBase.group.traverse(node => { if (node.isMesh) this.occluders.push(node); });
    const deposits = iceBase.group.children.filter(node => /ice_block|glacier_chunk|iceberg/.test(node.name));
    for (const deposit of deposits) {
      const box = new THREE.Box3().setFromObject(deposit), center = box.getCenter(new THREE.Vector3());
      for (const point of [new THREE.Vector3(box.min.x - 0.8, 0, center.z), new THREE.Vector3(box.max.x + 0.8, 0, center.z),
        new THREE.Vector3(center.x, 0, box.min.z - 0.8), new THREE.Vector3(center.x, 0, box.max.z + 0.8)]) {
        if (iceBase.obstacles.some(b => point.x > b.min.x - 0.35 && point.x < b.max.x + 0.35 && point.z > b.min.z - 0.35 && point.z < b.max.z + 0.35)) continue;
        point.y = ground?.heightAt(point.x, point.z) ?? 0;
        this.miningSites.push({ point, rock: center });
      }
    }
    this.tasks = { ice: false, water: false, crystal: false };
    this.message = "Colony 2 · Talk to one of the gray aliens.";
    for (let i = 0; i < 6; i++) {
      const visual = createAlienFarmer(source, "gray");
      const angle = i * Math.PI / 3;
      const home = new THREE.Vector3(iceBase.location.x + Math.cos(angle) * 5,
        0, iceBase.location.z + Math.sin(angle) * 5);
      home.y = ground?.heightAt(home.x, home.z) ?? 0;
      visual.position.copy(home);
      let rock = home.clone().add(new THREE.Vector3(0, 0, 1));
      if (deposits.length) {
        for (let attempt = 0; attempt < deposits.length; attempt++) {
          const bounds = new THREE.Box3().setFromObject(deposits[(i + attempt) % deposits.length]);
          const center = bounds.getCenter(new THREE.Vector3());
          rock = center;
          const candidates = [new THREE.Vector3(bounds.min.x - 0.7, 0, center.z),
            new THREE.Vector3(bounds.max.x + 0.7, 0, center.z),
            new THREE.Vector3(center.x, 0, bounds.min.z - 0.7), new THREE.Vector3(center.x, 0, bounds.max.z + 0.7)]
            .filter(point => !iceBase.obstacles.some(box => point.x > box.min.x - 0.35 && point.x < box.max.x + 0.35
              && point.z > box.min.z - 0.35 && point.z < box.max.z + 0.35))
            .sort((a, b) => Math.hypot(a.x - iceBase.location.x, a.z - iceBase.location.z)
              - Math.hypot(b.x - iceBase.location.x, b.z - iceBase.location.z));
          if (candidates.length) {
            home.copy(candidates[0]);
            home.y = ground?.heightAt(home.x, home.z) ?? 0;
            break;
          }
        }
      }
      // Begin at the assigned mining face rather than inside surrounding ice.
      visual.position.copy(home);
      const materials = [];
      visual.traverse(node => {
        if (!node.isMesh) return;
        const originals = Array.isArray(node.material) ? node.material : [node.material];
        const copies = originals.map(material => { const copy = material.clone(); materials.push({ material: copy, emissive: copy.emissive?.clone() }); return copy; });
        node.material = Array.isArray(node.material) ? copies : copies[0];
      });
      const pick = equipMiningPick(visual);
      visual.name = `Gray colonist ${i + 1}`;
      this.group.add(visual);
      this.units.push({ id: i, visual, home, rock, pick, materials, flashTime: 0,
        jobIndex: i % Math.max(1, this.miningSites.length), route: [], walkedDistance: 0,
        workPhase: "walk", workTime: 0, minedCycles: 0,
        state: "awake", hits: 0, stunTime: 0, attackTime: i * 0.2, elapsed: i });
    }
    this.water = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.5, 0.14, 32),
      new THREE.MeshStandardMaterial({ color: 0x5ca8be, roughness: 0.2, metalness: 0.3 }));
    this.water.name = "IceColonyWaterSource";
    this.water.position.set(iceBase.location.x, (ground?.heightAt(iceBase.location.x, iceBase.location.z) ?? 0) + 0.04, iceBase.location.z);
    this.group.add(this.water);
  }

  get asleep() { return this.units.filter(unit => unit.state === "asleep").length; }
  get lastAlien() { return this.units.find(unit => unit.state === "downed") ?? null; }
  inArea(position) { return Math.hypot(position.x - this.base.location.x, position.z - this.base.location.z) < 48; }

  recognize() {
    if (this.phase !== "neutral") return false;
    this.phase = "recognition";
    this.message = "The gray aliens recognize your suit.";
    return true;
  }
  turnHostile() {
    if (this.phase !== "recognition") return;
    this.phase = "hostile";
    this.message = "Colony 2 is hostile. Left-click: taser baton. Incapacitate; do not kill.";
  }

  lineOfSight(from, to) {
    const origin = from.clone().add(new THREE.Vector3(0, 1, 0));
    const target = to.clone().add(new THREE.Vector3(0, 1, 0));
    const distance = origin.distanceTo(target);
    const direction = target.sub(origin).normalize();
    if (this.occluders.length) {
      this.base.group.updateMatrixWorld(true);
      const raycaster = new THREE.Raycaster(origin, direction, 0.05, Math.max(0.05, distance - 0.1));
      return raycaster.intersectObjects(this.occluders, false).length === 0;
    }
    const ray = new THREE.Ray(origin, direction);
    const hit = new THREE.Vector3();
    return !this.base.obstacles.some(bounds => ray.intersectBox(bounds, hit) && origin.distanceTo(hit) < distance - 0.1);
  }

  strike(position, forward) {
    if (this.phase !== "hostile") return false;
    if (this.batonCooldown > 0) {
      this.feedback = "Baton recharging"; this.feedbackTime = 0.5;
      return false;
    }
    this.batonCooldown = 0.65;
    let selected = null, nearest = 2.7;
    for (const unit of this.units) {
      if (unit.state !== "awake") continue;
      const direction = unit.visual.position.clone().sub(position);
      if (Math.abs(direction.y) > 2) continue;
      direction.y = 0;
      const distance = direction.length();
      if (distance < nearest && (distance < 0.1 || direction.normalize().dot(forward) > 0.45)
        && this.lineOfSight(position, unit.visual.position)) { selected = unit; nearest = distance; }
    }
    if (!selected) {
      this.feedback = "No clear target in reach — face a gray alien and move closer";
      this.feedbackTime = 1.3;
      return false;
    }
    selected.hits++;
    selected.stunTime = 2.5;
    selected.flashTime = 0.3;
    this.feedback = `Taser connected · ${selected.visual.name} · Single stun`;
    this.feedbackTime = 1.5;
    this.message = this.feedback;
    selected.pick.visible = false;
    if (selected.hits >= 1) {
      const others = this.units.filter(unit => unit !== selected);
      if (others.every(unit => unit.state === "asleep")) {
        selected.state = "downed";
        this.phase = "lastDowned";
        this.message = "The last conscious alien is down, but responsive. E: talk to him.";
      } else {
        selected.state = "asleep";
        this.message = `${this.asleep}/6 asleep. The baton is nonlethal.`;
      }
    }
    return true;
  }

  assignTasks() {
    if (this.phase !== "lastDowned") return false;
    this.phase = "tasks";
    this.message = "Apollo: Translation processed. Mine an ice core with your inventory pickaxe, scan their water source, and take a crystal sample. Focus on those tasks.";
    return true;
  }
  mine(position, forward, tool) {
    if (tool !== "pickaxe" || this.phase !== "tasks" || this.tasks.ice || this.miningCooldown > 0) return false;
    this.base.group.updateMatrixWorld(true);
    const origin = position.clone().add(new THREE.Vector3(0, 1, 0));
    const candidates = this.base.group.children.filter(piece => piece.name === "ice_block").map(piece => {
      const bounds = new THREE.Box3().setFromObject(piece);
      return { piece, bounds, point: bounds.clampPoint(origin, new THREE.Vector3()) };
    }).sort((a, b) => a.point.distanceTo(origin) - b.point.distanceTo(origin));
    for (const { piece, bounds, point } of candidates) {
      if (point.distanceTo(origin) > 2.7) continue;
      const target = bounds.getCenter(new THREE.Vector3());
      const facing = target.clone().sub(origin); facing.y = 0;
      if (facing.lengthSq() > 0.01 && facing.normalize().dot(forward) < 0.45) continue;
      target.y = THREE.MathUtils.clamp(origin.y, bounds.min.y, bounds.max.y);
      const direction = target.clone().sub(origin), distance = direction.length();
      const ray = new THREE.Raycaster(origin, direction.normalize(), 0.02, distance);
      const hit = ray.intersectObjects(this.occluders, false)[0];
      if (hit) {
        let ancestor = hit.object;
        while (ancestor && ancestor !== piece) ancestor = ancestor.parent;
        if (!ancestor) continue;
      }
      this.miningCooldown = 0.55;
      const strikes = (this.miningProgress.get(piece) ?? 0) + 1;
      this.miningProgress.set(piece, strikes);
      this.feedback = `Mining ice · ${Math.min(strikes, 3)}/3 pickaxe strikes`;
      this.feedbackTime = 1.5;
      if (strikes >= 3) this.collect("ice", "pickaxe");
      return true;
    }
    this.feedback = "Face an ice block and move closer to mine"; this.feedbackTime = 1.5;
    return false;
  }

  collect(type, tool = null) {
    if (this.phase !== "tasks" || !Object.hasOwn(this.tasks, type) || this.tasks[type] || (type === "ice" && tool !== "pickaxe")) return false;
    this.tasks[type] = true;
    this.message = `Apollo: ${type === "water" ? "Water scan" : `${type} sample`} logged.`;
    if (Object.values(this.tasks).every(Boolean)) {
      this.phase = "complete";
      this.message = "Apollo: Resource tasks complete. Samples logged. Await further instructions.";
    }
    return true;
  }

  update(delta, player, playerState) {
    this.batonCooldown = Math.max(0, this.batonCooldown - delta);
    this.miningCooldown = Math.max(0, this.miningCooldown - delta);
    this.damageCooldown = Math.max(0, this.damageCooldown - delta);
    this.feedbackTime = Math.max(0, this.feedbackTime - delta);
    if (playerState.health <= 0) {
      if (!this.recovering) {
        this.recovering = true;
        Promise.resolve(this.onPlayerDown()).finally(() => { this.recovering = false; });
      }
      return;
    }
    for (const unit of this.units) {
      const pos = unit.visual.position;
      unit.elapsed += delta;
      unit.stunTime = Math.max(0, unit.stunTime - delta);
      unit.attackTime = Math.max(0, unit.attackTime - delta);
      unit.flashTime = Math.max(0, unit.flashTime - delta);
      for (const { material, emissive } of unit.materials) {
        if (emissive) material.emissive.copy(unit.flashTime > 0 ? TASER_FLASH : emissive);
      }
      unit.pick.visible = this.phase === "neutral" && unit.state === "awake";
      if (unit.state !== "awake") {
        unit.visual.rotation.z = unit.state === "downed" ? -0.8 : -Math.PI / 2;
        pos.y = (this.ground?.heightAt(pos.x, pos.z) ?? 0) + 0.3;
        unit.visual.userData.animator.update(0, false, false);
        continue;
      }
      let walking = false, striking = false;
      if (this.phase !== "recognition" && unit.stunTime <= 0) {
        const attacking = this.phase === "hostile" && this.inArea(player.position);
        if (!attacking) while (unit.route.length && Math.hypot(unit.route[0].x - pos.x, unit.route[0].z - pos.z) < 0.2) unit.route.shift();
        const target = attacking ? player.position : unit.route[0] ?? unit.home;
        const direction = target.clone().sub(pos); direction.y = 0;
        const distance = direction.length();
        striking = attacking && distance < 1.9;
        if (distance > (attacking ? 1.35 : 0.2)) {
          const previous = pos.clone();
          pos.addScaledVector(direction.normalize(), Math.min(distance, (attacking ? 2.4 : 0.9) * delta));
          for (const bounds of this.base.obstacles) resolveBaseCollision(pos, previous, bounds, 0.3);
          unit.walkedDistance += Math.hypot(pos.x - previous.x, pos.z - previous.z);
          pos.y = this.ground?.heightAt(pos.x, pos.z) ?? 0;
          unit.visual.rotation.y = Math.atan2(direction.x, direction.z);
          walking = true;
        }
        if (!attacking && !unit.route.length && Math.hypot(unit.home.x - pos.x, unit.home.z - pos.z) <= 0.25) {
          if (unit.workPhase === "walk") { unit.workPhase = "mine"; unit.workTime = 5 + unit.id; }
          unit.workTime -= delta;
          if (unit.workTime <= 0) {
            if (unit.workPhase === "mine") { unit.minedCycles++; unit.workPhase = "rest"; unit.workTime = 1.5; }
            else if (this.miningSites.length > 1) {
              // Rotate work faces after every rest, with independent schedules.
              for (let attempt = 1; attempt <= this.miningSites.length; attempt++) {
                const index = (unit.jobIndex + attempt) % this.miningSites.length;
                const next = this.miningSites[index];
                if (next.point.distanceTo(unit.home) < 1) continue;
                const route = this.navigate(pos, next.point);
                if (!route.length) continue;
                unit.jobIndex = index; unit.home.copy(next.point); unit.rock.copy(next.rock);
                unit.route = route; unit.workPhase = "walk"; break;
              }
              if (unit.workPhase !== "walk") { unit.workPhase = "mine"; unit.workTime = 5 + unit.id; }
            } else { unit.workPhase = "mine"; unit.workTime = 5 + unit.id; }
          }
          striking = unit.workPhase === "mine";
          unit.visual.rotation.y = Math.atan2(unit.rock.x - pos.x, unit.rock.z - pos.z);
        }
        if (attacking && distance < 1.9 && Math.abs(pos.y - player.position.y) < 2
          && unit.attackTime <= 0 && this.damageCooldown <= 0 && this.lineOfSight(pos, player.position)) {
          playerState.health = Math.max(0, playerState.health - 8);
          this.damageCooldown = 0.7;
          unit.attackTime = 1.4;
        }
      }
      unit.visual.userData.animator.update(delta, walking, striking);
    }
  }

  dispose() {
    for (const unit of this.units) {
      unit.visual.userData.animator.dispose();
      for (const item of unit.materials) item.material.dispose();
      unit.pick.traverse(node => { if (node.isMesh) { node.geometry.dispose(); node.material.dispose(); } });
    }
    this.water.geometry.dispose(); this.water.material.dispose();
  }
}

export function equipTaserBaton(player) {
  player.updateMatrixWorld(true);
  const hand = player.getObjectByName("maoL") ?? player;
  const baton = new THREE.Group();
  baton.name = "TaserBaton";
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.18, 12),
    new THREE.MeshStandardMaterial({ color: 0x20252c, roughness: 0.7 }));
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.42, 12),
    new THREE.MeshStandardMaterial({ color: 0x72cfe9, emissive: 0x2c9fc4, emissiveIntensity: 0.7, metalness: 0.6, roughness: 0.3 }));
  rod.position.y = 0.3;
  baton.add(grip, rod);
  const scale = hand.getWorldScale(new THREE.Vector3());
  baton.scale.set(1 / scale.x, 1 / scale.y, 1 / scale.z);
  hand.add(baton);
  return baton;
}

export function equipMiningPick(visual, playerTool = false) {
  visual.updateMatrixWorld(true);
  const hand = visual.getObjectByName(playerTool ? "maoL" : "mixamorigRightHand") ?? visual;
  const pick = new THREE.Group(); pick.name = "IceMiningPick";
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.42, 8),
    new THREE.MeshStandardMaterial({ color: 0x665747, roughness: 0.9 }));
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.045, 0.065),
    new THREE.MeshStandardMaterial({ color: 0x9daab3, metalness: 0.7, roughness: 0.4 }));
  head.position.y = 0.2;
  pick.add(handle, head);
  const scale = hand.getWorldScale(new THREE.Vector3());
  pick.scale.set(1 / scale.x, 1 / scale.y, 1 / scale.z);
  hand.add(pick);
  return pick;
}
