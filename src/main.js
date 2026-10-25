import * as THREE from "three"; // Core 3D engine
import { registerNarrationAudio } from "./narration-audio.js";
import { createOrangeBotOverlay } from "./orangebot-overlay.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"; // Load .glb city model
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { ASTRONAUT_CLIPS, AstronautAnimator } from "./astronaut-animations.js";
import { TerrainGround, advanceGroundedActor, measureFootOffset } from "./terrain-ground.js";
import { createTerrainSurround } from "./terrain-surround.js";

const shared = {
  scene: null,
  renderer: null,
  camera: null,
  city: null,
  terrainGround: null,
  playerFootOffset: 0,
  player: null,
  mixer: null,
  actions: null,
  keyboard: null,
  look: { yaw: 0, pitch: 0, sensitivity: 0.0022 },
  playerState: { velocity: new THREE.Vector3(), grounded: true, groundY: 0 },
  orbit: { theta: 0, phi: 0.4, distance: 50 },
  stateMachine: null,
  cameraDistance: 8,
};

const flags = {
  gravity: false,
  movement: false,
  cameraFollow: false,
};

let _previewId = null;
let _previewing = false;
const _previewFns = [];

const _loopShared = {
  move: new THREE.Vector3(),
  basisForward: new THREE.Vector3(),
  basisRight: new THREE.Vector3(),
  camPos: new THREE.Vector3(),
  camLook: new THREE.Vector3(),
  smoothCamPos: new THREE.Vector3(),
  smoothCamLook: new THREE.Vector3(),
  freeDir: new THREE.Vector3(),
  freeRight: new THREE.Vector3(),
  smoothInited: false,
  cameraMode: "third-person",
  hit: false,
};



export function loadAstronaut(scene) {
  const loader = new FBXLoader();

  loader.load(
    "/assets/Astronauta.fbx",
    (astronaut) => {
      astronaut.scale.setScalar(0.01);
      scene.add(astronaut);

      console.log("Astronaut loaded!");

      console.log(
        "Animations found:",
        astronaut.animations.length
      );

      astronaut.animations.forEach((clip, index) => {
        console.log(
          index,
          clip.name,
          clip.duration
        );
      });

      const animator = new AstronautAnimator(astronaut);
      addPreviewFn((delta) => animator.mixer.update(delta));
    },
    undefined,
    (error) => {
      console.error("Failed to load astronaut:", error);
    }
  );
}


function addPreviewFn(fn, priority = 0) {
  fn.priority = priority;
  _previewFns.push(fn);
  _previewFns.sort((a, b) => a.priority - b.priority);
}

function startPreview() {
  if (_previewing) return;
  _previewing = true;

  const clock = new THREE.Clock();

  function loop() {
    if (!_previewing) return;
    // Cap delta at 0.1s to prevent physics tunneling on lag spikes
    const delta = Math.min(clock.getDelta(), 0.1);

    // Execute every registered per-frame feature callback in sequence
    for (const fn of _previewFns) {
      fn(delta);
    }

    // Final render pass — draw everything to the canvas
    const { scene, renderer, camera } = shared;
    if (scene && renderer && camera) {
      renderer.render(scene, camera);
    }

    _previewId = requestAnimationFrame(loop);
  }
  loop();
}

function enableShadowsRecursive(root) {
  root.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
}

function step1_sceneSetup() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03040a);

  const canvas = document.querySelector("#game-canvas");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  // Match canvas size to viewport, cap pixel ratio at 2x for performance
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    2000,
  );
  // Place camera above and back from origin for a top-down city preview
  camera.position.set(0, 25, 60);
  camera.lookAt(0, 0, 0);

  // Soft ambient fill — prevents pure-black shadows
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));

  // Main directional sun light with high-res shadow map covering the city area
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(80, 120, 60);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.camera.left = -150;
  dirLight.shadow.camera.right = 150;
  dirLight.shadow.camera.top = 150;
  dirLight.shadow.camera.bottom = -150;
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = 400;
  // Small negative bias to reduce shadow acne on flat ground
  dirLight.shadow.bias = -0.0005;
  scene.add(dirLight);

  // Sky/ground hemisphere light — blue from above, brown from below
  scene.add(new THREE.HemisphereLight(0xb1e1ff, 0x4d3a26, 0.4));

  // Giant flat ground plane as a safety net beneath the city
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2000, 2000),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 1 }),
  );
  // Rotate plane 90° on X so it lies flat (PlaneGeometry defaults to XY)
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = "GroundSafetyNet";
  scene.add(ground);

  // Re-render on window resize to keep aspect ratio and canvas size correct
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.render(scene, camera);
  });

  shared.scene = scene;
  shared.renderer = renderer;
  shared.camera = camera;
  new THREE.TextureLoader().load(
    "/assets/space-panorama.png",
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.mapping = THREE.EquirectangularReflectionMapping;
      scene.background = texture;
      renderer.render(scene, camera);
    },
    undefined,
    (error) => console.warn("[background] Space panorama failed to load:", error),
  );
  renderer.render(scene, camera);
}

async function step2_city() {
  const { scene, renderer, camera } = shared;
  const gltfLoader = new GLTFLoader();

  // Wrap GLTF load in a Promise so main() can await it before continuing
  return new Promise((resolve) => {
    gltfLoader.load(
      "/assets/city.glb",
      (gltf) => {
        enableShadowsRecursive(gltf.scene);
        gltf.scene.name = "City";
        gltf.scene.scale.setScalar(100);
        // Align the scaled city's base with the game's ground at y=0.
        const cityBounds = new THREE.Box3().setFromObject(gltf.scene);
        if (Number.isFinite(cityBounds.min.y)) {
          gltf.scene.position.y -= cityBounds.min.y;
        }
        scene.add(gltf.scene);
        shared.city = gltf.scene;
        shared.terrainGround = new TerrainGround(gltf.scene);
        scene.add(createTerrainSurround(gltf.scene, shared.terrainGround));
        scene.getObjectByName("GroundSafetyNet").visible = false;
        // Hide the distant tile limit while retaining the surrounding stars.
        scene.fog = new THREE.Fog(0x03040a, 220, 520);
        renderer.render(scene, camera);
        resolve(gltf.scene);
      },
      undefined,
      () => {
        console.warn("[city] GLB not found \u2192 procedural fallback");
        const city = buildProceduralCity(scene);
        shared.city = city;
        renderer.render(scene, camera);
        resolve(city);
      },
    );
  });
}

function buildProceduralCity(scene) {
  const g = new THREE.Group();
  g.name = "City";
  // Dark gray material for the two cross roads (N-S and E-W)
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
  // Create two perpendicular roads as wide flat boxes crossing at origin
  for (const { w, d, x, z } of [
    { w: 200, d: 12, x: 0, z: 0 },
    { w: 12, d: 200, x: 0, z: 0 },
  ]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), roadMat);
    r.position.set(x, 0.025, z);
    r.receiveShadow = true;
    g.add(r);
  }
  // Seeded PRNG so procedural city is deterministic (no randomness between refreshes)
  const bldgMat = new THREE.MeshStandardMaterial({ color: 0x889099 });
  const rng = (() => {
    let s = 1;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  })();
  // Generate 4 city quadrants (NE, NW, SE, SW) with 10×10 buildings each
  for (let q = 0; q < 4; q++) {
    // Offset each quadrant from center so roads run between them
    const ox = (q % 2 ? 1 : -1) * 25;
    const oz = (q < 2 ? 1 : -1) * 25;
    for (let i = 0; i < 10; i++)
      for (let j = 0; j < 10; j++) {
        // Random width, depth, and height per building using seeded rng
        const w = 6 + rng() * 6,
          d = 6 + rng() * 6,
          h = 10 + rng() * 35;
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bldgMat);
        // Position building in a grid, shifting half-height up so base is at y=0
        b.position.set(ox + (i - 5) * 14, h / 2, oz + (j - 5) * 14);
        b.castShadow = b.receiveShadow = true;
        g.add(b);
      }
  }
  scene.add(g);
  return g;
}

function step3_cityMovement() {
  const { renderer, camera, look } = shared;
  let locked = false;

  renderer.domElement.addEventListener("click", () => {
    renderer.domElement.requestPointerLock();
  });

  document.addEventListener("pointerlockchange", () => {
    locked = document.pointerLockElement === renderer.domElement;
    renderer.domElement.style.cursor = locked ? "none" : "default";
  });

  // Mouse move drives either third-person yaw/pitch or free-orbit around city center
  document.addEventListener("mousemove", (e) => {
    if (!locked) return;
    if (flags.cameraFollow) {
      // Third-person mode: accumulate yaw/pitch from mouse delta
      look.yaw -= e.movementX * look.sensitivity;
      look.pitch -= e.movementY * look.sensitivity;
      const lim = Math.PI / 2 - 0.05;
      look.pitch = Math.max(0, Math.min(lim, look.pitch));
    } else {
      // Free-orbit mode: spherical coordinates around (0,0,0) for city preview
      shared.orbit.theta -= e.movementX * 0.003;
      shared.orbit.phi = Math.max(
        0.05,
        Math.min(Math.PI / 2 - 0.05, shared.orbit.phi - e.movementY * 0.003),
      );
      // Convert spherical (theta, phi, distance) to Cartesian camera position
      camera.position.x =
        shared.orbit.distance *
        Math.sin(shared.orbit.phi) *
        Math.sin(shared.orbit.theta);
      camera.position.y = shared.orbit.distance * Math.cos(shared.orbit.phi);
      camera.position.z =
        shared.orbit.distance *
        Math.sin(shared.orbit.phi) *
        Math.cos(shared.orbit.theta);
      camera.lookAt(0, 0, 0);
    }
  });

  // Scroll wheel zooms camera in/out — clamped to keep view reasonable
  renderer.domElement.addEventListener(
    "wheel",
    (e) => {
      if (!locked) return;
      if (flags.cameraFollow) {
        // Third-person: zoom distance relative to player (2–20 units)
        const next = shared.cameraDistance + e.deltaY * 0.01;
        shared.cameraDistance = Math.max(2, Math.min(20, next));
      } else {
        // Free-orbit: zoom distance relative to city center (5–200 units)
        shared.orbit.distance = Math.max(
          5,
          Math.min(200, shared.orbit.distance + e.deltaY * 0.05),
        );
      }
      e.preventDefault();
    },
    { passive: false },
  );
}

async function step4_player() {
  const { scene, renderer, camera } = shared;
  const fbxLoader = new FBXLoader();

  // Load Astronauta.fbx via promise wrapper for clean async/await
  const player = await new Promise((resolve, reject) => {
    fbxLoader.load("/assets/Astronauta.fbx", resolve, undefined, reject);
  });
  console.log("Astronaut loaded!", {
    animations: player.animations.map((clip) => ({
      name: clip.name,
      duration: clip.duration,
    })),
  });
  player.name = "Player";

  // Compute AABB of raw FBX, then uniform-scale so the player stands ~1.8m tall
  const box = new THREE.Box3().setFromObject(player);
  const size = box.getSize(new THREE.Vector3());
  const TARGET_HEIGHT = 1.8;
  if (size.y > 0.01) {
    player.scale.setScalar(TARGET_HEIGHT / size.y);
  }

  // Ground placement is measured after the initial native idle pose is applied.
  enableShadowsRecursive(player);

  // Walk all meshes: recolor pitch-black materials to skin tone, enable shadows
  player.traverse((c) => {
    if (c.isMesh && c.material) {
      (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => {
        // Pure black (0x000000) likely means missing texture — swap to a visible color
        if (m.color && m.color.getHex() === 0x000000) m.color.set(0xccbbaa);
      });
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });

  // Spawn at the terrain surface; step5 aligns the feet after posing the rig.
  player.position.set(0, shared.terrainGround?.heightAt(0, 0) ?? 0, 0);
  scene.add(player);
  shared.player = player;

  // Position camera looking at the player's chest for immediate feedback
  camera.position.set(3, 2.5, 5);
  camera.lookAt(player.position.x, player.position.y + 0.9, player.position.z);
  renderer.render(scene, camera);

  // Match stored yaw to camera angle so subsequent mouse input is seamless
  shared.look.yaw = Math.atan2(3, 5);

  return player;
}

async function step5_animations() {
  const animator = new AstronautAnimator(shared.player);
  animator.mixer.update(0);
  shared.playerFootOffset = measureFootOffset(shared.player);
  shared.playerState.groundY = shared.terrainGround?.heightAt(shared.player.position.x, shared.player.position.z) ?? 0;
  shared.player.position.y = shared.playerState.groundY + shared.playerFootOffset;
  shared.mixer = animator.mixer;
  shared.actions = animator.actions;
  shared.stateMachine = animator;

  // Every frame: feed player state into the state machine to pick current animation
  addPreviewFn((delta) => {
    const { mixer, actions, keyboard, playerState } = shared;
    if (!mixer || !actions) return;
    shared.stateMachine.update({
      // Only consider movement flags if movement step is enabled
      isMoving: flags.movement && _loopShared.move.lengthSq() > 0.0001,
      isSprinting: keyboard ? keyboard.sprint : false,
      isGrounded: playerState.grounded,
      hit: _loopShared.hit,
    });
    // Consume the swing flag so it only triggers once per press.
    _loopShared.hit = false;
    mixer.update(delta);
  }, 60);
}

function step6_gravity() {
  flags.gravity = true;
  // Run after horizontal movement and wall collision, before the camera.
  addPreviewFn((delta) => {
    const { player, playerState, terrainGround, playerFootOffset } = shared;
    if (!player || !flags.gravity) return;
    const groundY = terrainGround?.heightAt(player.position.x, player.position.z) ?? 0;
    advanceGroundedActor(player, playerState, playerFootOffset, groundY, delta);
  }, 30);
}

function step7_movement() {
  const intro = registerNarrationAudio(new Audio(`${import.meta.env.BASE_URL}assets/audio/Apollo%20Intro.mp3`));
  intro.preload = "auto";
  let introStarted = false;
  let introPending = false;

  function playIntroOnMovement(code, keys) {
    const movementKeys = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"];
    if (introStarted || introPending || !movementKeys.includes(code)) return;
    if (!shared.player || !flags.movement || _loopShared.cameraMode !== "third-person") return;
    if (document.pointerLockElement !== shared.renderer.domElement) return;
    const forward = Number(Boolean(keys.KeyW || keys.ArrowUp)) - Number(Boolean(keys.KeyS || keys.ArrowDown));
    const sideways = Number(Boolean(keys.KeyD || keys.ArrowRight)) - Number(Boolean(keys.KeyA || keys.ArrowLeft));
    if (!forward && !sideways) return;

    // Start in the key event so browser autoplay rules allow narration.
    introPending = true;
    intro.play().then(() => {
      introStarted = true;
      introPending = false;
    }).catch((error) => {
      introPending = false;
      // A blocked attempt may retry on the next movement key press.
      if (error.name !== "NotAllowedError") introStarted = true;
      console.warn("Apollo intro could not play:", error);
    });
  }

  // Captures held keys (continuous) + just-pressed keys (single-fire) + blur safety
  // Distinguishes held (keys map) from freshly pressed (justPressed Set) for jump/hit one-shots
  class KeyboardInput {
    constructor() {
      this.keys = {};
      this.justPressed = new Set();
      this._kd = (e) => {
        if (!this.keys[e.code]) this.justPressed.add(e.code);
        this.keys[e.code] = true;
        playIntroOnMovement(e.code, this.keys);
      };
      this._ku = (e) => {
        this.keys[e.code] = false;
      };
      this._bl = () => {
        for (const k in this.keys) this.keys[k] = false;
        this.justPressed.clear();
      };
      window.addEventListener("keydown", this._kd);
      window.addEventListener("keyup", this._ku);
      window.addEventListener("blur", this._bl);
    }
    // Returns true if key pressed since last check (one-shot like jump/hit)
    consumeJustPressed(c) {
      const h = this.justPressed.has(c);
      this.justPressed.delete(c);
      return h;
    }
    get forward() {
      return !!(this.keys["KeyW"] || this.keys["ArrowUp"]);
    }
    get backward() {
      return !!(this.keys["KeyS"] || this.keys["ArrowDown"]);
    }
    get left() {
      return !!(this.keys["KeyA"] || this.keys["ArrowLeft"]);
    }
    get right() {
      return !!(this.keys["KeyD"] || this.keys["ArrowRight"]);
    }
    get sprint() {
      return !!this.keys["ShiftLeft"] || !!this.keys["ShiftRight"];
    }
  }

  shared.keyboard = new KeyboardInput();
  flags.movement = true;

  // Every frame: read keys, compute camera-relative move vector, update position + rotation
  addPreviewFn((delta) => {
    const { player, keyboard, look, playerState } = shared;
    if (!player || !keyboard || !flags.movement) return;
    const LS = _loopShared;

    // One-shot actions: jump (Space), hit reaction (H), toggle free-cam (F)
    if (keyboard.consumeJustPressed("Space") && playerState.grounded) {
      playerState.velocity.y = 11;
      playerState.grounded = false;
    }
    if (keyboard.consumeJustPressed("KeyH")) {
      LS.hit = true;
    }
    if (keyboard.consumeJustPressed("KeyF")) {
      LS.cameraMode =
        LS.cameraMode === "third-person" ? "free" : "third-person";
    }

    // Build camera-relative direction vectors for movement
    LS.basisForward.set(-Math.sin(look.yaw), 0, -Math.cos(look.yaw));
    LS.basisRight.set(Math.cos(look.yaw), 0, -Math.sin(look.yaw));
    LS.move.set(0, 0, 0);
    if (keyboard.forward) LS.move.add(LS.basisForward);
    if (keyboard.backward) LS.move.sub(LS.basisForward);
    if (keyboard.right) LS.move.add(LS.basisRight);
    if (keyboard.left) LS.move.sub(LS.basisRight);
    // Apply movement if any direction is held
    if (LS.move.lengthSq() > 0.0001) {
      LS.move.normalize();
      const speed = keyboard.sprint ? 11 : 6;
      player.position.x += LS.move.x * speed * delta;
      player.position.z += LS.move.z * speed * delta;
      // Smoothly rotate player to face movement direction
      const targetYaw = Math.atan2(LS.move.x, LS.move.z);
      let deltaYaw = targetYaw - player.rotation.y;
      // Normalize delta to shortest arc (-PI to PI)
      while (deltaYaw > Math.PI) deltaYaw -= Math.PI * 2;
      while (deltaYaw < -Math.PI) deltaYaw += Math.PI * 2;
      player.rotation.y += THREE.MathUtils.clamp(
        deltaYaw,
        -14 * delta,
        14 * delta,
      );
    }
  }, 10);
}

function step8_cameraFollow() {
  flags.cameraFollow = true;

  const { renderer } = shared;
  // Show instructions overlay when pointer is unlocked
  const overlay = document.createElement("div");
  overlay.id = "click-to-play";
  overlay.innerHTML = `
    <div class="overlay-inner">
      <h1>Click to Play</h1>
      <p><strong>W A S D</strong> — move  <strong>Shift</strong> — sprint</p>
      <p><strong>Space</strong> — jump  <strong>H</strong> — mining swing</p>
      <p><strong>E</strong> — attack enemy  <strong>F</strong> — toggle free-fly camera</p>
      <p><strong>Mouse</strong> — look  <strong>Esc</strong> — release mouse</p>
    </div>`;
  document.body.appendChild(overlay);
  const animationPanel = document.createElement("div");
  animationPanel.id = "astronaut-animations";
  const label = document.createElement("label");
  label.htmlFor = "astronaut-animation";
  label.textContent = "Astronaut animation";
  const select = document.createElement("select");
  select.id = "astronaut-animation";
  select.add(new Option("Gameplay (automatic)", ""));
  for (const name of ASTRONAUT_CLIPS) {
    select.add(new Option(name, name));
  }
  const hint = document.createElement("p");
  hint.textContent = "Select a clip to preview. Click the scene to return to gameplay.";
  animationPanel.append(label, select, hint);
  document.body.appendChild(animationPanel);
  select.addEventListener("change", () => {
    shared.stateMachine.setPreview(select.value);
    overlay.classList.toggle("animation-preview", Boolean(select.value));
  });
  overlay.addEventListener("click", () => {
    shared.stateMachine.setPreview("");
    select.value = "";
    overlay.classList.remove("animation-preview");
    renderer.domElement.requestPointerLock();
  });
  // Show/hide overlay whenever pointer lock state changes
  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement === renderer.domElement) {
      overlay.style.display = "none";
      animationPanel.hidden = true;
    } else if (flags.cameraFollow) {
      overlay.style.display = "flex";
      animationPanel.hidden = false;
    }
  });

  // Every frame: position camera behind player with smooth exponential interpolation
  addPreviewFn((delta) => {
    const { player, camera, look, keyboard, renderer } = shared;
    const LS = _loopShared;
    if (!player || !flags.cameraFollow) return;

    if (LS.cameraMode === "third-person") {
      // Compute ideal camera position behind player based on yaw/pitch/distance
      const dist = shared.cameraDistance;
      const cx = Math.sin(look.yaw) * dist;
      const cz = Math.cos(look.yaw) * dist;
      LS.camPos.set(
        player.position.x + cx,
        player.position.y + 2.2 + Math.sin(look.pitch) * 1.5,
        player.position.z + cz,
      );
      // Look target is slightly above player's waist
      LS.camLook.set(
        player.position.x,
        player.position.y + 1.2,
        player.position.z,
      );
      // Initialize smooth position on first frame to avoid a hard snap
      if (!LS.smoothInited) {
        LS.smoothCamPos.copy(LS.camPos);
        LS.smoothCamLook.copy(LS.camLook);
        LS.smoothInited = true;
      }
      // Exponential ease (frame-rate independent lerp) for smooth camera movement
      const k = 1 - Math.exp(-14 * delta);
      LS.smoothCamPos.lerp(LS.camPos, k);
      const cameraGroundY = shared.terrainGround?.heightAt(LS.smoothCamPos.x, LS.smoothCamPos.z) ?? 0;
      LS.smoothCamPos.y = Math.max(cameraGroundY + 1, LS.smoothCamPos.y);
      LS.smoothCamLook.lerp(LS.camLook, k);
      camera.position.copy(LS.smoothCamPos);
      camera.lookAt(LS.smoothCamLook);
    } else if (
      // Free-fly camera mode: WASD moves the camera itself, no player following
      LS.cameraMode === "free" &&
      document.pointerLockElement === renderer?.domElement
    ) {
      const speed = (keyboard && keyboard.sprint ? 30 : 15) * delta;
      camera.getWorldDirection(LS.freeDir);
      LS.freeRight.crossVectors(LS.freeDir, camera.up).normalize();
      if (keyboard && keyboard.forward)
        camera.position.addScaledVector(LS.freeDir, speed);
      if (keyboard && keyboard.backward)
        camera.position.addScaledVector(LS.freeDir, -speed);
      if (keyboard && keyboard.left)
        camera.position.addScaledVector(LS.freeRight, -speed);
      if (keyboard && keyboard.right)
        camera.position.addScaledVector(LS.freeRight, speed);
      const cameraGroundY = shared.terrainGround?.heightAt(camera.position.x, camera.position.z) ?? 0;
      camera.position.y = Math.max(cameraGroundY + 1, camera.position.y);
    }
  }, 40);
}

function step9_collision() {
  const ray = new THREE.Raycaster();
  ray.far = 15;
  const _v = new THREE.Vector3();
  const _prev = new THREE.Vector3();
  const wallMeshes = [];
  shared.city?.traverse(node => {
    if (node.isMesh && !node.userData.walkableTerrain) wallMeshes.push(node);
  });

  // Compute city boundary once: uses City group AABB or falls back to ±100
  const _boundary = new THREE.Box2();
  (() => {
    let minX = -100,
      minZ = -100,
      maxX = 100,
      maxZ = 100;
    const city = shared.city;
    if (city) {
      const box = new THREE.Box3().setFromObject(city);
      if (isFinite(box.min.x)) {
        minX = Math.min(minX, box.min.x);
        minZ = Math.min(minZ, box.min.z);
        maxX = Math.max(maxX, box.max.x);
        maxZ = Math.max(maxZ, box.max.z);
      }
    }
    // Stay inside the actual terrain edge so characters cannot leave the hills.
    if (shared.terrainGround) {
      ({ min: { x: minX, z: minZ }, max: { x: maxX, z: maxZ } } = shared.terrainGround.bounds);
    }
    const pad = shared.terrainGround ? 0 : 2;
    _boundary.min.set(minX - pad, minZ - pad);
    _boundary.max.set(maxX + pad, maxZ + pad);
  })();

  // Every frame: raycast from previous position toward current, push back at walls, clamp bounds
  addPreviewFn(() => {
    const { player, scene } = shared;
    if (!player || !scene) return;

    const radius = 0.35;
    const prevPos = _loopShared.prevPlayerPos;

    // Cast ray from previous position toward current; push back if a wall is in the way
    if (prevPos) {
      _v.copy(player.position).sub(prevPos);
      _v.y = 0;
      const moveDist = _v.length();
      if (moveDist > 0.001) {
        const dir = _v.clone().normalize();
        _prev.set(prevPos.x, player.position.y, prevPos.z);
        ray.set(_prev, dir);
        const hits = ray.intersectObjects(wallMeshes, false);
        for (const hit of hits) {
          let o = hit.object;
          let exclude = false;
          // Walk up parent chain — skip player and enemy meshes
          while (o) {
            if (o === player || o.name === "Enemy") {
              exclude = true;
              break;
            }
            o = o.parent;
          }
          // Push player back so they stop at wall surface (accounting for player radius)
          if (!exclude && !hit.object.userData.walkableTerrain && hit.distance < moveDist + radius) {
            const allowed = Math.max(0, hit.distance - radius);
            player.position.x = prevPos.x + dir.x * allowed;
            player.position.z = prevPos.z + dir.z * allowed;
          }
        }
      }
    }

    // Final safety clamp: keep player inside city boundary (±100 with padding)
    const r = radius + 0.1;
    player.position.x = Math.max(
      _boundary.min.x + r,
      Math.min(_boundary.max.x - r, player.position.x),
    );
    player.position.z = Math.max(
      _boundary.min.y + r,
      Math.min(_boundary.max.y - r, player.position.z),
    );

    // Store current position as previous for next frame's collision ray
    _loopShared.prevPlayerPos = player.position.clone();
  }, 20);
}

async function step10_enemies() {
  const { scene } = shared;
  const ENEMY_COUNT = 15;
  const ENEMY_PATROL_RADIUS = 60;
  const ENEMY_PLAYER_DETECT = 12;

  // Pre-cache buildings as 2D bounding spheres for fast distance checks (no raycasts)
  const _buildingSpheres = [];

  // Traverse City group once and store each tall building as a center+radius sphere
  function cacheBuildingSpheres(scene) {
    if (_buildingSpheres.length > 0) return;
    scene.traverse((c) => {
      if (c.userData.walkableTerrain) return;
      if (c.isMesh && c.geometry && c.parent?.name !== "City") return;
      if (c.isMesh && c.geometry) {
        const box = new THREE.Box3().setFromObject(c);
        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        box.getCenter(center);
        box.getSize(size);
        if (size.y > 3) {
          _buildingSpheres.push({
            x: center.x,
            z: center.z,
            r: Math.max(size.x, size.z) * 0.6,
          });
        }
      }
    });
  }
  // Returns true if (x,z) is inside any building — used to stop enemies walking through walls
  function isNearBuilding(x, z) {
    for (let i = 0; i < _buildingSpheres.length; i++) {
      const b = _buildingSpheres[i];
      const dx = x - b.x;
      const dz = z - b.z;
      if (dx * dx + dz * dz < b.r * b.r) return true;
    }
    return false;
  }

  // One enemy NPC with waypoint patrol, walk animation, and player detection AI
  class EnemyNPC {
    // Set random personality: speed, idle duration, waypoints, look direction
    constructor(scene, basePos) {
      this.scene = scene;
      this.mesh = null;
      this.mixer = null;
      this.actions = {};
      this.position = basePos.clone();
      this.currentWaypoint = 0;
      this.state = "walk";
      this.idleTimer = 2 + Math.random() * 3;
      this.idleCountdown = Math.random() * 5;
      this.speed = 2.5 + Math.random() * 1.5;
      this.lookYaw = Math.random() * Math.PI * 2;
      this.health = 2 + Math.floor(Math.random() * 2); // 2-3 hits to kill
      this.dead = false;
      this._deathTimer = 0;
      this._hitFlash = 0;
      this._toTarget = new THREE.Vector3();
      this._dir = new THREE.Vector3();
      this._stuckFrames = 0;
      this._lastPos = new THREE.Vector3();
      this._skipCounter = Math.floor(Math.random() * 10);

      this.waypoints = this._generateWaypoints();
    }

    // Create 3-6 random waypoints around spawn, avoiding building interiors
    _generateWaypoints() {
      const pts = [];
      const count = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 10 + Math.random() * ENEMY_PATROL_RADIUS;
        const x = this.position.x + Math.cos(angle) * dist;
        const z = this.position.z + Math.sin(angle) * dist;
        // Only accept waypoint if it's not inside a building
        if (!isNearBuilding(x, z)) {
          pts.push(new THREE.Vector3(x, 0, z));
        } else {
          // Fallback: random point within 40 units of spawn
          pts.push(
            new THREE.Vector3(
              this.position.x + (Math.random() - 0.5) * 40,
              0,
              this.position.z + (Math.random() - 0.5) * 40,
            ),
          );
        }
      }
      const bounds = shared.terrainGround?.bounds;
      if (bounds) {
        for (const point of pts) {
          point.x = THREE.MathUtils.clamp(point.x, bounds.min.x + 0.5, bounds.max.x - 0.5);
          point.z = THREE.MathUtils.clamp(point.z, bounds.min.z + 0.5, bounds.max.z - 0.5);
          point.y = shared.terrainGround.heightAt(point.x, point.z);
        }
      }
      return pts;
    }

    // Load Enemy.fbx, scale to 1.7m, apply random color, load walk animation
    async load() {
      const loader = new FBXLoader();

      // Load model, scale uniformly to ~1.7m, shift up so feet rest on ground
      const model = await new Promise((res, rej) => {
        loader.load("/assets/Enemy.fbx", res, undefined, rej);
      });
      model.name = "Enemy";
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const TARGET = 1.7;
      if (size.y > 0.01) model.scale.setScalar(TARGET / size.y);
      box.setFromObject(model);
      this.footOffset = model.position.y - box.min.y;
      // Walk meshes: enable shadows, assign a random hue for visual variety
      model.traverse((c) => {
        if (c.isMesh) {
          c.castShadow = true;
          c.receiveShadow = true;
          if (c.material) {
            (Array.isArray(c.material) ? c.material : [c.material]).forEach(
              (m) => {
                if (m.color) {
                  const hue = Math.random();
                  m.color.setHSL(hue, 0.5, 0.4);
                  // Store hue on userData so hit-flash can restore the original color
                  c.userData._hue = hue;
                }
              },
            );
          }
        }
      });

      this.mesh = model;
      this.mesh.position.copy(this.position);
      this.snapToTerrain();
      this.scene.add(this.mesh);

      const mixer = new THREE.AnimationMixer(model);
      this.mixer = mixer;

      // Load walk animation (always present for patrolling enemies)
      try {
        const walkRoot = await new Promise((res, rej) => {
          loader.load("/assets/Enemy_Walk.fbx", res, undefined, rej);
        });
        if (walkRoot.animations && walkRoot.animations.length > 0) {
          const clip = walkRoot.animations[0];
          const a = mixer.clipAction(clip);
          a.setLoop(THREE.LoopRepeat, Infinity);
          a.enabled = true;
          a.setEffectiveWeight(0);
          a.play();
          this.actions.walk = a;
        }
      } catch (_) {}

      // Load death/fall animation (optional — silently skip if FBX is missing)
      try {
        const fallRoot = await new Promise((res, rej) => {
          loader.load("/assets/Enemy_Fall.fbx", res, undefined, rej);
        });
        if (fallRoot.animations && fallRoot.animations.length > 0) {
          const clip = fallRoot.animations[0];
          const a = mixer.clipAction(clip);
          // Fall plays once and holds last frame (ragdoll-like frozen pose)
          a.setLoop(THREE.LoopOnce, 1);
          a.clampWhenFinished = true;
          a.enabled = true;
          a.setEffectiveWeight(0);
          a.play();
          this.actions.fall = a;
        }
      } catch (_) {}

      this._setAnim("walk");
      mixer.update(0);
      this.footOffset = measureFootOffset(model);
      this.snapToTerrain();
    }

    // Crossfade animation weight to `name` (walk or idle)
    _setAnim(name) {
      if (this.animState === name) return;
      this.animState = name;
      for (const [k, a] of Object.entries(this.actions)) {
        a.setEffectiveWeight(k === name ? 1 : 0, 0.2);
      }
    }

    // Reduce health, flash red, push back, die when health reaches 0
    takeDamage(amount, attackerPos) {
      if (this.dead) return;
      this.health -= amount;
      // Flash all meshes red for 0.3 seconds as hit feedback
      this._hitFlash = 0.3;
      this.mesh.traverse((c) => {
        if (c.isMesh && c.material && c.material.color) {
          c.material.color.set(0xff3333);
        }
      });
      // Knockback: push enemy away from attacker for satisfying combat feel
      if (attackerPos && this.mesh) {
        const pushDir = new THREE.Vector3()
          .copy(this.mesh.position)
          .sub(attackerPos);
        pushDir.y = 0;
        const len = pushDir.length();
        if (len > 0.01) {
          pushDir.normalize().multiplyScalar(2.5);
          this.mesh.position.x += pushDir.x;
          this.mesh.position.z += pushDir.z;
          this._stayInBounds();
          this.snapToTerrain();
        }
      }
      if (this.health <= 0) {
        this.dead = true;
        this.state = "dead";
        // Switch to fall animation, then remove from scene after clip finishes
        this._setAnim("fall");
        const fallClip = this.actions.fall?.getClip();
        const dur = (fallClip?.duration || 0.6) + 0.2;
        this._deathTimer = dur;
      }
    }

    // Each frame: patrol waypoints, idle at stops, face player when near, avoid buildings
    update(delta, playerPos) {
      if (!this.mesh || !this.mixer) return;

      // If dead, count down then remove from scene completely
      if (this.dead) {
        this._deathTimer -= delta;
        this.mixer.update(delta);
        if (this._deathTimer <= 0 && this.mesh && this.mesh.parent) {
          this.scene.remove(this.mesh);
          this.mesh = null;
        }
        return;
      }

      // Gradually restore original material color after hit-flash duration expires
      if (this._hitFlash > 0) {
        this._hitFlash -= delta;
        if (this._hitFlash <= 0) {
          this.mesh.traverse((c) => {
            if (c.isMesh && c.material && c.material.color) {
              const hue = parseFloat(c.userData._hue) || 0;
              c.material.color.setHSL(hue, 0.5, 0.4);
            }
          });
        }
      }

      // Skip every 5 out of 6 frames for far-away enemies (performance optimization)
      this._skipCounter = (this._skipCounter + 1) % 6;
      const skipFrame = this._skipCounter !== 0;

      const dt = Math.min(delta, 0.1);
      const pos = this.mesh.position;

      // Compute distance to player for AI decision-making
      const toPlayer = this._toTarget.copy(playerPos).sub(pos);
      toPlayer.y = 0;
      const playerDist = toPlayer.length();

      // Far away + skip frame: only update animation mixer, skip AI logic
      if (skipFrame && playerDist > ENEMY_PLAYER_DETECT * 2) {
        this.mixer.update(dt);
        return;
      }

      this.idleCountdown -= dt;

      // IDLE state: stand still, face player if close, transition to walk
      if (this.state === "idle") {
        this._setAnim("walk");
        if (playerDist < ENEMY_PLAYER_DETECT) {
          // Smoothly rotate to face player
          const lookAngle = Math.atan2(toPlayer.x, toPlayer.z);
          let dy = lookAngle - this.lookYaw;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          this.lookYaw += THREE.MathUtils.clamp(dy, -6 * dt, 6 * dt);
          this.mesh.rotation.y = this.lookYaw;
        }
        if (this.idleCountdown <= 0) {
          this.state = "walk";
          this.currentWaypoint =
            (this.currentWaypoint + 1) % this.waypoints.length;
          this.idleCountdown = this.idleTimer;
        }
        this.mixer.update(dt);
        return;
      }

      // WALK state: move toward waypoint or toward player when detected
      if (this.state === "walk") {
        let dir;
        let speed = this.speed;

        // Player detected: move toward player at half speed
        if (playerDist < ENEMY_PLAYER_DETECT) {
          dir = this._dir.copy(toPlayer).normalize();
          speed = this.speed * 0.5;
        } else {
          // No player: follow waypoint patrol route
          const target = this.waypoints[this.currentWaypoint];
          this._toTarget.copy(target).sub(pos);
          this._toTarget.y = 0;
          const dist = this._toTarget.length();

          // Close enough to waypoint → switch to idle
          if (dist < 2) {
            this.state = "idle";
            this.idleCountdown = 1 + Math.random() * 3;
            this.mixer.update(dt);
            return;
          }
          dir = this._dir.copy(this._toTarget).normalize();
        }

        const prevX = pos.x;
        const prevZ = pos.z;
        pos.x += dir.x * speed * dt;
        pos.z += dir.z * speed * dt;

        // Keep minimum distance from player (don't overlap/push them)
        const toPlayerDist = Math.hypot(playerPos.x - pos.x, playerPos.z - pos.z);
        if (toPlayerDist < 1.5) {
          pos.x = prevX;
          pos.z = prevZ;
        }

        // If new position is inside a building, revert and try next waypoint
        if (isNearBuilding(pos.x, pos.z)) {
          pos.x = prevX;
          pos.z = prevZ;
          this._stuckFrames++;
          if (this._stuckFrames > 2) {
            this.currentWaypoint =
              (this.currentWaypoint + 1) % this.waypoints.length;
            this._stuckFrames = 0;
          }
        } else {
          this._stuckFrames = 0;
        }

        // Clamp position to world boundary
        this._stayInBounds();

        // Smoothly rotate to face movement direction
        const targetYaw = Math.atan2(dir.x, dir.z);
        let dy = targetYaw - this.lookYaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        this.lookYaw += THREE.MathUtils.clamp(dy, -8 * dt, 8 * dt);
        this.mesh.rotation.y = this.lookYaw;
      }

      this.mixer.update(dt);
    }

    snapToTerrain() {
      if (!this.mesh) return;
      const groundY = shared.terrainGround?.heightAt(this.mesh.position.x, this.mesh.position.z) ?? 0;
      this.mesh.position.y = groundY + this.footOffset;
    }

    // Keep enemies within the terrain's actual footprint.
    _stayInBounds() {
      const bounds = shared.terrainGround?.bounds;
      this.mesh.position.x = Math.max(
        (bounds?.min.x ?? -100) + 0.5,
        Math.min((bounds?.max.x ?? 100) - 0.5, this.mesh.position.x),
      );
      this.mesh.position.z = Math.max(
        (bounds?.min.z ?? -100) + 0.5,
        Math.min((bounds?.max.z ?? 100) - 0.5, this.mesh.position.z),
      );
    }
  }

  // Pre-cache building collision data for all enemies to share
  cacheBuildingSpheres(scene);
  const enemies = [];
  const spawnPoints = [];

  // Generate 15 random spawn points in a ring (5–55 units from center)
  for (let i = 0; i < ENEMY_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 5 + Math.random() * 50;
    spawnPoints.push(
      new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist),
    );
  }

  const loadPromises = spawnPoints.map(async (pos) => {
    const enemy = new EnemyNPC(scene, pos);
    try {
      await enemy.load();
      return enemy;
    } catch (e) {
      console.warn("[enemy] Failed to load:", e);
      return null;
    }
  });

  const results = await Promise.all(loadPromises);
  for (const e of results) {
    if (e) enemies.push(e);
  }

  shared.enemies = enemies;

  // Every frame: feed current player position to every enemy for AI behavior
  addPreviewFn((delta) => {
    const player = shared.player;
    const playerPos = player ? player.position : new THREE.Vector3(0, 0, 0);
    for (const e of enemies) {
      e.update(delta, playerPos);
      if (e.mesh) {
        e._stayInBounds();
        e.snapToTerrain();
      }
    }
  }, 50);
}

function step11_enemyCombat() {
  const ATTACK_RANGE = 3;
  const ATTACK_ANGLE = Math.PI / 3; // 60-degree cone in front of player
  const ATTACK_DAMAGE = 1;
  let _mouseClicked = false;

  // Listen for left-click on canvas
  const canvas = document.querySelector("#game-canvas");
  canvas.addEventListener("click", () => {
    if (document.pointerLockElement === canvas) _mouseClicked = true;
  });

  // Shared attack logic: find closest enemy in attack cone and damage it
  function doAttack() {
    const { player, enemies } = shared;
    if (!player || !enemies) return;
    // Trigger player's own hit animation as the attack swing
    _loopShared.hit = true;

    const playerPos = player.position;
    // Compute forward vector from player's current rotation
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(
      player.quaternion,
    );
    facing.y = 0;
    facing.normalize();

    let closest = null;
    let closestDist = ATTACK_RANGE;

    // Scan all living enemies within range and inside a 60° attack cone
    for (const e of enemies) {
      if (e.dead || !e.mesh) continue;
      const toEnemy = new THREE.Vector3().copy(e.mesh.position).sub(playerPos);
      toEnemy.y = 0;
      const dist = toEnemy.length();
      if (dist > ATTACK_RANGE) continue;
      const angle = facing.angleTo(toEnemy);
      if (angle > ATTACK_ANGLE) continue;
      // Track closest enemy within cone
      if (dist < closestDist) {
        closestDist = dist;
        closest = e;
      }
    }

    if (closest) {
      closest.takeDamage(ATTACK_DAMAGE, playerPos);
    }
  }

  // Every frame: check E key or left-click to trigger attack
  addPreviewFn(() => {
    const { keyboard } = shared;
    if (!keyboard) return;

    // E key fires one attack per press (uses justPressed to avoid holding)
    if (keyboard.consumeJustPressed("KeyE")) doAttack();

    // Left-click also attacks (consumed flag to prevent multi-fire)
    if (_mouseClicked) {
      _mouseClicked = false;
      doAttack();
    }
  }, 55);
}
async function main() {
  // step 1
  await step1_sceneSetup();
  startPreview();
  createOrangeBotOverlay().then((render) => addPreviewFn(render, 100))
    .catch((error) => console.error("OrangeBOT could not load:", error));
  // step 2
  await step2_city();

  // step 3
  await step3_cityMovement();

  // step 4
  await step4_player();

  // step 5
  await step5_animations();

  // step 6
  await step6_gravity();

  // step 7
  await step7_movement();

  // step 8
  await step8_cameraFollow();

  // step 9
  await step9_collision();

  // step 10
  await step10_enemies();

  // step 11
  await step11_enemyCombat();
}

main();
