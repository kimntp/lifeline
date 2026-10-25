import assert from "node:assert/strict";
import test from "node:test";
import { GameSession, createGameMenu } from "../src/game-menu.js";

function createMenuHarness(testing, { ready = true, reduced = false, onPlay = () => {} } = {}) {
  const original = Object.fromEntries(["document", "Option", "window"].map(name => [name, globalThis[name]]));
  testing.after(() => {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  });
  const elements = new Map();
  const animations = [];
  const root = {
    removed: false,
    remove() { this.removed = true; },
    set innerHTML(html) {
      for (const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
        const events = new Map();
        const classes = new Set();
        elements.set(match[1], {
          hidden: false, style: {},
          classList: { toggle(name, value) { if (value) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) },
          addEventListener: (name, callback) => events.set(name, callback),
          setAttribute() {}, focus() {}, add() {}, getContext: () => null,
          animate(keyframes, options) {
            let finish, reject;
            const finished = new Promise((resolve, rejectPromise) => { finish = resolve; reject = rejectPromise; });
            finished.catch(() => {});
            const animation = {
              target: match[1], keyframes, options, finished, finish,
              cancel() { this.cancelled = true; reject(new Error("Animation cancelled")); },
            };
            animations.push(animation);
            return animation;
          },
          events,
        });
      }
    },
    querySelector: selector => elements.get(selector.slice(1)),
  };
  globalThis.document = { createElement: () => root, body: { appendChild() {} } };
  globalThis.window = { matchMedia: () => ({ matches: reduced }) };
  globalThis.Option = class {};
  const session = new GameSession();
  session.ready = ready;
  let requests = 0;
  const noop = () => {};
  const menu = createGameMenu({
    session, clips: [], onPlay: () => { requests++; return onPlay(); }, onPause: noop,
    onNavigate: noop, onPreview: noop, onMoveBase: noop, onSetSpawn: noop, onMoveColony: noop, onIceBase: noop,
  });
  menu.render();
  return { session, menu, elements, animations, root, get requests() { return requests; } };
}

test("home launch waits for readiness and starts gameplay exactly once after the 800ms cover", async testing => {
  const harness = createMenuHarness(testing, { ready: false });
  const { menu, session, elements, animations } = harness;
  let starts = 0;
  const start = () => { starts++; session.play(); menu.render(); };
  elements.get("play-button").events.get("click")();
  await menu.transitionToGame(start);
  assert.equal(harness.requests, 0);
  assert.equal(animations.length, 0);
  session.ready = true;
  menu.render();
  elements.get("play-button").events.get("click")();
  assert.equal(harness.requests, 1);
  assert.equal(elements.get("play-label").textContent, "ESTABLISHING CONNECTION...");
  assert.equal(elements.get("play-button").disabled, true);
  assert.equal(elements.get("game-menu").classList.contains("home-launching"), true);
  elements.get("play-button").events.get("click")();
  assert.equal(harness.requests, 1);
  const pending = menu.transitionToGame(start);
  assert.equal(menu.transitioning, true);
  assert.equal(elements.get("game-menu").inert, true);
  assert.equal(animations.length, 1);
  assert.equal(animations[0].target, "screen-fade");
  assert.equal(animations[0].options.duration, 800);
  assert.equal(starts, 0);
  elements.get("play-button").events.get("click")();
  await menu.transitionToGame(start);
  assert.equal(harness.requests, 1);
  assert.equal(animations.length, 1);
  animations[0].finish();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(starts, 1);
  assert.equal(session.screen, "playing");
  assert.equal(animations.at(-1).options.duration, 180);
  animations.at(-1).finish();
  await pending;
  assert.equal(starts, 1);
  assert.equal(menu.transitioning, false);
  assert.equal(elements.get("game-menu").inert, false);
  assert.equal(elements.get("screen-fade").style.opacity, "0");
});

test("cancelled home launches restore the menu without starting gameplay", async testing => {
  const { menu, elements, animations } = createMenuHarness(testing);
  let starts = 0;
  const pending = menu.transitionToGame(() => { starts++; });
  menu.cancelTransition();
  await pending;
  assert.equal(starts, 0);
  assert.equal(menu.transitioning, false);
  assert.equal(elements.get("game-menu").inert, false);
  assert.ok(animations.every(animation => animation.cancelled));
});

test("reduced motion uses only a brief fade before starting", async testing => {
  const { menu, animations } = createMenuHarness(testing, { reduced: true });
  let starts = 0;
  const pending = menu.transitionToGame(() => { starts++; });
  assert.equal(animations[0].options.duration, 120);
  assert.equal(animations[0].keyframes.length, 2);
  animations[0].finish();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(starts, 1);
  animations.at(-1).finish();
  await pending;
});

test("in-game transitions retain their existing cover and reveal timing", async testing => {
  const { menu, session, animations } = createMenuHarness(testing);
  session.play();
  session.pause();
  menu.render();
  let covered = 0;
  const pending = menu.transitionToGame(() => { covered++; });
  assert.equal(animations.length, 1);
  assert.equal(animations[0].options.duration, 450);
  animations[0].finish();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(covered, 1);
  assert.equal(animations[1].options.duration, 650);
  animations[1].finish();
  await pending;
});

test("disposing a menu during its launch cancels the pending start", async testing => {
  const { menu, root } = createMenuHarness(testing);
  let starts = 0;
  const pending = menu.transitionToGame(() => { starts++; });
  menu.dispose();
  await pending;
  assert.equal(starts, 0);
  assert.equal(root.removed, true);
});

test("the black overlay waits for asynchronous initialization before revealing gameplay", async testing => {
  const { menu, animations, elements } = createMenuHarness(testing);
  let finishInitialization;
  const initialization = new Promise(resolve => { finishInitialization = resolve; });
  const pending = menu.transitionToGame(() => initialization);
  animations[0].finish();
  await Promise.resolve();
  assert.equal(elements.get("screen-fade").style.opacity, "1");
  assert.equal(animations.length, 1);
  finishInitialization();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(animations.length, 2);
  animations[1].finish();
  await pending;
});

test("failed initialization restores an interactive title and a readable error", async testing => {
  const { menu, animations, elements, session } = createMenuHarness(testing);
  const pending = menu.transitionToGame(async () => { throw new Error("Initialization failed"); });
  animations[0].finish();
  await assert.rejects(pending, /Initialization failed/);
  assert.equal(session.screen, "home");
  assert.equal(menu.transitioning, false);
  assert.equal(elements.get("play-button").disabled, false);
  assert.equal(elements.get("play-label").textContent, "Start exploring");
  assert.match(elements.get("menu-status").textContent, /Could not establish connection/);
  assert.equal(elements.get("screen-fade").style.opacity, "0");
  assert.equal(elements.get("home-transmission").hidden, false);
});

test("declined mouse capture unlocks a pending activation for retry", testing => {
  const { menu, elements } = createMenuHarness(testing);
  elements.get("play-button").events.get("click")();
  assert.equal(elements.get("play-button").disabled, true);
  menu.failStart("Mouse capture was declined. Try again.");
  assert.equal(elements.get("play-button").disabled, false);
  assert.equal(elements.get("play-label").textContent, "Start exploring");
  assert.equal(elements.get("menu-status").textContent, "Mouse capture was declined. Try again.");
});

test("cancellation while initialization is pending does not resurrect a fade overlay", async testing => {
  const { menu, animations, elements } = createMenuHarness(testing);
  let finishInitialization;
  const initialization = new Promise(resolve => { finishInitialization = resolve; });
  const pending = menu.transitionToGame(() => initialization);
  animations[0].finish();
  await Promise.resolve();
  menu.cancelTransition();
  finishInitialization();
  await pending;
  assert.equal(animations.length, 1);
  assert.equal(elements.get("screen-fade").style.opacity, "0");
  assert.equal(elements.get("play-button").disabled, false);
});
