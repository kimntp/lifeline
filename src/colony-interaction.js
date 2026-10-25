import { createAlienDubbing } from "./alien-dubbing.js";
import { renderSpeechWords } from "./speech-word-display.mjs";
import { createSpeechChallenge } from "./speech-verification.mjs";
import { connectSpeechAttempt } from "./elevenlabs-speech.js";
import { dialogueSession } from "./dialogue-session.js";
import { GARDEN_COLONY, nearestGardenWorker } from "./garden-colony.js";
import { GardenMission, GROWING_CONDITIONS, nearestSamplePlot, surveyDialogue } from "./garden-mission.js";

export function createColonyInteraction(colony, { mission = new GardenMission(), onProgress, onSample, onDeposit, onApolloMessage,
  getTool = () => "none", getBaseTarget = () => null, getFootOffset = () => 0, channel = dialogueSession, speechFactory = createSpeechChallenge, dubbingFactory = createAlienDubbing } = {}) {
  const conversationOwner = {};
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
    <p id="colony-talk-prompt" class="colony-talk-prompt" hidden></p>
    <section id="colony-dialogue" class="dialogue-box colony-dialogue" aria-label="Alien conversation" hidden>
      <p id="colony-speaker" class="colony-eyebrow"></p>
      <p id="colony-dialogue-text" aria-live="polite"></p>
      <div id="speech-verification" hidden>
        <p class="speech-instructions">Read the line aloud. Matched words glow green. V starts/cancels the microphone. Audio is sent to ElevenLabs.</p>
        <p id="speech-transcript"></p>
        <p id="speech-feedback" role="status" aria-live="polite"></p>
        <p id="speech-differences"></p>
      </div>
      <p id="colony-dialogue-hint" class="colony-dialogue-hint">E — continue · Walk away to leave</p>
    </section>`;
  document.body.appendChild(root);
  const element = id => root.querySelector(`#${id}`);
  root.querySelector("h2").textContent = GARDEN_COLONY.name;
  const prompt = element("colony-talk-prompt");
  const dialogue = element("colony-dialogue");
  const distanceLabel = element("colony-distance");
  let soilHintTime = 0, previousSoil = false, previousTool = "none";
  let conversation = null, lines = [], line = 0, renderedRevision = -1, objectivesOpen = false;
  let objectivesIntroduced = false, surveyIntroduced = mission.explained;
  let visible = false;
  let lastMissionMessage = null;
  const dubbing = dubbingFactory({ owner: conversationOwner, site: colony.site, onChange: state => {
    if (!conversation || !lines[line]?.dub) return;
    const nextHint = "E - continue / Walk away to leave";
    element("colony-dialogue-hint").textContent = state.status === "loading" ? "Preparing voice..."
      : state.status === "playing" ? "Speaking... E continues when the reply finishes."
      : state.status === "paused" ? "Voice paused. Resume the game to continue."
      : state.status === "error" ? `Voice unavailable. ${nextHint}`
      : nextHint;
  } });
  const speech = speechFactory({ connect: connectSpeechAttempt, onChange: state => {
    renderSpeechWords(element("colony-dialogue-text"), state);
    element("speech-transcript").textContent = state.transcript ? `You said: ${state.transcript}` : "";
    if (element("speech-feedback").textContent !== state.message) element("speech-feedback").textContent = state.message;
    element("speech-differences").textContent = [
      state.missing.length ? `Missing: ${state.missing.join(" ")}` : "",
      state.unexpected.length ? `Unexpected: ${state.unexpected.join(" ")}` : "",
    ].filter(Boolean).join(" / ");
    element("speech-verification").setAttribute?.("data-state", state.status);
    if (state.status === "verified" && conversation && lines[line]?.requiresSpeech) {
      // The committed phrase unlocks the farmer immediately; no confirmation turn.
      line++;
      if (line >= lines.length) close();
      else showLine();
    }
  } });
  function toggleObjectives(force) {
    objectivesOpen = typeof force === "boolean" ? force : !objectivesOpen;
    element("mission-panel").className = `mission-panel${objectivesOpen ? " is-open" : ""}`;
    element("mission-panel").ariaHidden = String(!objectivesOpen);
    element("objectives-toggle").ariaExpanded = String(objectivesOpen);
    element("objectives-toggle").textContent = objectivesOpen ? "Q · Close objectives" : "Q · Objectives";
  }
  element("objectives-toggle").addEventListener?.("click", toggleObjectives);
  function renderMission() {
    if (renderedRevision === mission.revision) return;
    renderedRevision = mission.revision;
    if (!mission.completed && (!objectivesIntroduced || (mission.explained && !surveyIntroduced))) toggleObjectives(true);
    objectivesIntroduced = true;
    surveyIntroduced = mission.explained;
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
    if (mission.apolloMessage !== lastMissionMessage) {
      lastMissionMessage = mission.apolloMessage;
      onApolloMessage?.(mission.apolloMessage);
    }
    if (mission.completed) { root.hidden = true; close(); }
  }
  function progress(changed) { if (changed) onProgress?.(); }
  function close() {
    dubbing.stop();
    speech.reset("");
    if (conversation) conversation.talking = false;
    conversation = null;
    channel.end(conversationOwner);
    dialogue.hidden = true;
  }
  function showLine() {
    dubbing.stop();
    const entry = lines[line];
    speech.reset(entry.requiresSpeech ? entry.text : "");
    element("speech-verification").hidden = !entry.requiresSpeech;
    element("colony-dialogue-hint").textContent = entry.requiresSpeech
      ? "Speak the complete line before continuing. Walk away to leave."
      : "E - continue / Walk away to leave";
    dialogue.hidden = false;
    element("colony-speaker").textContent = entry.speaker;
    dialogue.classList?.toggle("apollo-dialogue", entry.speaker.startsWith("Apollo"));
    element("colony-dialogue-text").textContent = entry.text;
    element("colony-dialogue-text").setAttribute?.("aria-live", entry.requiresSpeech ? "off" : "polite");
    if (entry.requiresSpeech) renderSpeechWords(element("colony-dialogue-text"), speech.state);
    if (entry.effect === "growth") progress(mission.learnGrowth());
    if (entry.effect === "water") progress(mission.learnWater(colony.site));
    if (entry.dub) void dubbing.start(entry, entry.voiceSpeaker ?? (entry.speaker.startsWith("Apollo") ? "Apollo" : conversation.profile.name));
  }
  function baseInReach(player) {
    const target = getBaseTarget();
    return target && Math.hypot(player.position.x - target.x, player.position.z - target.z) <= 2.5
      && Math.abs(player.position.y - getFootOffset() - target.y) <= 0.6;
  }
  function dig(player) {
    if (conversation || channel.isBlocked(conversationOwner) || getTool() !== "shovel") return false;
    const sample = nearestSamplePlot(colony, player.position, mission, getFootOffset());
    if (sample?.type !== "soil" || !mission.collect("soil", "shovel")) return false;
    onSample?.("soil"); onProgress?.(); renderMission();
    return true;
  }
  return {
    dig,
    leave: close,
    destroy() { close(); speech.destroy(); dubbing.destroy(); root.remove(); },
    refresh: renderMission,
    setVisible(nextVisible) {
      nextVisible = nextVisible && !mission.completed;
      if (visible && !nextVisible) speech.cancel();
      dubbing.setPaused(!nextVisible);
      visible = nextVisible;
      root.hidden = !nextVisible;
    },
    update(player, keyboard, cameraYaw = 0, delta = 0) {
      if (mission.completed) { root.hidden = true; close(); return; }
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
      const nearSoil = sample?.type === "soil";
      if (nearSoil && (!previousSoil || previousTool !== getTool())) soilHintTime = 5;
      else soilHintTime = Math.max(0, soilHintTime - delta);
      previousSoil = nearSoil; previousTool = getTool();
      if (conversation && (!conversation.visual.visible
        || Math.hypot(player.position.x - conversation.visual.position.x, player.position.z - conversation.visual.position.z) > 4)) close();
      const blocked = channel.isBlocked(conversationOwner);
      if (keyboard?.consumeJustPressed("KeyV") && !blocked && !dubbing.busy && conversation && lines[line]?.requiresSpeech) {
        if (["connecting", "listening"].includes(speech.state.status)) speech.cancel();
        else void speech.start();
      }
      if (keyboard?.consumeJustPressed("KeyE") && !blocked) {
        if (conversation) {
          if (dubbing.busy) return;
          if (lines[line]?.requiresSpeech && speech.state.status !== "verified") return;
          line++;
          if (line >= lines.length) close();
          else showLine();
        } else if (deposit) {
          onDeposit?.();
        } else if (sample) {
          if (sample.type === "soil") dig(player);
          else if (mission.collect(sample.type)) {
            onSample?.(sample.type);
            onProgress?.();
          }
        } else if (worker && mission.phase !== "depositing" && channel.begin(conversationOwner)) {
          conversation = worker; line = 0;
          lines = surveyDialogue(mission, worker.profile, colony.site);
          worker.talking = true;
          worker.visual.rotation.y = Math.atan2(player.position.x - worker.visual.position.x, player.position.z - worker.visual.position.z);
          showLine();
        }
      }
      const nextSample = nearestSamplePlot(colony, player.position, mission, getFootOffset());
      prompt.hidden = blocked || Boolean(conversation) || mission.phase === "depositing" || (!deposit && !nextSample && !worker) || (nextSample?.type === "soil" && soilHintTime <= 0);
      prompt.textContent = deposit ? "E — Deposit samples at base"
        : nextSample?.type === "soil" ? (getTool() === "shovel" ? "Left-click / E — Dig soil sample" : "3 — Equip shovel to collect soil")
        : nextSample ? `E — Take ${nextSample.type} sample`
        : worker ? `E — ${mission.explained && !mission.waterKnown ? "Ask about water" : "Talk"} · ${worker.profile.name}` : "";
      renderMission();
    },
  };
}
