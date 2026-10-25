import test from "node:test";
import assert from "node:assert/strict";
import { createDialogueDoubleTap } from "../src/dialogue-double-tap.mjs";

test("two separate taps complete once; slow taps and a new line do not", () => {
  const tap = createDialogueDoubleTap();
  assert.equal(tap.press(0), false);
  assert.equal(tap.press(200), true);
  assert.equal(tap.press(250), false);
  tap.reset();
  assert.equal(tap.press(300), false);
  assert.equal(tap.press(1000), false);
  assert.equal(tap.press(1200), true);
});
