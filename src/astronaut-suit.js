import * as THREE from "three";

// Independent materials let cinematic guards use black suits without tinting
// the live astronaut or sharing mutable materials between cloned rigs.
export function applyAstronautSuit(root, color = "white") {
  const materials = [];
  root.traverse(node => {
    if (!node.isMesh) return;
    const lamp = /luz|luzes/i.test(node.name);
    const material = new THREE.MeshStandardMaterial({
      color: lamp ? 0x87d4e7 : color === "black" ? 0x111820 : 0xf0f2ef,
      roughness: lamp ? 0.3 : 0.72,
      metalness: lamp ? 0.25 : 0.15,
      emissive: lamp ? 0x458da3 : 0x000000,
      emissiveIntensity: lamp ? 0.6 : 0,
    });
    node.material = Array.isArray(node.material) ? node.material.map(() => material) : material;
    node.castShadow = node.receiveShadow = true;
    materials.push(material);
  });
  root.userData.suitColor = color;
  return materials;
}
