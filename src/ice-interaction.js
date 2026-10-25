import * as THREE from "three";
import { dialogueSession } from "./dialogue-session.js";

export function createIceInteraction(encounter, { channel = dialogueSession, onComplete = () => {}, getTool = () => "baton" } = {}) {
  const root = document.createElement("div");
  root.id = "ice-colony-interface";
  root.hidden = true;
  root.innerHTML = `
    <div class="colony-location"><p class="colony-eyebrow">REGION 02</p><h2>Ares — Water Colony</h2><p id="ice-status"></p></div>
    <button id="ice-objectives-toggle" class="objectives-toggle" type="button">Q · Objectives</button>
    <aside id="ice-mission-panel" class="mission-panel" aria-label="Colony 2 objectives">
      <p class="colony-eyebrow">COLONY 2</p><p id="ice-objectives"></p>
      <p id="ice-apollo" class="mission-water" role="status" aria-live="polite"></p>
    </aside>
    <p id="ice-prompt" class="colony-talk-prompt" hidden></p>
    <section id="ice-dialogue" class="dialogue-box colony-dialogue" hidden aria-label="Colony 2 conversation">
      <p id="ice-speaker" class="colony-eyebrow"></p><p id="ice-line"></p>
      <p class="colony-dialogue-hint">E — continue · Walk away to leave</p>
    </section>`;
  document.body.appendChild(root);
  const element = id => root.querySelector(`#${id}`);
  const owner = {};
  let open = false, conversation = null, lines = [], line = 0, introducedPhase = null;
  let toolInstructionTime = 0, previousTool = null, previousSample = null;
  const targets = encounter.base.group.children.filter(piece => /ice_block|crystal/.test(piece.name)).map(piece => ({
    type: piece.name.startsWith("crystal") ? "crystal" : "ice", bounds: new THREE.Box3().setFromObject(piece),
  }));
  function toggle(force) {
    open = typeof force === "boolean" ? force : !open;
    element("ice-mission-panel").className = `mission-panel${open ? " is-open" : ""}`;
    element("ice-objectives-toggle").textContent = open ? "Q · Close objectives" : "Q · Objectives";
  }
  element("ice-objectives-toggle").addEventListener("click", toggle);
  function close() {
    conversation = null;
    channel.end(owner);
    element("ice-dialogue").hidden = true;
    encounter.turnHostile();
  }
  function show() {
    const entry = lines[line];
    element("ice-dialogue").hidden = false;
    element("ice-speaker").textContent = entry.speaker;
    element("ice-line").textContent = entry.text;
    if (entry.tasks) encounter.assignTasks();
  }
  function closestAlien(position) {
    return encounter.units.filter(unit => unit.state === "downed" || (unit.state === "awake" && encounter.phase === "neutral"))
      .filter(unit => Math.abs(unit.visual.position.y - position.y) < 3)
      .map(unit => ({ unit, distance: Math.hypot(unit.visual.position.x - position.x, unit.visual.position.z - position.z) }))
      .filter(item => item.distance <= 3).sort((a, b) => a.distance - b.distance)[0]?.unit;
  }
  function resource(position) {
    if (encounter.phase !== "tasks") return null;
    if (!encounter.tasks.water && Math.hypot(position.x - encounter.water.position.x, position.z - encounter.water.position.z) < 2.8) return "water";
    for (const target of targets) {
      if (encounter.tasks[target.type]) continue;
      const b = target.bounds;
      const distance = Math.hypot(Math.max(b.min.x - position.x, 0, position.x - b.max.x),
        Math.max(b.min.z - position.z, 0, position.z - b.max.z));
      if (distance < 2.4 && Math.abs(position.y - b.min.y) < 3) return target.type;
    }
    return null;
  }
  return {
    get conversing() { return Boolean(conversation); },
    prepareStrike() {
      if (conversation && ["recognition", "hostile"].includes(encounter.phase)) close();
    },
    setVisible(visible) { root.hidden = !visible; },
    leave: close,
    destroy() { close(); root.remove(); },
    update(player, keyboard, delta = 0) {
      if (keyboard?.consumeJustPressed("KeyQ")) toggle();
      if (conversation && Math.hypot(player.position.x - conversation.visual.position.x, player.position.z - conversation.visual.position.z) > 4.5) close();
      const alien = closestAlien(player.position), sample = resource(player.position);
      const tool = getTool();
      if (tool !== previousTool || (sample === "ice" && previousSample !== "ice")) toolInstructionTime = 5;
      else toolInstructionTime = Math.max(0, toolInstructionTime - delta);
      previousTool = tool; previousSample = sample;
      const blocked = channel.isBlocked(owner);
      if (keyboard?.consumeJustPressed("KeyE") && !blocked) {
        if (conversation) {
          line++;
          if (line >= lines.length) close(); else show();
        } else if (sample) {
          if (sample !== "ice" && encounter.collect(sample) && encounter.phase === "complete") {
            close();
            onComplete();
          }
        }
        else if (alien && channel.begin(owner)) {
          conversation = alien; line = 0;
          if (encounter.recognize()) lines = [
            { speaker: "You", text: "We came from the garden colony to ask about your water supply." },
            { speaker: "Gray colonist", text: "You. We recognize you. That suit carries the same company mark. Stay away from our water!" },
            { speaker: "Apollo", text: "They are turning hostile. Your taser baton is equipped. Put them to sleep—do not kill them." },
          ];
          else lines = [
            { speaker: "Downed gray alien", text: "[The alien speaks urgently in an untranslated language.]" },
            { speaker: "You", text: "Apollo, translate that. What is he saying?" },
            { speaker: "Apollo", text: "Translation processed. Mine an ice core with your inventory pickaxe, scan the water source, and take a crystal sample. Those are your priorities now.", tasks: true },
          ];
          show();
        }
      }
      const phase = encounter.phase;
      if (phase !== introducedPhase) {
        toggle(true);
        introducedPhase = phase;
      }
      element("ice-status").textContent = encounter.feedbackTime > 0 ? encounter.feedback
        : phase === "neutral" ? "Six gray colonists · Mining ice"
        : phase === "recognition" ? "The gray colonists recognize you"
        : `${encounter.asleep}/6 asleep${encounter.lastAlien ? " · Last alien downed and responsive" : ""}`;
      element("ice-objectives").textContent = phase === "neutral" || phase === "recognition" ? "Talk to one of the gray aliens."
        : phase === "hostile" ? "Incapacitate all six aliens."
        : phase === "lastDowned" ? "Talk to the downed alien. Ask Apollo to translate."
        : `${encounter.tasks.ice ? "✓" : "○"} Mine ice core · ${encounter.tasks.water ? "✓" : "○"} Water scan · ${encounter.tasks.crystal ? "✓" : "○"} Crystal sample`;
      element("ice-apollo").textContent = encounter.message;
      element("ice-prompt").hidden = blocked || Boolean(conversation) || (!sample && !alien) || (sample === "ice" && toolInstructionTime <= 0);
      element("ice-prompt").textContent = sample === "ice" ? (getTool() === "pickaxe" ? "Left-click — Mine ice · 3 strikes" : "2 — Equip pickaxe to mine ice")
        : sample ? `E — ${sample === "water" ? "Scan water source" : `Collect ${sample} sample`}`
        : alien?.state === "downed" ? "E — Talk to the downed alien" : "E — Talk to gray colonist";
    },
  };
}
