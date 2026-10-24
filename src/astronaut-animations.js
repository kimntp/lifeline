import * as THREE from "three";

// Exact names exported by Astronauta.fbx, including its reference poses.
export const ASTRONAUT_CLIPS = [
  "Armação|PistolIdle",
  "Armação|0TPose.002",
  "Armação|PistolPickup",
  "Armação|0TPose.006",
  "Armação|0TPose.004",
  "Armação|Minering",
  "Armação|ColetandoChao",
  "Armação|ArmaçãoAction",
  "Armação|0TPose",
  "Armação|Walk",
  "Armação|Die",
  "Armação|0TPose.003",
  "Armação|Running",
  "Armação|ColetandoPistola",
  "Armação|Idle",
  "Armação|0TPose.007",
];

const LOOPING_CLIPS = new Set(["Idle", "PistolIdle", "Walk", "Running"]);

export class AstronautAnimator {
  constructor(player) {
    this.mixer = new THREE.AnimationMixer(player);
    this.actions = {};
    this.current = null;
    this.preview = false;
    this.oneShot = false;

    const targets = new Map();
    player.traverse((node) => {
      // FBXLoader nests identity copies of a shared bone for additional skins.
      // They inherit the animated parent; animating them again compounds it.
      if (node.isBone && node.parent?.isBone && node.ID !== undefined
        && node.ID === node.parent.ID) return;
      if (!targets.has(node.name)) targets.set(node.name, []);
      targets.get(node.name).push(node);
    });

    for (const source of player.animations) {
      const tracks = [];
      for (const track of source.tracks) {
        const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
        const nodes = targets.get(nodeName);
        if (!nodes?.length) throw new Error(`Missing astronaut animation target: ${track.name}`);
        // Bind the actual animated bones, leaving nested skin copies untouched.
        for (const node of nodes) {
          const copy = track.clone();
          copy.name = `${node.uuid}.${propertyName}`;
          tracks.push(copy);
        }
      }
      // Preserve bone positions: removing them breaks this rig's poses.
      // The source clips animate the rig inside the player, not player movement.
      const clip = new THREE.AnimationClip(source.name, source.duration, tracks);
      const action = this.mixer.clipAction(clip);
      const shortName = source.name.split("|").at(-1);
      action.setLoop(LOOPING_CLIPS.has(shortName) ? THREE.LoopRepeat : THREE.LoopOnce,
        LOOPING_CLIPS.has(shortName) ? Infinity : 1);
      action.clampWhenFinished = true;
      this.actions[source.name] = action;
    }

    for (const name of ASTRONAUT_CLIPS) {
      if (!this.actions[name]) throw new Error(`Missing astronaut clip: ${name}`);
    }
    this.mixer.addEventListener("finished", ({ action }) => {
      if (action === this.current) this.oneShot = false;
    });
    this.play("Armação|Idle");
  }

  play(name, restart = false) {
    const next = this.actions[name];
    if (!next || (next === this.current && !restart)) return;
    const previous = this.current;
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    if (previous && previous !== next) previous.crossFadeTo(next, 0.18, false);
    this.current = next;
  }

  setPreview(name) {
    this.preview = Boolean(name);
    this.oneShot = false;
    this.play(name || "Armação|Idle", true);
  }

  update({ isMoving, isSprinting, isGrounded, hit }) {
    if (this.preview) return;
    // No jump/fall/hit clips are included. Use idle in the air and the native
    // mining swing for H/attack rather than binding an incompatible skeleton.
    if (hit && !this.oneShot && isGrounded) {
      this.play("Armação|Minering", true);
      this.oneShot = true;
    }
    if (this.oneShot) return;
    this.play(!isGrounded || !isMoving ? "Armação|Idle"
      : isSprinting ? "Armação|Running" : "Armação|Walk");
  }
}
