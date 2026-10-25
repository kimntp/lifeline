import assert from "node:assert/strict";
import test from "node:test";
import { GameSession, createGameMenu } from "../src/game-menu.js";

test("home stays paused and cannot start until the world finishes loading", () => {
  const session = new GameSession();
  assert.equal(session.screen, "home");
  assert.equal(session.paused, true);
  assert.equal(session.play(), false);
  assert.equal(session.started, false);
  session.ready = true;
  assert.equal(session.play(), true);
  assert.equal(session.paused, false);
  assert.equal(session.started, true);
});

test("pause, instructions, animation previews and resume preserve the session", () => {
  const session = new GameSession();
  session.ready = true;
  session.play();
  session.pause();
  assert.equal(session.screen, "paused");
  assert.equal(session.paused, true);
  for (const screen of ["instructions", "animations"]) {
    session.open(screen);
    assert.equal(session.screen, screen);
    assert.equal(session.paused, true);
    session.back();
    assert.equal(session.screen, "paused");
  }
  session.play();
  assert.equal(session.paused, false);
});

test("home instructions return to home before or after a game has started", () => {
  const session = new GameSession();
  for (let i = 0; i < 2; i++) {
    session.open("instructions");
    session.back();
    assert.equal(session.screen, "home");
    session.pause();
    assert.equal(session.screen, "home");
    session.ready = true;
    session.play();
    session.home();
    assert.equal(session.paused, true);
  }
  session.play();
  assert.equal(session.started, true);
});

test("losing mouse capture preserves an open submenu", () => {
  const session = new GameSession();
  session.ready = true;
  session.play();
  session.pause();
  session.open("instructions");
  session.pause();
  assert.equal(session.screen, "instructions");
  session.back();
  assert.equal(session.screen, "paused");
});

test("home screen renders its real logo and start button, then switches to pause and back", () => {
  const originalDocument = globalThis.document;
  const originalOption = globalThis.Option;
  const elements = new Map();
  const root = {
    set innerHTML(html) {
      for (const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
        const classes = new Set();
        const events = new Map();
        elements.set(match[1], {
          hidden: /\bhidden(?:\s|>|=)/.test(match[0]),
          disabled: /\bdisabled(?:\s|>|=)/.test(match[0]),
          textContent: "", style: {}, attributes: new Map(),
          classList: { toggle(name, value) { if (value) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) },
          addEventListener(name, callback) { events.set(name, callback); },
          setAttribute(name, value) { this.attributes.set(name, value); },
          focus() { globalThis.document.activeElement = this; },
          getContext() { return null; },
          add() {}, events,
        });
      }
    },
    querySelector(selector) { return elements.get(selector.slice(1)) ?? null; },
  };
  globalThis.document = { createElement: () => root, body: { appendChild() {} }, activeElement: null };
  globalThis.Option = class {};
  try {
    const session = new GameSession();
    let starts = 0;
    const noop = () => {};
    const menu = createGameMenu({ session, clips: [], onPlay: () => { starts++; }, onPause: noop,
      onNavigate: noop, onPreview: noop, onMoveBase: noop, onMoveColony: noop, onSetSpawn: noop, onIceBase: noop });
    assert.doesNotThrow(() => menu.render());
    assert.equal(elements.has("logo-placeholder"), false);
    assert.equal(elements.get("home-logo").hidden, false);
    assert.equal(elements.get("instructions-button").hidden, true);
    assert.equal(elements.get("play-button").disabled, true);
    assert.equal(elements.has("home-video"), false);
    assert.equal(elements.get("home-stars").hidden, false);
    assert.equal(elements.get("home-background").hidden, false);
    assert.equal(elements.get("home-ship").hidden, false);
    assert.equal(elements.get("home-transmission").hidden, false);
    session.ready = true;
    menu.render();
    assert.equal(elements.get("play-button").disabled, false);
    assert.equal(elements.get("play-label").textContent, "Start exploring");
    elements.get("play-button").events.get("click")();
    assert.equal(starts, 1);
    session.play(); menu.render();
    assert.equal(elements.get("game-menu").hidden, true);
    assert.equal(elements.get("home-stars").hidden, true);
    assert.equal(elements.get("home-background").hidden, true);
    assert.equal(elements.get("home-ship").hidden, true);
    assert.equal(elements.get("home-transmission").hidden, true);
    session.pause(); menu.render();
    assert.equal(elements.get("home-logo").hidden, true);
    assert.equal(elements.get("home-background").hidden, true);
    assert.equal(elements.get("instructions-button").hidden, false);
    assert.equal(elements.get("play-label").textContent, "Resume");
    session.home(); menu.render();
    assert.equal(elements.get("home-logo").hidden, false);
    assert.equal(elements.get("home-stars").hidden, false);
    assert.equal(elements.get("home-background").hidden, false);
    assert.equal(elements.get("play-label").textContent, "Continue exploring");
  } finally {
    globalThis.document = originalDocument;
    globalThis.Option = originalOption;
  }
});
