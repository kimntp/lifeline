import { setNarrationPaused, isNarrationMuted, toggleNarrationMute } from "./narration-audio.js";

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
    <button id="mute-button" class="pause-button mute-button" type="button" aria-pressed="false" hidden>Mute audio</button>
    <main id="game-menu" class="menu-shell" role="dialog" aria-modal="true" aria-labelledby="menu-title">
      <video id="home-video" class="home-video" autoplay muted loop playsinline
        preload="metadata" poster="/assets/space-panorama.png" aria-hidden="true" hidden>
        <source src="/assets/space-home.mp4" type="video/mp4">
      </video>
      <section class="menu-card" aria-labelledby="menu-title">
        <img id="home-logo" class="home-logo" src="/assets/lifelinelogo.png" alt="Lifeline" width="900" height="200">
        <p class="menu-eyebrow" id="menu-eyebrow" hidden></p>
        <h1 id="menu-title" tabindex="-1">Lifeline</h1>
        <p id="menu-description" class="menu-description" hidden></p>
        <div id="menu-actions" class="menu-actions">
          <button id="play-button" class="menu-button primary" type="button" disabled>Loading world…</button>
          <button id="instructions-button" class="menu-button" type="button">Instructions</button>
          <button id="menu-mute-button" class="menu-button" type="button" aria-pressed="false" hidden>Mute audio</button>
          <button id="home-button" class="menu-button quiet" type="button" hidden>Home screen</button>
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
  function cancelTransition() {
    if (!activeTransition) return;
    activeTransition.cancelled = true;
    activeTransition.animation?.cancel();
    activeTransition = null;
    fade.style.opacity = "0";
    element("game-menu").inert = false;
  }
  const video = element("home-video");
  video.muted = true;
  video.addEventListener("error", () => { video.hidden = true; });
  const select = element("astronaut-animation");
  for (const clip of clips) select.add(new Option(clip, clip));
  function updateMuteButtons() {
    const muted = isNarrationMuted();
    for (const id of ["mute-button", "menu-mute-button"]) {
      element(id).textContent = muted ? "Unmute audio" : "Mute audio";
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
  element("play-button").addEventListener("click", onPlay);
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

  return {
    toggleMute,
    get transitioning() { return Boolean(activeTransition); },
    cancelTransition,
    async transitionToGame(onCovered) {
      if (activeTransition) return;
      const transition = { cancelled: false, animation: null };
      activeTransition = transition;
      element("game-menu").inert = true;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      try {
        transition.animation = fade.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: reducedMotion ? 1 : 450, easing: "ease-in-out", fill: "forwards",
        });
        await transition.animation.finished;
        if (transition.cancelled) return;
        fade.style.opacity = "1";
        transition.animation.cancel();
        onCovered();
        transition.animation = fade.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: reducedMotion ? 1 : 650, easing: "ease-in-out", fill: "forwards",
        });
        await transition.animation.finished;
      } catch (error) {
        if (!transition.cancelled) throw error;
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
      video.hidden = !home || Boolean(video.error);
      if (home && !video.error) {
        video.play().catch(() => { video.hidden = true; });
      } else {
        video.pause();
      }
      const instructions = screen === "instructions", animations = screen === "animations";
      element("game-menu").hidden = !session.paused;
      element("game-menu").classList.toggle("home-screen", home);
      element("game-menu").classList.toggle("preview-screen", animations);
      element("pause-button").hidden = session.paused;
      element("mute-button").hidden = session.paused;
      element("menu-mute-button").hidden = !paused;
      element("home-logo").hidden = !home;
      element("menu-eyebrow").textContent = home ? "" : "LIFELINE";
      element("menu-eyebrow").hidden = home;
      element("menu-title").textContent = home ? "Lifeline" : paused ? "Paused" : instructions ? "Instructions" : "Animations";
      element("menu-description").textContent = paused ? "Take a breath. Your world can wait." : "";
      element("menu-description").hidden = !paused;
      element("menu-actions").hidden = instructions || animations;
      element("play-button").disabled = !session.ready;
      element("play-button").textContent = !session.ready ? "Loading world…" : home ? (session.started ? "Continue exploring" : "Start exploring") : "Resume";
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
}
