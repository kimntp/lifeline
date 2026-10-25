import assert from "node:assert/strict";
import test from "node:test";
import { GameSession } from "../src/game-menu.js";

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
