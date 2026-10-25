import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { HOME_SHIP_TEXTURE_FILES, prepareHomeShip, disposeHomeShip } from "./home-ship-model.js";
import { createHomeShipFlight, homeShipWorldPoint, homeShipRouteClearsMenu } from "./home-ship-flight.js";

const textureUrls = {
  mainMat_diffuse: new URL("../assets/ship-textures/mainMat_diffuse.png", import.meta.url).href,
  mainMat_nrm: new URL("../assets/ship-textures/mainMat_nrm.png", import.meta.url).href,
  mainMat_metal: new URL("../assets/ship-textures/mainMat_metal.png", import.meta.url).href,
  mainMat_rough: new URL("../assets/ship-textures/mainMat_rough.png", import.meta.url).href,
  auxielieryMat_diffuse: new URL("../assets/ship-textures/auxielieryMat_diffuse.png", import.meta.url).href,
  auxielieryMat_nrm: new URL("../assets/ship-textures/auxielieryMat_nrm.png", import.meta.url).href,
  auxielieryMat_metal: new URL("../assets/ship-textures/auxielieryMat_metal.png", import.meta.url).href,
  auxielieryMat_rough: new URL("../assets/ship-textures/auxielieryMat_rough.png", import.meta.url).href,
};

export async function loadHomeShip() {
  const textureLoader = new THREE.TextureLoader();
  const entries = Object.entries(HOME_SHIP_TEXTURE_FILES).flatMap(([name, maps]) =>
    Object.entries(maps).map(([property, file]) => ({ name, property, url: textureUrls[file.replace(/\.png$/, "")] })));
  const results = await Promise.allSettled([
    new FBXLoader().loadAsync(new URL("../assets/jsf_RealTimeModel.fbx", import.meta.url).href),
    ...entries.map(entry => textureLoader.loadAsync(entry.url)),
  ]);
  if (results.some(result => result.status === "rejected")) {
    if (results[0].status === "fulfilled") disposeHomeShip(results[0].value);
    for (const result of results.slice(1)) if (result.status === "fulfilled") result.value.dispose();
    throw new Error("The title-screen spaceship or its supplied textures could not load.");
  }
  const sets = { main: {}, aux: {} };
  entries.forEach((entry, index) => { sets[entry.name][entry.property] = results[index + 1].value; });
  return prepareHomeShip(results[0].value, sets);
}

export function createHomeSpaceship(host, menuElement, {
  loadShip = loadHomeShip, createRenderer = options => new THREE.WebGLRenderer(options),
} = {}) {
  const page = host.ownerDocument;
  if (!page?.defaultView) return { setActive() {} };
  const view = page.defaultView;
  const reducedMotion = view.matchMedia("(prefers-reduced-motion: reduce)");
  let active = false, generation = 0, frame = null, previousTime = null;
  let renderer = null, scene = null, camera = null, ship = null, route = null, observer = null;
  let progress = 0, bank = 0, boundsSignature = "";
  const forward = new THREE.Vector3(1, 0, 0);
  const previous = new THREE.Vector3(), next = new THREE.Vector3(), tangent = new THREE.Vector3();
  const before = new THREE.Vector3(), after = new THREE.Vector3(), curvature = new THREE.Vector3();
  const rotation = new THREE.Quaternion(), roll = new THREE.Quaternion();

  function buildRoute(initial = true, preservePosition = false) {
    if (!ship) return;
    const currentPoint = preservePosition && route ? route.curve.getPointAt(progress) : null;
    if (currentPoint) {
      currentPoint.x *= view.innerWidth / route.width;
      currentPoint.y *= view.innerHeight / route.height;
    }
    const candidate = createHomeShipFlight({ width: view.innerWidth, height: view.innerHeight,
      menuBounds: menuElement.getBoundingClientRect(), radiusRatio: ship.userData.radiusRatio, initial });
    if (currentPoint) {
      const originalStart = candidate.curve.points[0].clone();
      candidate.curve.points[0].copy(currentPoint);
      candidate.curve.updateArcLengths();
      if (!homeShipRouteClearsMenu(candidate, menuElement.getBoundingClientRect())) {
        candidate.curve.points[0].copy(originalStart);
        candidate.curve.updateArcLengths();
      }
    }
    route = candidate;
    progress = 0;
    ship.scale.setScalar(route.shipWidth);
    updatePose(0, !preservePosition);
  }

  function updatePose(delta, immediate = false) {
    if (!ship || !route) return;
    homeShipWorldPoint(route, progress, camera.position.z, ship.position);
    homeShipWorldPoint(route, progress - 0.005, camera.position.z, previous);
    homeShipWorldPoint(route, progress + 0.005, camera.position.z, next);
    tangent.subVectors(next, previous).normalize();
    homeShipWorldPoint(route, progress - 0.02, camera.position.z, before);
    homeShipWorldPoint(route, progress + 0.02, camera.position.z, after);
    before.subVectors(ship.position, before).normalize();
    after.sub(ship.position).normalize();
    const targetBank = THREE.MathUtils.clamp(curvature.crossVectors(before, after).z * 8, -0.18, 0.18);
    bank = THREE.MathUtils.lerp(bank, targetBank, immediate ? 1 : 1 - Math.exp(-delta * 1.5));
    rotation.setFromUnitVectors(forward, tangent).multiply(roll.setFromAxisAngle(forward, bank));
    if (immediate) ship.quaternion.copy(rotation);
    else ship.quaternion.slerp(rotation, 1 - Math.exp(-delta * 3));
  }

  function resize() {
    if (!renderer || !camera) return;
    const width = Math.max(1, view.innerWidth), height = Math.max(1, view.innerHeight);
    const bounds = menuElement.getBoundingClientRect();
    const signature = [width, height, view.devicePixelRatio, bounds.left, bounds.top, bounds.right, bounds.bottom].join(":");
    if (boundsSignature === signature) return;
    boundsSignature = signature;
    renderer.setPixelRatio(Math.min(view.devicePixelRatio || 1, 1.25, Math.sqrt(2000000 / (width * height))));
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.position.z = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    camera.far = camera.position.z * 3;
    camera.updateProjectionMatrix();
    if (!route || route.width !== width || route.height !== height || !homeShipRouteClearsMenu(route, bounds)) {
      buildRoute(!route, Boolean(route));
    }
    if (ship && !page.hidden) renderer.render(scene, camera);
  }

  function tick(timestamp) {
    frame = null;
    if (!active || !ship || page.hidden || reducedMotion.matches) return;
    if (previousTime === null || timestamp - previousTime >= 1000 / 30) {
      const delta = previousTime === null ? 0 : (timestamp - previousTime) / 1000;
      previousTime = timestamp;
      progress += delta / route.duration;
      if (progress >= 1) buildRoute(false);
      updatePose(delta);
      renderer.render(scene, camera);
    }
    frame = view.requestAnimationFrame(tick);
  }

  function synchronize() {
    if (frame !== null) view.cancelAnimationFrame(frame);
    frame = null;
    previousTime = null;
    if (!active || !ship || page.hidden) return;
    if (reducedMotion.matches) renderer.render(scene, camera);
    else frame = view.requestAnimationFrame(tick);
  }

  function release() {
    synchronize();
    view.removeEventListener("resize", resize);
    page.removeEventListener("visibilitychange", synchronize);
    reducedMotion.removeEventListener("change", synchronize);
    observer?.disconnect();
    observer = null;
    if (ship) disposeHomeShip(ship);
    ship = route = null;
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    }
    renderer = scene = camera = null;
    boundsSignature = "";
  }

  async function start(token) {
    try {
      renderer = createRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.9;
      renderer.domElement.setAttribute("aria-hidden", "true");
      renderer.domElement.tabIndex = -1;
      host.appendChild(renderer.domElement);
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
      scene.add(new THREE.HemisphereLight(0xf7f5ff, 0x3e3548, 1.1));
      const key = new THREE.DirectionalLight(0xfffaf4, 2.4);
      key.position.set(-2, 4, 6);
      const fill = new THREE.DirectionalLight(0xffffff, 0.7);
      fill.position.set(4, -1, 3);
      const accent = new THREE.DirectionalLight(0xb99ae8, 0.45);
      accent.position.set(-3, 1, -2);
      scene.add(key, fill, accent);
      view.addEventListener("resize", resize);
      page.addEventListener("visibilitychange", synchronize);
      reducedMotion.addEventListener("change", synchronize);
      if (view.ResizeObserver) {
        observer = new view.ResizeObserver(resize);
        observer.observe(menuElement);
      }
      resize();
      const loadedShip = await loadShip();
      if (!active || token !== generation) { disposeHomeShip(loadedShip); return; }
      ship = loadedShip;
      const anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      ship.traverse(node => {
        if (!node.isMesh) return;
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          for (const value of Object.values(material)) if (value?.isTexture) value.anisotropy = anisotropy;
        }
      });
      scene.add(ship);
      buildRoute(true);
      if (!page.hidden) renderer.render(scene, camera);
      synchronize();
    } catch (error) {
      if (token !== generation) return;
      active = false;
      release();
      console.warn("[home ship] Decorative spaceship unavailable:", error);
    }
  }

  return {
    setActive(value) {
      if (active === value) return;
      active = value;
      const token = ++generation;
      if (active) start(token);
      else release();
    },
  };
}
