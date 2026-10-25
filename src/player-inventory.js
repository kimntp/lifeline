import * as THREE from "three";

export function equipShovel(player) {
  player.updateMatrixWorld(true);
  const hand = player.getObjectByName("maoL") ?? player;
  const shovel = new THREE.Group(); shovel.name = "SurveyShovel";
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.65, 10),
    new THREE.MeshStandardMaterial({ color: 0x695342, roughness: 0.85 }));
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.035),
    new THREE.MeshStandardMaterial({ color: 0x9ba9b0, metalness: 0.7, roughness: 0.4 }));
  blade.position.y = 0.43; blade.rotation.x = -0.2;
  shovel.add(handle, blade);
  const scale = hand.getWorldScale(new THREE.Vector3());
  shovel.scale.set(1 / scale.x, 1 / scale.y, 1 / scale.z);
  shovel.visible = false; hand.add(shovel);
  return shovel;
}

export function createPlayerInventory(onSelect) {
  const root = document.createElement("nav"); root.className = "player-inventory";
  root.setAttribute("aria-label", "Tool inventory"); root.hidden = true;
  root.innerHTML = `<span>Inventory</span><button type="button" data-tool="baton">1 · Baton</button>
    <button type="button" data-tool="pickaxe">2 · Pickaxe</button><button type="button" data-tool="shovel">3 · Shovel</button>`;
  const buttons = [...root.querySelectorAll("button")];
  for (const button of buttons) button.addEventListener("click", () => onSelect(button.dataset.tool));
  document.body.appendChild(root);
  return {
    update({ visible, selected, combatUnlocked }) {
      root.hidden = !visible;
      for (const button of buttons) {
        button.disabled = button.dataset.tool !== "shovel" && !combatUnlocked;
        button.setAttribute("aria-pressed", String(button.dataset.tool === selected));
      }
    },
    dispose() { root.remove(); },
  };
}
