import * as THREE from "three";

export function createSampleStation() {
  const group = new THREE.Group();
  group.name = "BaseSampleStation";
  const metal = new THREE.MeshStandardMaterial({ color: 0x485866, metalness: 0.6, roughness: 0.4 });
  const tabletop = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.09, 0.85), metal);
  tabletop.name = "SampleStationTable";
  tabletop.position.y = 1;
  group.add(tabletop);
  const legs = [];
  for (const x of [-0.65, 0.65]) for (const z of [-0.3, 0.3]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 8), metal);
    leg.position.set(x, 0.5, z); group.add(leg); legs.push(leg);
  }
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.65, 20),
    new THREE.MeshStandardMaterial({ color: 0x72c6d0, transparent: true, opacity: 0.38, roughness: 0.15, metalness: 0.15 }));
  tube.name = "SampleIntakeTube";
  tube.position.set(-0.35, 1.37, 0); group.add(tube);
  for (const y of [1.065, 1.7]) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 20), metal);
    cap.position.set(-0.35, y, 0); group.add(cap);
  }
  const samples = [];
  for (const [index, color] of [0x8b6242, 0xb54235, 0xcda64b].entries()) {
    const vial = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.25, 12),
      new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.2 }));
    vial.name = `SampleContainer_${["soil", "tomato", "wheat"][index]}`;
    vial.position.set(0.12 + index * 0.24, 1.17, 0.12);
    group.add(vial); samples.push(vial);
  }
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.23, 40),
    new THREE.MeshBasicMaterial({ color: 0xa4e9ee, transparent: true, opacity: 0.65, side: THREE.DoubleSide }));
  marker.name = "SampleStationMarker";
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 1.055;
  marker.position.x = -0.35;
  group.add(marker);
  let placementKey = "";
  return {
    group, target: new THREE.Vector3(), bounds: new THREE.Box3(),
    update(base, ground, mission, colonyBounds = null) {
      const footprint = base.userData.foundationBounds;
      const key = `${footprint.min.x},${footprint.max.x},${footprint.min.z},${footprint.max.z},${colonyBounds?.min.x},${colonyBounds?.min.z}`;
      if (key !== placementKey) {
        const cx = (footprint.min.x + footprint.max.x) / 2, cz = (footprint.min.z + footprint.max.z) / 2;
        const candidates = [new THREE.Vector3(cx, 0, footprint.max.z + 1.8), new THREE.Vector3(footprint.max.x + 1.8, 0, cz),
          new THREE.Vector3(footprint.min.x - 1.8, 0, cz), new THREE.Vector3(cx, 0, footprint.min.z - 1.8)];
        const point = candidates.find(p => {
          const b = ground?.bounds;
          if (b && (p.x - 1 < b.min.x || p.x + 1 > b.max.x || p.z - 0.6 < b.min.z || p.z + 0.6 > b.max.z)) return false;
          return !colonyBounds || p.x + 1 <= colonyBounds.min.x - 1.5 || p.x - 1 >= colonyBounds.max.x + 1.5
            || p.z + 0.6 <= colonyBounds.min.z - 1.5 || p.z - 0.6 >= colonyBounds.max.z + 1.5;
        });
        if (!point) throw new Error("No clear ground is available beside the base for the sample station");
        point.y = ground?.heightAt(point.x, point.z) ?? 0;
        group.position.copy(point);
        this.target.copy(point);
        for (const leg of legs) {
          const floor = (ground?.heightAt(point.x + leg.position.x, point.z + leg.position.z) ?? 0) - point.y;
          const top = 0.955;
          leg.scale.y = Math.max(0.1, top - floor + 0.03);
          leg.position.y = (top + floor - 0.03) / 2;
        }
        group.updateMatrixWorld(true);
        this.bounds.setFromObject(group);
        placementKey = key;
      }
      marker.visible = mission.phase === "return";
      for (const vial of samples) vial.visible = mission.completed;
    },
  };
}
