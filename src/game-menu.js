import { setNarrationPaused, isNarrationMuted, toggleNarrationMute } from "./narration-audio.js";
import { createHomeStarfield } from "./home-starfield.js";
import { createHomeSpaceship } from "./home-spaceship.js";

export class GameSession {
  ready = false;
  started = false;
  screen = "home";
  returnScreen = "home";

  get paused() { return this.screen !== "playing"; }

  play() {
    if (!this.ready) return false;
    this.started = true;
    this.screen = "playing";
    return true;
  }

  pause() {
    if (this.screen === "playing") this.screen = "paused";
  }

  open(screen) {
    if (!["instructions", "animations"].includes(screen)) return;
    this.returnScreen = this.screen === "home" ? "home" : "paused";
    this.screen = screen;
  }

  back() { this.screen = this.returnScreen; }
  home() { this.screen = "home"; }
}

export function createGameMenu({ session, clips, onPlay, onPause, onNavigate, onPreview }) {
  const root = document.createElement("div");
  root.id = "game-interface";
  root.innerHTML = `
    <button id="pause-button" class="pause-button" type="button" aria-label="Pause game" hidden>
      <span aria-hidden="true">Ⅱ</span> Pause <kbd>P</kbd>
    </button>
    <button id="mute-button" class="pause-button mute-button" type="button" aria-pressed="false" hidden>Mute audio <kbd>M</kbd></button>
    <main id="game-menu" class="menu-shell" role="dialog" aria-modal="true" aria-labelledby="menu-title">
      <img id="home-background" class="home-background" src="${new URL("../assets/background.png", import.meta.url).href}"
        width="1470" height="688" alt="" aria-hidden="true" draggable="false" hidden>
      <canvas id="home-stars" class="home-stars" aria-hidden="true" hidden></canvas>
      <div id="home-ship" class="home-ship" aria-hidden="true" hidden></div>
      <section id="menu-card" class="menu-card" aria-labelledby="menu-title">
        <div id="home-logo" class="home-logo">
          <svg viewBox="149 340 1926 806" width="1926" height="806" role="img" aria-label="Lifeline" preserveAspectRatio="xMidYMid meet">
            <image href="${new URL("../assets/Newlifelinelogo.png", import.meta.url).href}" width="2360" height="1640" />
          </svg>
        </div>
        <p class="menu-eyebrow" id="menu-eyebrow" hidden></p>
        <h1 id="menu-title" tabindex="-1">Lifeline</h1>
        <p id="menu-description" class="menu-description" hidden></p>
        <div class="home-response">
          <div id="home-transmission" class="home-transmission" hidden>
            <p class="transmission-heading"><span class="transmission-dot" aria-hidden="true"></span>DISTRESS SIGNAL DETECTED</p>
            <p class="transmission-source">SOURCE UNKNOWN // AWAITING RESPONSE</p>
          </div>
          <div id="menu-actions" class="menu-actions">
            <button id="play-button" class="menu-button primary" type="button" disabled><span class="start-arrow" aria-hidden="true">&gt;</span><span id="play-label">Loading world…</span></button>
            <button id="instructions-button" class="menu-button" type="button">Instructions</button>
            <button id="menu-mute-button" class="menu-button" type="button" aria-pressed="false" hidden>Mute audio <kbd>M</kbd></button>
            <button id="home-button" class="menu-button quiet" type="button" hidden>Home screen</button>
          </div>
        </div>
        <div id="instructions-panel" hidden>
          <dl class="controls-list">
            <div><dt>W A S D / arrows</dt><dd>Move</dd></div>
            <div><dt>Shift</dt><dd>Sprint</dd></div>
            <div><dt>Space</dt><dd>Jump</dd></div>
            <div><dt>Mouse / scroll</dt><dd>Look / zoom</dd></div>
            <div><dt>E</dt><dd>Talk / collect sample / deposit</dd></div>
            <div><dt>1 / 2</dt><dd>Equip taser baton / pickaxe from inventory after waking at base</dd></div>
            <div><dt>Left click · baton</dt><dd>One stun puts an alien to sleep. The last alien stays downed and talkable.</dd></div>
            <div><dt>Left click · pickaxe</dt><dd>Face an ice block and strike it three times to mine the ice core. Move close; allow time between swings.</dd></div>
            <div><dt>Q</dt><dd>Open / close objectives</dd></div>
            <div><dt>Enter</dt><dd>Complete text / skip dialogue voice</dd></div>
            <div><dt>V</dt><dd>Speak / retry player dialogue</dd></div>
            <div><dt>H</dt><dd>Mining swing</dd></div>
            <div><dt>F</dt><dd>Toggle free camera</dd></div>
            <div><dt>M</dt><dd>Mute / unmute audio</dd></div>
            <div><dt>P / Esc</dt><dd>Pause and release mouse</dd></div>
          </dl>
        </div>
        <div id="animation-menu-panel" hidden>
          <label for="astronaut-animation">Astronaut animation</label>
          <select id="astronaut-animation"><option value="">Choose an animation</option></select>
          <p class="menu-description">Preview a clip while the world stays paused.</p>
        </div>
        <button id="menu-back" class="menu-button" type="button" hidden>Back</button>
        <p id="menu-status" class="menu-status" role="status" aria-live="polite">Preparing terrain and crew…</p>
      </section>
    </main>
    <div id="screen-fade" aria-hidden="true"></div>`;
  document.body.appendChild(root);
  const element = id => root.querySelector(`#${id}`);
  const fade = element("screen-fade");
  let activeTransition = null;
  let launchRequested = false;
  function updateStartControl() {
    const home = session.screen === "home";
    element("game-menu").classList.toggle("home-launching", home && launchRequested);
    element("play-button").disabled = !session.ready || launchRequested;
    element("play-button").setAttribute("aria-busy", String(launchRequested));
    element("play-label").textContent = launchRequested ? "ESTABLISHING CONNECTION..." : !session.ready ? "Loading world…"
      : home ? (session.started ? "Continue exploring" : "Start exploring") : "Resume";
  }
  function cancelTransition() {
    if (!activeTransition && !launchRequested) return;
    if (activeTransition) {
      activeTransition.cancelled = true;
      activeTransition.animation?.cancel();
    }
    activeTransition = null;
    launchRequested = false;
    starfield.setWarp(false);
    fade.style.opacity = "0";
    element("game-menu").inert = false;
    updateStartControl();
    if (session.screen === "home" && session.ready) element("play-button").focus();
  }
  const starfield = createHomeStarfield(element("home-stars"), {
    onActivityChange: animate => element("game-menu").classList.toggle("home-animated", animate),
  });
  const spaceship = createHomeSpaceship(element("home-ship"), element("menu-card"));
  const select = element("astronaut-animation");
  for (const clip of clips) select.add(new Option(clip, clip));
  function updateMuteButtons() {
    const muted = isNarrationMuted();
    for (const id of ["mute-button", "menu-mute-button"]) {
      element(id).innerHTML = `${muted ? "Unmute audio" : "Mute audio"} <kbd>M</kbd>`;
      element(id).setAttribute("aria-keyshortcuts", "M");
      element(id).setAttribute("aria-pressed", String(muted));
    }
  }
  function toggleMute() {
    toggleNarrationMute();
    updateMuteButtons();
  }
  element("mute-button").addEventListener("click", toggleMute);
  element("menu-mute-button").addEventListener("click", toggleMute);
  element("pause-button").addEventListener("click", onPause);
  element("play-button").addEventListener("click", () => {
    if (!session.ready || activeTransition || launchRequested) return;
    if (session.screen === "home") {
      launchRequested = true;
      updateStartControl();
    }
    try {
      const request = onPlay();
      request?.catch(error => menu.failStart(`Could not establish connection. ${error.message}`));
    } catch (error) {
      menu.failStart(`Could not establish connection. ${error.message}`);
    }
  });
  for (const [id, target] of [["instructions-button", "instructions"],
    ["home-button", "home"], ["menu-back", "back"]]) {
    element(id).addEventListener("click", () => onNavigate(target));
  }
  select.addEventListener("change", () => onPreview(select.value));
  element("game-menu").addEventListener("keydown", event => {
    if (event.code === "Escape" && ["instructions", "animations"].includes(session.screen)) {
      event.preventDefault();
      onNavigate("back");
    }
    if (event.key !== "Tab") return;
    const controls = [...element("game-menu").querySelectorAll("button, select")]
      .filter(control => !control.disabled && !control.closest("[hidden]"));
    const first = controls[0], last = controls.at(-1);
    if (!first) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  const menu = {
    toggleMute,
    get transitioning() { return Boolean(activeTransition); },
    cancelTransition,
    failStart(message) {
      if (launchRequested || activeTransition?.home) session.home();
      cancelTransition();
      menu.status(message);
      menu.render();
    },
    dispose() {
      starfield.setActive(false);
      spaceship.setActive(false);
      cancelTransition();
      root.remove();
    },
    async transitionToGame(onCovered) {
      if (activeTransition || !session.ready) return;
      const home = session.screen === "home";
      const transition = { cancelled: false, animation: null, home };
      activeTransition = transition;
      element("game-menu").inert = true;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      try {
        if (home) {
          launchRequested = true;
          updateStartControl();
        }
        transition.animation = fade.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: reducedMotion ? (home ? 120 : 1) : home ? 800 : 450,
          easing: "ease-in-out", fill: "forwards",
        });
        await transition.animation.finished;
        if (transition.cancelled) return;
        fade.style.opacity = "1";
        transition.animation.cancel();
        if (home && !session.ready) throw new Error("The world is not ready. Please try again.");
        await onCovered();
        if (transition.cancelled) return;
        transition.animation = fade.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: reducedMotion ? 1 : home ? 180 : 650, easing: "ease-in-out", fill: "forwards",
        });
        await transition.animation.finished;
      } catch (error) {
        if (!transition.cancelled) {
          if (home) {
            session.home();
            menu.status("Could not establish connection. Please try Start exploring again.");
            menu.render();
          }
          throw error;
        }
      } finally {
        if (activeTransition === transition) cancelTransition();
      }
    },
    status(message) { element("menu-status").textContent = message; },
    render({ focus = true } = {}) {
      setNarrationPaused(session.paused);
      updateMuteButtons();
      const screen = session.screen;
      const home = screen === "home", paused = screen === "paused";
      if (!home) launchRequested = false;
      const instructions = screen === "instructions", animations = screen === "animations";
      element("game-menu").hidden = !session.paused;
      element("game-menu").classList.toggle("home-screen", home);
      element("home-background").hidden = !home;
      element("home-stars").hidden = !home;
      starfield.setActive(home);
      element("home-ship").hidden = !home;
      spaceship.setActive(home);
      element("home-transmission").hidden = !home;
      element("game-menu").classList.toggle("preview-screen", animations);
      element("pause-button").hidden = session.paused;
      element("mute-button").hidden = session.paused;
      element("menu-mute-button").hidden = !paused;
      element("home-logo").hidden = !(home || paused);
      element("menu-eyebrow").textContent = home ? "" : "LIFELINE";
      element("menu-eyebrow").hidden = home || paused;
      element("menu-title").textContent = home ? "Lifeline" : paused ? "Paused" : instructions ? "Instructions" : "Animations";
      element("menu-description").textContent = paused ? "Take a breath. Your world can wait." : "";
      element("menu-description").hidden = !paused;
      element("menu-actions").hidden = instructions || animations;
      updateStartControl();
      element("instructions-button").hidden = !paused;
      element("home-button").hidden = !paused;
      element("instructions-panel").hidden = !instructions;
      element("animation-menu-panel").hidden = !animations;
      element("menu-back").hidden = !instructions && !animations;
      if (!animations) select.value = "";
      if (focus && session.paused) {
        const button = instructions || animations ? element("menu-back") : session.ready ? element("play-button") : element("menu-title");
        button.focus();
      }
    },
  };
  return menu;
}
