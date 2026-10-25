import { GARDEN_COLONY, nearestGardenWorker } from "./garden-colony.js";
import { GardenMission, GROWING_CONDITIONS, nearestSamplePlot, surveyDialogue } from "./garden-mission.js";

export function createColonyInteraction(colony, { mission = new GardenMission(), onProgress, onSample, onDeposit,
  getBaseTarget = () => null, getFootOffset = () => 0 } = {}) {
  const root = document.createElement("div");
  root.id = "colony-interface";
  root.hidden = true;
  root.innerHTML = `
    <div class="colony-location">
      <p class="colony-eyebrow">REGION 01 · PEACEFUL CONTACT</p>
      <h2></h2><p id="colony-distance"></p>
    </div>
    <button id="objectives-toggle" class="objectives-toggle" type="button" aria-controls="mission-panel" aria-expanded="false">Q · Objectives</button>
    <aside id="mission-panel" class="mission-panel" aria-label="Garden colony field survey" aria-hidden="true">
      <p class="colony-eyebrow" id="mission-title">FIELD SURVEY</p>
      <ul id="mission-objectives" class="mission-objectives"></ul>
      <section id="mission-conditions" hidden>
        <h3>Growing conditions</h3>
        <p class="mission-caption">Alien-reported · in-game readings</p>
        <dl id="mission-condition-values" class="mission-stats"></dl>
      </section>
      <p id="mission-inventory" class="mission-caption"></p>
      <p id="mission-water" class="mission-water" hidden></p>
      <div class="apollo-message"><h3>APOLLO <span>Field assistant</span></h3>
        <p id="mission-apollo" role="status" aria-live="polite"></p></div>
    </aside>
    <p id="apollo-radio" class="apollo-radio" role="status" aria-live="polite" hidden></p>
    <p id="colony-talk-prompt" class="colony-talk-prompt" hidden></p>
    <section id="colony-dialogue" class="colony-dialogue" aria-label="Peaceful alien conversation" hidden>
      <p id="colony-speaker" class="colony-eyebrow"></p>
      <p id="colony-dialogue-text" aria-live="polite"></p>
      <p class="colony-dialogue-hint">E — continue · Walk away to leave</p>
    </section>`;
  document.body.appendChild(root);
  const element = id => root.querySelector(`#${id}`);
  root.querySelector("h2").textContent = GARDEN_COLONY.name;
  const prompt = element("colony-talk-prompt");
  const dialogue = element("colony-dialogue");
  const distanceLabel = element("colony-distance");
  let conversation = null, lines = [], line = 0, renderedRevision = -1, objectivesOpen = false;
  function toggleObjectives() {
    objectivesOpen = !objectivesOpen;
    element("mission-panel").className = `mission-panel${objectivesOpen ? " is-open" : ""}`;
    element("mission-panel").ariaHidden = String(!objectivesOpen);
    element("objectives-toggle").ariaExpanded = String(objectivesOpen);
    element("objectives-toggle").textContent = objectivesOpen ? "Q · Close objectives" : "Q · Objectives";
  }
  element("objectives-toggle").addEventListener?.("click", toggleObjectives);
  function renderMission() {
    if (renderedRevision === mission.revision) return;
    renderedRevision = mission.revision;
    element("mission-title").textContent = mission.completed ? "SURVEY COMPLETE" : "FIELD SURVEY · GARDEN COLONY";
    element("mission-objectives").innerHTML = mission.objectives.map(item =>
      `<li class="${item.done ? "done" : ""}"><span aria-hidden="true">${item.done ? "✓" : "○"}</span>${item.label}</li>`).join("");
    element("mission-conditions").hidden = !mission.explained;
    element("mission-condition-values").innerHTML = GROWING_CONDITIONS.map(stat =>
      `<div><dt>${stat.label}</dt><dd>${stat.value}</dd></div>`).join("");
    element("mission-inventory").textContent = mission.completed ? "Sample case emptied at base · 3 samples deposited"
      : `Sample case: ${mission.inventory.length}/3 · ${mission.inventory.length ? mission.inventory.join(" · ") : "empty"}`;
    element("mission-water").hidden = !mission.waterKnown;
    if (mission.waterKnown) element("mission-water").textContent = `Ares Water Colony · X ${mission.coordinates.x}, Z ${mission.coordinates.z} · local survey grid`;
    element("mission-apollo").textContent = mission.apolloMessage;
    element("apollo-radio").textContent = `APOLLO · ${mission.apolloMessage}`;
  }
  function progress(changed) { if (changed) onProgress?.(); }
  function close() {
    if (conversation) conversation.talking = false;
    conversation = null;
    dialogue.hidden = true;
  }
  function showLine() {
    const entry = lines[line];
    dialogue.hidden = false;
    element("colony-speaker").textContent = entry.speaker;
    element("colony-dialogue-text").textContent = entry.text;
    if (entry.effect === "growth") progress(mission.learnGrowth());
    if (entry.effect === "water") progress(mission.learnWater(colony.site));
  }
  function baseInReach(player) {
    const target = getBaseTarget();
    return target && Math.hypot(player.position.x - target.x, player.position.z - target.z) <= 2.5
      && Math.abs(player.position.y - getFootOffset() - target.y) <= 0.6;
  }
  return {
    destroy() { close(); root.remove(); },
    refresh: renderMission,
    setVisible(visible) { root.hidden = !visible; },
    update(player, keyboard, cameraYaw = 0) {
      if (keyboard?.consumeJustPressed("KeyQ")) toggleObjectives();
      const returning = mission.phase === "return";
      const baseTarget = getBaseTarget();
      const target = returning && baseTarget ? baseTarget : colony.site;
      const dx = target.x - player.position.x, dz = target.z - player.position.z;
      const distance = Math.hypot(dx, dz);
      const angle = Math.atan2(dx * Math.cos(cameraYaw) - dz * Math.sin(cameraYaw),
        -dx * Math.sin(cameraYaw) - dz * Math.cos(cameraYaw));
      const direction = ["ahead", "ahead-right", "right", "behind-right", "behind", "behind-left", "left", "ahead-left"][(Math.round(angle / (Math.PI / 4)) + 8) % 8];
      distanceLabel.textContent = returning ? `Return to base FIRST · ${Math.round(distance)} m · ${direction}`
        : distance > 18 ? `Garden settlement · ${Math.round(distance)} m · ${direction}` : GARDEN_COLONY.ability;
      const worker = nearestGardenWorker(colony.workers, player.position);
      const sample = nearestSamplePlot(colony, player.position, mission, getFootOffset());
      const deposit = returning && baseInReach(player);
      if (conversation && (!conversation.visual.visible
        || Math.hypot(player.position.x - conversation.visual.position.x, player.position.z - conversation.visual.position.z) > 4)) close();
      if (keyboard?.consumeJustPressed("KeyE")) {
        if (conversation) {
          line++;
          if (line >= lines.length) close();
          else showLine();
        } else if (deposit) {
          onDeposit?.();
        } else if (sample) {
          if (mission.collect(sample.type)) {
            onSample?.(sample.type);
            onProgress?.();
          }
        } else if (worker && mission.phase !== "depositing") {
          conversation = worker; line = 0;
          lines = surveyDialogue(mission, worker.profile, colony.site);
          worker.talking = true;
          worker.visual.rotation.y = Math.atan2(player.position.x - worker.visual.position.x, player.position.z - worker.visual.position.z);
          showLine();
        }
      }
      const nextSample = nearestSamplePlot(colony, player.position, mission, getFootOffset());
      prompt.hidden = Boolean(conversation) || mission.phase === "depositing" || (!deposit && !nextSample && !worker);
      prompt.textContent = deposit ? "E — Deposit samples at base"
        : nextSample ? `E — ${nextSample.type === "soil" ? "Collect soil sample" : `Take ${nextSample.type} sample`}`
        : worker ? `E — ${mission.explained && !mission.waterKnown ? "Ask about water" : "Talk"} · ${worker.profile.name}` : "";
      renderMission();
      element("apollo-radio").hidden = objectivesOpen || Boolean(conversation) || !mission.explained;
    },
  };
}
