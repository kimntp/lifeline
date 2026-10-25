import { createMinimap } from "./minimap.js";
import { ICE_ASSETS, buildIceBase } from "./ice-base.js";
import { createPlayerVitals } from "./player-vitals.js";
import { createApolloNarrator } from "./apollo-narrator.js";
import * as THREE from "three"; // Core 3D engine
import { createOrangeBotOverlay } from "./orangebot-overlay.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"; // Load .glb city model
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { applyAstronautSuit } from "./astronaut-suit.js";
import { ASTRONAUT_CLIPS, AstronautAnimator } from "./astronaut-animations.js";
import { TerrainGround, advanceGroundedActor, measureFootOffset } from "./terrain-ground.js";
import { createTerrainSurround } from "./terrain-surround.js";
import { GameSession, createGameMenu } from "./game-menu.js";
import { placeSpaceBase, foundationHeightAt, getPlayerSpawn } from "./space-base.js";
import { resolveBaseCollision, resolvePlatformCollision } from "./base-collision.js";
import { buildGardenColony } from "./garden-colony.js";
import { createColonyInteraction } from "./colony-interaction.js";
import { createAlienLoader, prepareAlienModel } from "./alien-farmers.js";
import { GardenMission } from "./garden-mission.js";
import { createSampleStation } from "./sample-station.js";
import { createColonyInterference } from "./colony-interference.js";
import { IceEncounter, equipTaserBaton, equipMiningPick } from "./ice-encounter.js";
import { createIceInteraction } from "./ice-interaction.js";
import { createSurveyMontage } from "./survey-montage.js";
import { createIceAftermath } from "./ice-aftermath.js";
import { dialogueSession } from "./dialogue-session.js";

import { createPlayerInventory, equipShovel } from "./player-inventory.js";
import { LEVEL_LAYOUT } from "./level-layout.js";

const session = new GameSession();
// Mission progress resets on reload; level locations are fixed in source.
const gardenMission = new GardenMission();
let iceModelsPromise = null;
let apolloNarrator = null;
let placingIceBase = false;

const shared = {
  scene: null,
  renderer: null,
  camera: null,
  city: null,
  spaceBase: null,
  sampleStation: null,
  iceBase: null,
  iceEncounter: null,
  iceInteraction: null,
  baton: null,
  pickaxe: null,
  shovel: null,
  inventoryUI: null,
  surveyMontage: null,
  selectedTool: "none",
  batonRequested: false,
  interference: null,
  colony: null,
  colonyModels: null,
  colonyInteraction: null,
  terrainGround: null,
  playerFootOffset: 0,
  player: null,
  mixer: null,
  actions: null,
  keyboard: null,
  look: { yaw: 0, pitch: 0, sensitivity: 0.0022 },
  playerState: { velocity: new THREE.Vector3(), grounded: true, groundY: 0, health: 100, maxHealth: 100, oxygen: 100, maxOxygen: 100 },
  orbit: { theta: 0, phi: 0.4, distance: 50 },
  stateMachine: null,
  cameraDistance: 8,
};

const flags = {
  gravity: false,
  movement: false,
  cameraFollow: false,
  missionTransition: false,
};

function worldGroundHeight(x, z) {
  const terrain = shared.terrainGround?.heightAt(x, z) ?? 0;
  return foundationHeightAt(shared.spaceBase, x, z, Math.max(terrain, shared.colony?.heightAt(x, z) ?? terrain));
}

function updateWorldProgression() {
  if (shared.shovel) shared.shovel.visible = shared.selectedTool === "shovel";
  if (shared.baton) shared.baton.visible = gardenMission.completed && shared.selectedTool === "baton";
  if (shared.pickaxe) shared.pickaxe.visible = gardenMission.completed && shared.selectedTool === "pickaxe";
  if (shared.iceBase) shared.iceBase.group.visible = gardenMission.completed;
  if (shared.iceEncounter) shared.iceEncounter.group.visible = gardenMission.completed;
  shared.interference?.update({ completed: gardenMission.completed,
    active: !session.paused && !flags.missionTransition, position: shared.player?.position,
    colonyBounds: shared.colony?.bounds, baseBounds: shared.spaceBase?.userData.foundationBounds });
}

function atIceColony(position) {
  if (!gardenMission.completed || !shared.iceEncounter?.inArea(position)) return false;
  const ice = shared.iceBase.location, garden = shared.colony.site;
  return Math.hypot(position.x - ice.x, position.z - ice.z) < Math.hypot(position.x - garden.x, position.z - garden.z);
}

let updatePlayerVitals = null;
let minimap = null;
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
    if (shared.sampleStation) shared.sampleStation.update(shared.spaceBase, shared.terrainGround, gardenMission, shared.colony?.bounds);
    if (!session.paused && !flags.missionTransition && !shared.iceAftermath && !shared.surveyMontage) {
      for (const fn of _previewFns) fn(delta);
    } else if (!flags.missionTransition && session.screen === "animations" && shared.stateMachine?.preview) {
      // Only the selected preview animates; gameplay remains frozen.
      shared.mixer.update(delta);
    }

    shared.iceAftermath?.update(delta, !session.paused && !gameMenu.transitioning);
    shared.surveyMontage?.update(delta, !session.paused && !gameMenu.transitioning, shared.camera?.aspect);

    // Final render pass — draw everything to the canvas
    updateWorldProgression();
    shared.inventoryUI?.update({ visible: !session.paused && !flags.missionTransition && !shared.iceAftermath && !shared.surveyMontage && !dialogueSession.busy,
      selected: shared.selectedTool, combatUnlocked: gardenMission.completed });
    apolloNarrator?.setPaused(session.paused || flags.missionTransition || Boolean(shared.surveyMontage) || Boolean(shared.iceAftermath));
    apolloNarrator?.update();
    minimap?.update({
      player: shared.player?.position, yaw: shared.player?.rotation.y,
      base: shared.spaceBase?.userData.foundationBounds?.getCenter(new THREE.Vector3()) ?? LEVEL_LAYOUT.base,
      colony1: shared.colony?.site ?? LEVEL_LAYOUT.garden,
      colony2: shared.iceBase?.location ?? LEVEL_LAYOUT.ice,
      phase2: gardenMission.completed, returning: gardenMission.readyToReport && !gardenMission.completed,
    }, !session.paused && !flags.missionTransition && !shared.iceAftermath);
    updatePlayerVitals?.(!session.paused && !shared.surveyMontage && !shared.iceAftermath);
    shared.colonyInteraction?.setVisible(!session.paused && !gardenMission.completed);
    shared.iceInteraction?.setVisible(!session.paused && gardenMission.completed && !shared.iceAftermath && !shared.surveyMontage && !flags.missionTransition);
    const { scene, renderer, camera } = shared;
    if (scene && renderer && camera) {
      renderer.render(shared.surveyMontage?.scene ?? scene, shared.surveyMontage?.camera ?? camera);
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
  shared.interference = createColonyInterference(canvas);
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

async function loadSpaceBase() {
  const manager = new THREE.LoadingManager();
  const paletteLoader = new THREE.TextureLoader(manager);
  paletteLoader.load = function (url, onLoad, onProgress, onError) {
    if (!/multpaleta\.png$/i.test(url)) {
      return THREE.TextureLoader.prototype.load.call(this, url, onLoad, onProgress, onError);
    }
    // Avoid a missing-file request for the FBX's unavailable palette.
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    texture.needsUpdate = true;
    queueMicrotask(() => onLoad?.(texture));
    return texture;
  };
  manager.addHandler(/\.png$/i, paletteLoader);
  const base = await new FBXLoader(manager).loadAsync("/assets/Base.fbx");
  shared.spaceBase = placeSpaceBase(base, shared.terrainGround, LEVEL_LAYOUT.base);
  shared.scene.add(shared.spaceBase);
  shared.sampleStation = createSampleStation();
  shared.sampleStation.update(shared.spaceBase, shared.terrainGround, gardenMission, shared.colony?.bounds);
  shared.scene.add(shared.sampleStation.group);
}

function createSurveyInteraction(colony) {
  return createColonyInteraction(colony, {
    mission: gardenMission,
    getTool: () => shared.selectedTool,
    onSample: () => { _loopShared.hit = true; },
    onDeposit: depositSurveySamples,
    getBaseTarget: () => shared.sampleStation?.target,
    getFootOffset: () => shared.playerFootOffset,
  });
}

async function loadGardenColony() {
  const loader = new FBXLoader();
  const alienLoader = createAlienLoader();
  const [tomato, wheat, dome, gray, green] = await Promise.all([
    loader.loadAsync("/assets/Tomato%20Plant.fbx"),
    loader.loadAsync("/assets/Wheat%20Crop.fbx"),
    loader.loadAsync("/assets/hab_dome.fbx"),
    alienLoader.loadAsync("/assets/Alien_Low_Gray.fbx"),
    alienLoader.loadAsync("/assets/Alien_Low_Green.fbx"),
  ]);
  shared.colonyModels = { tomato, wheat, dome, aliens: { gray: prepareAlienModel(gray), green: prepareAlienModel(green) } };
  const options = { ...shared.colonyModels, ground: shared.terrainGround,
    baseBounds: new THREE.Box3().setFromObject(shared.spaceBase) };
  shared.colony = buildGardenColony({ ...options, location: LEVEL_LAYOUT.garden });
  shared.scene.add(shared.colony.group);
  shared.colonyInteraction = createSurveyInteraction(shared.colony);
  addPreviewFn(delta => shared.colony.update(delta), 51);
  addPreviewFn(delta => {
    if (shared.keyboard?.consumeJustPressed("Digit1")) selectPlayerTool("baton");
    if (shared.keyboard?.consumeJustPressed("Digit2")) selectPlayerTool("pickaxe");
    if (shared.keyboard?.consumeJustPressed("Digit3")) selectPlayerTool("shovel");
    if (shared.batonRequested) {
      shared.batonRequested = false;
      if (shared.selectedTool === "baton" && shared.player && atIceColony(shared.player.position)) shared.iceInteraction?.prepareStrike();
      if (!dialogueSession.busy && shared.player && shared.selectedTool === "shovel" && !gardenMission.completed) {
        shared.colonyInteraction.dig(shared.player);
      }
      if (!dialogueSession.busy && shared.player && gardenMission.completed && shared.selectedTool !== "shovel") {
        _loopShared.hit = true;
        const forward = new THREE.Vector3(-Math.sin(shared.look.yaw), 0, -Math.cos(shared.look.yaw));
        shared.player.rotation.y = Math.atan2(forward.x, forward.z);
        if (shared.selectedTool === "pickaxe") shared.iceEncounter?.mine(shared.player.position, forward, "pickaxe");
        else shared.iceEncounter?.strike(shared.player.position, forward);
      }
    }
    if (gardenMission.completed && shared.player) shared.iceEncounter?.update(delta, shared.player, shared.playerState);
  }, 50);
  addPreviewFn(updateColonyInteraction, 52);
}

function updateColonyInteraction(delta) {
  if (!shared.player) return;
  if (gardenMission.completed && shared.iceInteraction) {
    shared.colonyInteraction.leave();
    shared.iceInteraction.update(shared.player, shared.keyboard, delta);
    if (shared.iceEncounter.phase === "complete" && !shared.iceEncounter.aftermathPlayed) void playIceAftermath();
  } else {
    shared.iceInteraction?.leave();
    shared.colonyInteraction.update(shared.player, shared.keyboard, shared.look.yaw, delta);
  }
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

  document.addEventListener("pointerlockchange", () => {
    locked = document.pointerLockElement === renderer.domElement;
    renderer.domElement.style.cursor = locked ? "none" : "default";
  });

  // Mouse move drives either third-person yaw/pitch or free-orbit around city center
  document.addEventListener("mousemove", (e) => {
    if (!locked || session.paused || flags.missionTransition) return;
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
      if (!locked || session.paused || flags.missionTransition) return;
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

  applyAstronautSuit(player, "white");

  const spawn = getPlayerSpawn(shared.spaceBase, shared.terrainGround, LEVEL_LAYOUT.spawn);
  player.position.copy(spawn.position);
  player.rotation.y = spawn.yaw;
  scene.add(player);
  shared.player = player;

  // Position camera looking at the player's chest for immediate feedback
  camera.position.set(player.position.x + Math.sin(spawn.cameraYaw) * shared.cameraDistance,
    player.position.y + 2.5, player.position.z + Math.cos(spawn.cameraYaw) * shared.cameraDistance);
  camera.lookAt(player.position.x, player.position.y + 0.9, player.position.z);
  renderer.render(scene, camera);

  // Match stored yaw to camera angle so subsequent mouse input is seamless
  shared.look.yaw = spawn.cameraYaw;

  return player;
}

async function step5_animations() {
  const animator = new AstronautAnimator(shared.player);
  animator.mixer.update(0);
  shared.playerFootOffset = measureFootOffset(shared.player);
  shared.playerState.groundY = worldGroundHeight(shared.player.position.x, shared.player.position.z);
  shared.player.position.y = shared.playerState.groundY + shared.playerFootOffset;
  shared.mixer = animator.mixer;
  shared.actions = animator.actions;
  shared.stateMachine = animator;
  shared.baton = equipTaserBaton(shared.player);
  shared.baton.visible = false;
  shared.pickaxe = equipMiningPick(shared.player, true);
  shared.pickaxe.visible = false;
  shared.shovel = equipShovel(shared.player);
  shared.inventoryUI = createPlayerInventory(selectPlayerTool);

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
    const { player, playerState, playerFootOffset } = shared;
    if (!player || !flags.gravity) return;
    const groundY = worldGroundHeight(player.position.x, player.position.z);
    let support = shared.terrainGround;
    const platforms = [shared.spaceBase?.userData.foundationBounds,
      ...(shared.colony?.plots.map(plot => plot.bounds) ?? [])];
    for (const bounds of platforms) {
      if (bounds && player.position.x >= bounds.min.x && player.position.x <= bounds.max.x
        && player.position.z >= bounds.min.z && player.position.z <= bounds.max.z
        && Math.abs(groundY - bounds.max.y) < 1e-4) support = bounds;
    }
    advanceGroundedActor(player, playerState, playerFootOffset, groundY, delta,
      { snapDown: playerState.support === support });
    playerState.support = support;
  }, 30);
}

function step7_movement() {
  function playIntroOnMovement(code, keys) {
    const movementKeys = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"];
    if (!movementKeys.includes(code) || !shared.player || !flags.movement || _loopShared.cameraMode !== "third-person") return;
    if (document.pointerLockElement !== shared.renderer.domElement) return;
    const forward = Number(Boolean(keys.KeyW || keys.ArrowUp)) - Number(Boolean(keys.KeyS || keys.ArrowDown));
    const sideways = Number(Boolean(keys.KeyD || keys.ArrowRight)) - Number(Boolean(keys.KeyA || keys.ArrowLeft));
    if (forward || sideways) apolloNarrator?.startIntro();
  }

  // Captures held keys (continuous) + just-pressed keys (single-fire) + blur safety
  // Distinguishes held (keys map) from freshly pressed (justPressed Set) for jump/hit one-shots
  class KeyboardInput {
    constructor() {
      this.keys = {};
      this.justPressed = new Set();
      this._kd = (e) => {
        if (session.paused || flags.missionTransition) return;
        if (["Enter", "NumpadEnter"].includes(e.code)) {
          e.preventDefault();
          if (!e.repeat && !apolloNarrator?.handleSkip()) shared.colonyInteraction?.handleSkip();
          return;
        }
        if (e.code === "KeyE" && e.repeat) return;
        if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
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
  shared.renderer.domElement.addEventListener("click", () => {
    if (!session.paused && !flags.missionTransition && document.pointerLockElement === shared.renderer.domElement) shared.batonRequested = true;
  });
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
      const cameraGroundY = worldGroundHeight(LS.smoothCamPos.x, LS.smoothCamPos.z);
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
      const cameraGroundY = worldGroundHeight(camera.position.x, camera.position.z);
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
  // Block only the building; the surrounding foundation is a walkable floor.
  const baseBounds = shared.spaceBase?.userData.buildingBounds ?? null;

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
          // Push player back so they stop at wall surface (accounting for player radius)
          if (!hit.object.userData.walkableTerrain && hit.distance < moveDist + radius) {
            const allowed = Math.max(0, hit.distance - radius);
            player.position.x = prevPos.x + dir.x * allowed;
            player.position.z = prevPos.z + dir.z * allowed;
          }
        }
      }
    }

    if (baseBounds) resolveBaseCollision(player.position, prevPos ?? player.position, baseBounds, radius);
    if (shared.colony) resolveBaseCollision(player.position, prevPos ?? player.position, shared.colony.domeBounds, radius);
    if (gardenMission.completed && shared.colony) {
      resolveBaseCollision(player.position, prevPos ?? player.position, shared.colony.bounds.clone().expandByScalar(1.5), radius);
    }
    if (shared.sampleStation) resolveBaseCollision(player.position, prevPos ?? player.position, shared.sampleStation.bounds, radius);
    for (const bounds of gardenMission.completed ? shared.iceBase?.obstacles ?? [] : []) {
      resolveBaseCollision(player.position, prevPos ?? player.position, bounds, radius);
    }
    const platforms = [shared.spaceBase?.userData.foundationBounds,
      ...(shared.colony?.plots.map(plot => plot.bounds) ?? [])];
    for (const bounds of platforms) {
      if (bounds) resolvePlatformCollision(player.position, prevPos ?? player.position, bounds, shared.playerFootOffset, radius);
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

async function main() {
  // step 1
  await step1_sceneSetup();
  updatePlayerVitals = createPlayerVitals(shared.playerState);
  minimap = createMinimap();
  apolloNarrator = createApolloNarrator();
  startPreview();
  createOrangeBotOverlay().then((render) => addPreviewFn(render, 100))
    .catch((error) => console.error("OrangeBOT could not load:", error));
  // step 2
  await step2_city();
  await loadSpaceBase();
  await loadGardenColony();
  await placeIceBase(LEVEL_LAYOUT.ice);

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

  // Place the camera and characters once before the first playable frame.
  for (const fn of _previewFns) fn(0);
  session.ready = true;
  gameMenu.status("");
  gameMenu.render();
}

function clearGameInput() {
  if (shared.keyboard) shared.keyboard._bl();
  _loopShared.move.set(0, 0, 0);
  _loopShared.hit = false;
  shared.batonRequested = false;
}

function pauseGame() {
  gameMenu.cancelTransition();
  session.pause();
  shared.colonyInteraction?.setVisible(false);
  apolloNarrator?.setPaused(true);
  clearGameInput();
  if (document.pointerLockElement) document.exitPointerLock();
  gameMenu.render();
}

function requestPlay() {
  if (!session.ready || !shared.renderer || gameMenu.transitioning || flags.missionTransition) return;
  clearGameInput();
  gameMenu.status("");
  try {
    const request = shared.renderer.domElement.requestPointerLock();
    request?.catch(() => gameMenu.failStart("Mouse capture was declined. Click Start or Resume to try again."));
  } catch {
    gameMenu.failStart("Mouse capture is unavailable. Click Start or Resume to try again.");
  }
}

function navigateMenu(target) {
  if (shared.stateMachine?.preview) shared.stateMachine.setPreview("");
  clearGameInput();
  shared.colonyInteraction?.setVisible(false);
  apolloNarrator?.setPaused(true);
  if (target === "home") session.home();
  else if (target === "back") session.back();
  else session.open(target);
  gameMenu.render();
}

async function placeIceBase(location) {
  if (!iceModelsPromise) {
    const loader = new FBXLoader();
    iceModelsPromise = Promise.all(ICE_ASSETS.map(async name => [name,
      await loader.loadAsync(`${import.meta.env.BASE_URL}assets/${name}.fbx`)]))
      .then(entries => Object.fromEntries(entries))
      .catch(error => { iceModelsPromise = null; throw error; });
  }
  const models = await iceModelsPromise;
  const next = buildIceBase({ models, ground: shared.terrainGround, location,
    blockedBounds: [shared.spaceBase && new THREE.Box3().setFromObject(shared.spaceBase), shared.colony?.bounds] });
  if (shared.iceBase) shared.scene.remove(shared.iceBase.group);
  next.group.visible = gardenMission.completed;
  shared.scene.add(next.group);
  shared.iceBase = next;
  gardenMission.waterLocation = { ...next.location };
  if (shared.colonyModels?.aliens.gray) {
    shared.iceInteraction?.destroy();
    if (shared.iceEncounter) { shared.scene.remove(shared.iceEncounter.group); shared.iceEncounter.dispose(); }
    shared.iceEncounter = new IceEncounter({ source: shared.colonyModels.aliens.gray, ground: shared.terrainGround,
      iceBase: next, onPlayerDown: recoverPlayerAtBase });
    shared.iceEncounter.group.visible = gardenMission.completed;
    shared.scene.add(shared.iceEncounter.group);
    shared.iceInteraction = createIceInteraction(shared.iceEncounter, { onComplete: playIceAftermath, getTool: () => shared.selectedTool });
  }
}

async function recoverPlayerAtBase() {
  if (session.paused || flags.missionTransition || gameMenu.transitioning) return;
  flags.missionTransition = true;
  clearGameInput();
  try {
    await gameMenu.transitionToGame(() => {
      const spawn = getPlayerSpawn(shared.spaceBase, shared.terrainGround, LEVEL_LAYOUT.spawn);
      shared.player.position.copy(spawn.position);
      shared.player.position.y += shared.playerFootOffset;
      shared.playerState.health = shared.playerState.maxHealth;
      shared.playerState.velocity.set(0, 0, 0);
      shared.playerState.grounded = true;
      shared.playerState.support = shared.spaceBase.userData.foundationBounds;
      shared.look.yaw = 0;
      _loopShared.cameraMode = "third-person";
      _loopShared.smoothInited = false;
      _loopShared.prevPlayerPos = shared.player.position.clone();
      shared.camera.position.set(shared.player.position.x, shared.player.position.y + 2.2, shared.player.position.z + shared.cameraDistance);
      shared.camera.lookAt(shared.player.position.x, shared.player.position.y + 1.2, shared.player.position.z);
      shared.iceInteraction?.leave();
      shared.iceInteraction?.setVisible(false);
    });
  } catch (error) { console.error("[recovery] Could not recover at base:", error); }
  finally { flags.missionTransition = false; clearGameInput(); }
}

function selectPlayerTool(tool) {
  if (dialogueSession.busy || flags.missionTransition || shared.iceAftermath || !["baton", "pickaxe", "shovel"].includes(tool)) return;
  if (tool !== "shovel" && !gardenMission.completed) return;
  shared.selectedTool = tool;
  if (shared.baton) shared.baton.visible = tool === "baton";
  if (shared.pickaxe) shared.pickaxe.visible = tool === "pickaxe";
  if (shared.shovel) shared.shovel.visible = tool === "shovel";
}

async function playIceAftermath() {
  if (shared.iceAftermath || flags.missionTransition || gameMenu.transitioning || shared.iceEncounter?.aftermathPlayed || !shared.iceEncounter?.lastAlien) return;
  flags.missionTransition = true;
  clearGameInput();
  shared.iceInteraction.leave();
  const cameraPosition = shared.camera.position.clone(), cameraRotation = shared.camera.quaternion.clone();
  const playerVisible = shared.player.visible;
  try {
    await gameMenu.transitionToGame(() => {
      shared.player.visible = false;
      shared.iceAftermath = createIceAftermath({ alien: shared.iceEncounter.lastAlien, player: shared.player, scene: shared.scene, camera: shared.camera,
        obstacles: shared.iceBase.obstacles,
        ground: shared.terrainGround, occluders: shared.iceEncounter.occluders, channel: dialogueSession,
        onDirectContact: () => {
          shared.iceEncounter.directContact = true;
          shared.iceEncounter.message = "Direct contact: The company exports the colonies' crops and water to Earth and forces their people to work. The alien is asking for help.";
        },
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches });
      shared.iceEncounter.aftermathPlayed = true;
    });
    flags.missionTransition = false;
    if (shared.iceAftermath) await shared.iceAftermath.finished;
    flags.missionTransition = true;
    await gameMenu.transitionToGame(() => {
      shared.iceAftermath?.dispose(); shared.iceAftermath = null;
      shared.player.visible = playerVisible;
      shared.camera.position.copy(cameraPosition); shared.camera.quaternion.copy(cameraRotation);
    });
  } catch (error) { console.error("[ice] Alien scene failed:", error); }
  finally {
    shared.iceAftermath?.dispose(); shared.iceAftermath = null;
    shared.player.visible = playerVisible;
    shared.camera.position.copy(cameraPosition); shared.camera.quaternion.copy(cameraRotation);
    _loopShared.smoothInited = false;
    clearGameInput(); flags.missionTransition = false;
  }
}

async function depositSurveySamples() {
  if (session.paused || flags.missionTransition || gameMenu.transitioning || !gardenMission.beginDeposit()) return;
  flags.missionTransition = true;
  clearGameInput();
  try {
    await gameMenu.transitionToGame(() => {
      const spawn = getPlayerSpawn(shared.spaceBase, shared.terrainGround, LEVEL_LAYOUT.spawn);
      shared.player.position.copy(spawn.position);
      shared.player.position.y += shared.playerFootOffset;
      shared.player.rotation.y = spawn.yaw;
      shared.playerState.velocity.set(0, 0, 0);
      shared.playerState.grounded = true;
      shared.playerState.groundY = spawn.position.y;
      shared.playerState.support = shared.spaceBase.userData.foundationBounds;
      shared.look.yaw = spawn.cameraYaw;
      shared.look.pitch = 0;
      _loopShared.cameraMode = "third-person";
      _loopShared.smoothInited = false;
      _loopShared.prevPlayerPos = shared.player.position.clone();
      shared.stateMachine.setPreview("");
      shared.mixer.update(0);
      shared.camera.position.set(shared.player.position.x, shared.player.position.y + 2.2,
        shared.player.position.z + shared.cameraDistance);
      shared.camera.lookAt(shared.player.position.x, shared.player.position.y + 1.2, shared.player.position.z);
      gardenMission.finishDeposit();
      shared.selectedTool = "baton";
      if (shared.shovel) shared.shovel.visible = false;
      if (shared.baton) shared.baton.visible = true;
      shared.sampleStation.update(shared.spaceBase, shared.terrainGround, gardenMission, shared.colony?.bounds);
      shared.colonyInteraction.update(shared.player, shared.keyboard, shared.look.yaw);
      shared.colonyInteraction.leave();
      apolloNarrator?.setPaused(true);
      shared.surveyMontage = createSurveyMontage({ player: shared.player,
        alienModels: shared.colonyModels.aliens, cropModel: shared.colonyModels.wheat,
        tomatoModel: shared.colonyModels.tomato, domeModel: shared.colonyModels.dome,
        aspect: shared.camera.aspect, reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches });
      document.body.classList.add("survey-cinematic");
    });
    flags.missionTransition = false;
    if (shared.surveyMontage) {
      await shared.surveyMontage.finished;
      flags.missionTransition = true;
      await gameMenu.transitionToGame(() => {
        shared.surveyMontage.dispose(); shared.surveyMontage = null;
        document.body.classList.remove("survey-cinematic");
      });
    }
  } catch (error) {
    console.error("[survey] Sample deposit transition failed:", error);
  } finally {
    shared.surveyMontage?.dispose(); shared.surveyMontage = null;
    document.body.classList.remove("survey-cinematic");
    if (gardenMission.depositing) gardenMission.cancelDeposit();
    shared.colonyInteraction.refresh();
    flags.missionTransition = false;
    clearGameInput();
  }
}

const gameMenu = createGameMenu({
  session,
  clips: ASTRONAUT_CLIPS,
  onPlay: requestPlay,
  onPause: pauseGame,
  onNavigate: navigateMenu,
  onPreview: name => shared.stateMachine?.setPreview(name),
});
gameMenu.render({ focus: false });

document.addEventListener("pointerlockchange", () => {
  if (shared.renderer && document.pointerLockElement === shared.renderer.domElement) {
    if (shared.stateMachine?.preview) shared.stateMachine.setPreview("");
    clearGameInput();
    const startGame = () => {
      if (!session.play()) throw new Error("The world is not ready to start.");
      gameMenu.render();
      shared.renderer.domElement.focus();
    };
    if (session.screen === "home") {
      gameMenu.transitionToGame(startGame).catch(error => {
        console.error("[menu] Screen transition failed:", error);
        if (document.pointerLockElement) document.exitPointerLock();
        gameMenu.status("Could not start the transition. Click Start to try again.");
      });
      return;
    }
    startGame();
  } else {
    gameMenu.cancelTransition();
    session.pause();
    shared.colonyInteraction?.setVisible(false);
    apolloNarrator?.setPaused(true);
    clearGameInput();
  }
  gameMenu.render();
});
document.addEventListener("pointerlockerror", () => {
  gameMenu.cancelTransition();
  session.pause();
  shared.colonyInteraction?.setVisible(false);
  apolloNarrator?.setPaused(true);
  gameMenu.render();
  gameMenu.status("Mouse capture was declined. Click Start or Resume to try again.");
});
window.addEventListener("keydown", event => {
  if (event.code === "KeyM" && !event.repeat && !["SELECT", "INPUT", "TEXTAREA"].includes(event.target.tagName)) {
    gameMenu.toggleMute();
    return;
  }
  if (event.code !== "KeyP" || event.repeat || ["SELECT", "INPUT", "TEXTAREA"].includes(event.target.tagName)) return;
  if (!session.paused) pauseGame();
  else if (session.screen === "paused") requestPlay();
});
window.addEventListener("blur", () => {
  if (!session.paused) pauseGame();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && !session.paused) pauseGame();
});

main().catch(error => {
  console.error("[game] Failed to initialize:", error);
  gameMenu.failStart("The world could not load. Refresh to try again.");
});
