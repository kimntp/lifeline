import test from "node:test";
import assert from "node:assert/strict";
import { dialogueTextHtml, renderDialogueText } from "../src/dialogue-text.mjs";

test("both mentions use lavender markup with the requested capitalization and preserve punctuation", () => {
  assert.equal(dialogueTextHtml("Our final lifeline."), 'Our final <span class="dialogue-highlight">Lifeline</span>.');
  assert.equal(dialogueTextHtml("Be our Lifeline."), 'Be our <span class="dialogue-highlight">Lifeline</span>.');
  assert.equal(dialogueTextHtml("lifelife"), '<span class="dialogue-highlight">Lifeline</span>');
  assert.equal(dialogueTextHtml("A lifeliner"), "A lifeliner");
});

test("word reveal, completion, and plain text fallback keep highlighting safe", () => {
  const element = { textContent: "", innerHTML: "" };
  renderDialogueText(element, "Be our"); assert.equal(element.textContent, "Be our");
  renderDialogueText(element, "Be our lifeline."); assert.equal(element.textContent, "Be our Lifeline.");
  assert.match(element.innerHTML, /dialogue-highlight/);
  renderDialogueText(element, "<img> & Lifeline");
  assert.match(element.innerHTML, /&lt;img&gt; &amp;/);
  assert.doesNotMatch(element.innerHTML, /<img>/);
});
