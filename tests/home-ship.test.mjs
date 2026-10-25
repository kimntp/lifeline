import assert from "node:assert/strict";
import fs from "node:fs";
import test, { after } from "node:test";
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { HOME_SHIP_TEXTURE_FILES, prepareHomeShip, disposeHomeShip } from "../src/home-ship-model.js";
import { createHomeShipFlight, homeShipWorldPoint } from "../src/home-ship-flight.js";

const bytes = fs.readFileSync(new URL("../assets/jsf_RealTimeModel.fbx", import.meta.url));
const model = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
const rawBounds = new THREE.Box3().setFromObject(model);
const maps = Object.fromEntries(Object.entries(HOME_SHIP_TEXTURE_FILES).map(([name, files]) => [name,
  Object.fromEntries(Object.entries(files).map(([property, file]) => {
    const texture = new THREE.Texture();
    texture.name = file;
    return [property, texture];
  })),
]));
const ship = prepareHomeShip(model, maps);
after(() => disposeHomeShip(ship));

test("real FBX retains both UV-mapped meshes, supplied PBR maps, and a corrected +Z nose", () => {
  const size = rawBounds.getSize(new THREE.Vector3());
  assert.ok(size.z > 524 && size.z < 525);
  assert.ok(size.x > 427 && size.x < 428);
  const names = [];
  ship.traverse(mesh => {
    if (!mesh.isMesh) return;
    names.push(mesh.name);
    assert.ok(mesh.geometry.index.count > mesh.geometry.attributes.position.count * 4);
    assert.equal(mesh.geometry.attributes.uv.count, mesh.geometry.attributes.position.count);
    assert.equal(mesh.material.isMeshStandardMaterial, true);
    for (const [property, filename] of Object.entries(HOME_SHIP_TEXTURE_FILES[mesh.name])) {
      assert.equal(mesh.material[property].name, filename);
      assert.equal(mesh.material[property].colorSpace, property === "map" ? THREE.SRGBColorSpace : THREE.NoColorSpace);
      const png = fs.readFileSync(new URL(`../assets/ship-textures/${filename}`, import.meta.url));
      assert.equal(png.subarray(1, 4).toString(), "PNG");
      assert.equal(png.readUInt32BE(16), mesh.name === "main" ? 2048 : 1024);
      assert.equal(png.readUInt32BE(20), mesh.name === "main" ? 2048 : 1024);
    }
    assert.equal(mesh.castShadow, false);
  });
  assert.deepEqual(names.sort(), ["aux", "main"]);
  ship.updateMatrixWorld(true);
  const nose = new THREE.Vector3(0, 0, 1).transformDirection(ship.getObjectByName("ship-axis-correction").matrixWorld);
  assert.ok(nose.x > 0.999);
  assert.ok(Math.abs(nose.y) < 0.001);
});

const viewports = [
  { width: 1920, height: 1080, left: 1430, bottom: 400 },
  { width: 1280, height: 720, left: 856, bottom: 380 },
  { width: 390, height: 844, left: 101, bottom: 300 },
  { width: 320, height: 568, left: 80, bottom: 280 },
  { width: 667, height: 375, left: 321, bottom: 330 },
];

for (const viewport of viewports) {
  test(`flight clears the padded menu and leaves the screen at ${viewport.width}x${viewport.height}`, () => {
    let seed = 91;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const menuBounds = { left: viewport.left, top: 16, right: viewport.width - 16, bottom: viewport.bottom };
    for (let pass = 0; pass < 16; pass++) {
      const route = createHomeShipFlight({ ...viewport, menuBounds, radiusRatio: ship.userData.radiusRatio,
        initial: pass === 0, random });
      assert.ok(route.duration >= 35 && route.duration <= 50);
      const beginning = route.curve.getPointAt(0);
      const ending = route.curve.getPointAt(1);
      if (pass === 0) {
        assert.ok(beginning.x > 0 && beginning.x < viewport.width / 2);
        assert.ok(beginning.y - route.radius > 0 && beginning.y + route.radius < viewport.height);
        if (viewport.width === 1920) assert.ok(route.shipWidth / viewport.width >= 0.12 && route.shipWidth / viewport.width <= 0.18);
      } else assert.ok(beginning.x + route.radius < 0);
      assert.ok(ending.x + route.radius < 0 || ending.x - route.radius > viewport.width);
      for (let step = 0; step <= 500; step++) {
        const point = route.curve.getPointAt(step / 500);
        const overlaps = point.x + route.radius > menuBounds.left - route.padding
          && point.x - route.radius < menuBounds.right + route.padding
          && point.y + route.radius > menuBounds.top - route.padding
          && point.y - route.radius < menuBounds.bottom + route.padding;
        assert.equal(overlaps, false, `Pass ${pass}, progress ${step / 500}`);
      }
    }
  });
}

test("arc-length sampling maintains calm speed and projected depth follows the intended screen path", () => {
  const route = createHomeShipFlight({ width: 1920, height: 1080,
    menuBounds: { left: 1430, top: 40, right: 1880, bottom: 400 }, radiusRatio: ship.userData.radiusRatio, random: () => 0.5 });
  const camera = new THREE.PerspectiveCamera(35, 1920 / 1080, 0.1, 10000);
  camera.position.z = 1080 / (2 * Math.tan(THREE.MathUtils.degToRad(17.5)));
  camera.updateMatrixWorld();
  const distances = [];
  let previousPoint = route.curve.getPointAt(0);
  for (let step = 1; step <= 400; step++) {
    const progress = step / 400;
    const point = route.curve.getPointAt(progress);
    distances.push(point.distanceTo(previousPoint));
    previousPoint = point;
    const projected = homeShipWorldPoint(route, progress, camera.position.z).project(camera);
    assert.ok(Math.abs((projected.x + 1) * 960 - point.x) < 0.0001);
    assert.ok(Math.abs((1 - projected.y) * 540 - point.y) < 0.0001);
  }
  assert.ok(Math.max(...distances) / Math.min(...distances) < 1.1);
});

test("owned ship geometry, materials, and shared textures are disposed exactly once", () => {
  const root = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture, roughnessMap: texture });
  root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  const counts = { geometry: 0, texture: 0, material: 0 };
  geometry.addEventListener("dispose", () => { counts.geometry++; });
  texture.addEventListener("dispose", () => { counts.texture++; });
  material.addEventListener("dispose", () => { counts.material++; });
  disposeHomeShip(root);
  assert.deepEqual(counts, { geometry: 1, texture: 1, material: 1 });
});
