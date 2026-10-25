import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

export const HOME_SHIP_TEXTURE_FILES = {
  main: { map: "mainMat_diffuse.png", normalMap: "mainMat_nrm.png", metalnessMap: "mainMat_metal.png", roughnessMap: "mainMat_rough.png" },
  aux: { map: "auxielieryMat_diffuse.png", normalMap: "auxielieryMat_nrm.png", metalnessMap: "auxielieryMat_metal.png", roughnessMap: "auxielieryMat_rough.png" },
};

export function disposeHomeShip(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse(node => {
    if (!node.isMesh) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}

export function prepareHomeShip(model, textureSets) {
  const materials = new Map();
  for (const [name, maps] of Object.entries(textureSets)) {
    for (const [property, texture] of Object.entries(maps)) {
      texture.colorSpace = property === "map" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    }
    materials.set(name, new THREE.MeshStandardMaterial({ ...maps, metalness: 1, roughness: 1, name: `home-ship-${name}` }));
  }
  const originalMaterials = new Set();
  model.traverse(mesh => {
    if (!mesh.isMesh) return;
    const replace = material => {
      originalMaterials.add(material);
      return materials.get(/aux/i.test(material.name) ? "aux" : "main");
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(replace) : replace(mesh.material);
    const originalGeometry = mesh.geometry;
    mesh.geometry = mergeVertices(originalGeometry, 0.000001);
    originalGeometry.dispose();
    mesh.castShadow = mesh.receiveShadow = false;
  });
  for (const material of originalMaterials) {
    for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
    material.dispose();
  }
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const scale = 1 / Math.max(size.x, size.y, size.z);
  model.scale.multiplyScalar(scale);
  model.position.sub(bounds.getCenter(new THREE.Vector3())).multiplyScalar(scale);
  const axisCorrection = new THREE.Group();
  axisCorrection.name = "ship-axis-correction";
  axisCorrection.rotation.set(0.22, Math.PI / 2, 0);
  axisCorrection.add(model);
  const flight = new THREE.Group();
  flight.name = "home-spaceship";
  flight.add(axisCorrection);
  flight.updateMatrixWorld(true);
  const correctedBounds = new THREE.Box3().setFromObject(flight);
  flight.userData.radiusRatio = correctedBounds.getBoundingSphere(new THREE.Sphere()).radius / correctedBounds.getSize(new THREE.Vector3()).x;
  return flight;
}
