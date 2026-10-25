import { attachDialogueText } from "./narration-captions.js";
import * as THREE from "three";
import { DIRECT_ALIEN_DIALOGUE, RECOGNITION_DIALOGUE, TASK_DIALOGUE } from "./ice-dialogue.mjs";
import { createDialogueDubbing } from "./alien-dubbing.js";
import { dialogueSession } from "./dialogue-session.js";

export function createIceInteraction(encounter, { channel = dialogueSession, onComplete = () => {}, getTool = () => "baton", dubbingFactory = createDialogueDubbing } = {}) {
  const root = document.createElement("div");
  root.id = "ice-colony-interface";
  root.hidden = true;
  root.innerHTML = `
    <div class="colony-location"><p class="colony-eyebrow">COLONY 1</p><h2>Ares - Water Colony</h2><p id="ice-status" hidden></p></div>
    <button id="ice-objectives-toggle" class="objectives-toggle" type="button" aria-controls="ice-mission-panel" aria-expanded="false">Q · Objectives</button>
    <aside id="ice-mission-panel" class="mission-panel" aria-label="Water colony field survey" aria-hidden="true">
      <p class="colony-eyebrow" id="ice-mission-title">FIELD SURVEY - WATER COLONY</p>
      <ul id="ice-objectives" class="mission-objectives"></ul>
      <p id="ice-inventory" class="mission-caption"></p>
      <div class="apollo-message"><h3>APOLLO <span>Field assistant</span></h3>
        <p id="ice-apollo" role="status" aria-live="polite"></p></div>
    </aside>
    <p id="ice-prompt" class="colony-talk-prompt" hidden></p>
    <section id="ice-dialogue" class="dialogue-box colony-dialogue" hidden aria-label="Water colony conversation">
      <p id="ice-speaker" class="colony-eyebrow"></p><p id="ice-line"></p>
      <p id="ice-dialogue-hint" class="colony-dialogue-hint">E — continue · Walk away to leave</p>
    </section>`;
  document.body.appendChild(root);
  const element = id => root.querySelector(`#${id}`);
  const owner = {};
  const dubbing = dubbingFactory({ owner,
    onAudio: (audio, entry) => attachDialogueText(audio, entry, { box: element("ice-dialogue"), speaker: element("ice-speaker"), line: element("ice-line") }),
    onChange: ({ busy, status }) => {
    if (["finished", "error", "completed"].includes(status) && conversation) element("ice-line").textContent = lines[line].text;
    element("ice-dialogue-hint").textContent = busy
      ? "Speaking... Enter - Skip voice | Walk away to leave"
      : "Enter / E - Continue | Walk away to leave";
  } });
  let open = false, conversation = null, lines = [], line = 0, introducedPhase = null;
  let toolInstructionTime = 0, previousTool = null, previousSample = null;
  let innerTime = 0, innerRevealed = false;
  const targets = encounter.base.group.children.filter(piece => /ice_block|crystal/.test(piece.name)).map(piece => ({
    type: piece.name.startsWith("crystal") ? "crystal" : "ice", bounds: new THREE.Box3().setFromObject(piece),
  }));
  function toggle(force) {
    open = typeof force === "boolean" ? force : !open;
    element("ice-mission-panel").className = `mission-panel${open ? " is-open" : ""}`;
    element("ice-mission-panel").ariaHidden = String(!open);
    element("ice-objectives-toggle").ariaExpanded = String(open);
    element("ice-objectives-toggle").textContent = open ? "Q · Close objectives" : "Q · Objectives";
  }
  element("ice-objectives-toggle").addEventListener("click", toggle);
  function close() {
    conversation = null;
    dubbing.stop();
    channel.end(owner);
    element("ice-dialogue").hidden = true;
    encounter.turnHostile();
  }
  function show() {
    const entry = lines[line];
    dubbing.stop();
    innerTime = 0; innerRevealed = false;
    element("ice-dialogue").hidden = false;
    element("ice-speaker").textContent = entry.speaker;
    element("ice-dialogue").classList?.toggle("apollo-dialogue", entry.speaker.startsWith("Apollo") || entry.speaker.startsWith("You"));
    element("ice-line").textContent = (entry.voiceSpeaker && !entry.text.startsWith("[")) || entry.innerThought ? "" : entry.text;
    if (entry.voiceSpeaker) void dubbing.start(entry, entry.voiceSpeaker);
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
    get musicMood() { return conversation ? lines[line]?.musicMood ?? (conversation.state === "downed" ? "sad" : undefined) : undefined; },
    get conversing() { return Boolean(conversation); },
    prepareStrike() {
      if (conversation && ["recognition", "hostile"].includes(encounter.phase)) close();
    },
    setVisible(visible) { root.hidden = !visible; dubbing.setPaused(!visible); },
    handleSkip() {
      if (!conversation || root.hidden) return false;
      if (dubbing.busy) dubbing.complete();
      else if (lines[line]?.innerThought && !innerRevealed) { innerRevealed = true; element("ice-line").textContent = lines[line].text; }
      else { line++; if (line >= lines.length) close(); else show(); }
      return true;
    },
    leave: close,
    destroy() { close(); dubbing.destroy(); root.remove(); },
    update(player, keyboard, delta = 0) {
      if (conversation && lines[line]?.innerThought && !innerRevealed && !root.hidden) {
        innerTime += delta;
        const words = lines[line].text.split(/\s+/), count = Math.min(words.length, Math.floor(innerTime * 7) + 1);
        element("ice-line").textContent = words.slice(0, count).join(" ");
        innerRevealed = count === words.length;
      }
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
          if (dubbing.busy) return;
          if (lines[line]?.innerThought && !innerRevealed) { innerRevealed = true; element("ice-line").textContent = lines[line].text; return; }
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
          if (encounter.recognize()) lines = RECOGNITION_DIALOGUE;
          else if (encounter.directContact) lines = DIRECT_ALIEN_DIALOGUE;
          else lines = TASK_DIALOGUE;
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
      const contacted = !["neutral", "recognition"].includes(phase);
      const subdued = ["lastDowned", "tasks", "complete"].includes(phase);
      const translated = ["tasks", "complete"].includes(phase);
      const objectives = [
        { label: "Speak with the gray colonists", done: contacted },
        ...(contacted ? [{ label: "Incapacitate the six colonists", done: subdued }] : []),
        ...(subdued ? [{ label: "Talk to the downed alien and ask Apollo to translate", done: translated }] : []),
        ...(translated ? [
          { label: "Mine an ice core with the pickaxe", done: encounter.tasks.ice },
          { label: "Scan the water source", done: encounter.tasks.water },
          { label: "Collect a crystal sample", done: encounter.tasks.crystal },
        ] : []),
      ];
      const markup = objectives.map(item => `<li class="${item.done ? "done" : ""}"><span aria-hidden="true">${item.done ? "\u2713" : "\u25cb"}</span>${item.label}</li>`).join("");
      if (element("ice-objectives").innerHTML !== markup) element("ice-objectives").innerHTML = markup;
      element("ice-mission-title").textContent = phase === "complete" ? "SURVEY COMPLETE" : "FIELD SURVEY - WATER COLONY";
      const collected = ["ice", "water", "crystal"].filter(sample => encounter.tasks[sample]);
      element("ice-inventory").textContent = `Sample case: ${collected.length}/3 - ${collected.length ? collected.join(" / ") : "empty"}`;
      element("ice-apollo").textContent = encounter.message;
      element("ice-prompt").hidden = blocked || Boolean(conversation) || (!sample && !alien) || (sample === "ice" && toolInstructionTime <= 0);
      element("ice-prompt").textContent = sample === "ice" ? (getTool() === "pickaxe" ? "Left-click — Mine ice · 3 strikes" : "2 — Equip pickaxe to mine ice")
        : sample ? `E — ${sample === "water" ? "Scan water source" : `Collect ${sample} sample`}`
        : alien?.state === "downed" ? "E — Talk to the downed alien" : "E — Talk to gray colonist";
    },
  };
}
