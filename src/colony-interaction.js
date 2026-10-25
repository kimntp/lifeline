import { dialogueSession } from "./dialogue-session.js";
import { GARDEN_COLONY, nearestGardenWorker } from "./garden-colony.js";

export function createColonyInteraction(colony, channel = dialogueSession) {
  const conversationOwner = {};
  const root = document.createElement("div");
  root.id = "colony-interface";
  root.hidden = true;
  root.innerHTML = `
    <div class="colony-location">
      <p class="colony-eyebrow">REGION 01</p>
      <h2></h2><p id="colony-distance"></p>
    </div>
    <p id="colony-talk-prompt" class="colony-talk-prompt" hidden></p>
    <section id="colony-dialogue" class="colony-dialogue dialogue-box" aria-label="Alien conversation" hidden>
      <p id="colony-speaker" class="colony-eyebrow"></p>
      <p id="colony-dialogue-text" aria-live="polite"></p>
      <p class="colony-dialogue-hint">E — continue · Walk away to leave</p>
    </section>`;
  document.body.appendChild(root);
  root.querySelector("h2").textContent = GARDEN_COLONY.name;
  const prompt = root.querySelector("#colony-talk-prompt");
  const dialogue = root.querySelector("#colony-dialogue");
  const distanceLabel = root.querySelector("#colony-distance");
  let conversation = null;
  let line = 0;
  function close() {
    if (conversation) conversation.talking = false;
    conversation = null;
    channel.end(conversationOwner);
    dialogue.hidden = true;
  }
  function showLine() {
    dialogue.hidden = false;
    root.querySelector("#colony-speaker").textContent = `${conversation.profile.name} — ${conversation.profile.role}`;
    root.querySelector("#colony-dialogue-text").textContent = conversation.profile.lines[line];
  }
  return {
    destroy() { close(); root.remove(); },
    setVisible(visible) { root.hidden = !visible; },
    update(player, keyboard, cameraYaw = 0) {
      const distance = Math.hypot(player.position.x - colony.site.x, player.position.z - colony.site.z);
      const dx = colony.site.x - player.position.x, dz = colony.site.z - player.position.z;
      const angle = Math.atan2(dx * Math.cos(cameraYaw) - dz * Math.sin(cameraYaw),
        -dx * Math.sin(cameraYaw) - dz * Math.cos(cameraYaw));
      const direction = ["ahead", "ahead-right", "right", "behind-right", "behind", "behind-left", "left", "ahead-left"][(Math.round(angle / (Math.PI / 4)) + 8) % 8];
      distanceLabel.textContent = distance > 18 ? `Garden settlement · ${Math.round(distance)} m · ${direction}`
        : GARDEN_COLONY.ability;
      const worker = nearestGardenWorker(colony.workers, player.position);
      if (conversation && (!conversation.visual.visible
        || Math.hypot(player.position.x - conversation.visual.position.x, player.position.z - conversation.visual.position.z) > 4)) close();
      if (keyboard?.consumeJustPressed("KeyE")) {
        if (conversation) {
          line++;
          if (line >= conversation.profile.lines.length) close();
          else showLine();
        } else if (worker && channel.begin(conversationOwner)) {
          conversation = worker; line = 0;
          worker.talking = true;
          worker.visual.rotation.y = Math.atan2(player.position.x - worker.visual.position.x, player.position.z - worker.visual.position.z);
          showLine();
        }
      }
      prompt.hidden = Boolean(conversation) || !worker || channel.isBlocked(conversationOwner);
      if (worker) prompt.textContent = `E — Talk to ${worker.profile.name}`;
    },
  };
}
