import * as THREE from "three";
import { getBaseSpawn } from "./space-base.js";

export function createSampleStation() {
  const group = new THREE.Group();
  group.name = "BaseSampleStation";
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.08, 0.38),
    new THREE.MeshStandardMaterial({ color: 0x485866, metalness: 0.6, roughness: 0.4 }));
  tray.position.y = 0.04;
  group.add(tray);
  const samples = [];
  for (const [index, color] of [0x8b6242, 0xb54235, 0xcda64b].entries()) {
    const vial = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.28, 12),
      new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.2 }));
    vial.position.set((index - 1) * 0.25, 0.22, 0);
    group.add(vial); samples.push(vial);
  }
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.23, 40),
    new THREE.MeshBasicMaterial({ color: 0xa4e9ee, transparent: true, opacity: 0.65, side: THREE.DoubleSide }));
  marker.rotation.x = -Math.PI / 2;
  marker.scale.set(2.2, 0.8, 1);
  marker.position.y = 0.015;
  group.add(marker);
  return {
    group,
    target: new THREE.Vector3(),
    update(base, ground, mission) {
      const spawn = getBaseSpawn(base, ground);
      group.position.set(spawn.x - 1.2, spawn.y, spawn.z);
      this.target.copy(group.position);
      marker.visible = mission.phase === "return";
      for (const vial of samples) vial.visible = mission.completed;
    },
  };
}
