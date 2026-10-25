import { APOLLO_DIALOGUE } from "../src/apollo-dialogue.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createAlienVoiceHandler, FARMER_VOICES, isAllowedFarmerReply, APOLLO_VOICE, isAllowedDialogueReply } from "../server/alien-voice.mjs";
import { GardenMission, surveyDialogue } from "../src/garden-mission.js";

const site = { x: 0, z: 0 };
const text = surveyDialogue(new GardenMission(), { name: "Iri", role: "Farmer" }, site).find(entry => entry.dub).text;
const input = { farmer: "Iri", text, site };
async function call(handler, body = input, origin = "http://localhost:5173") {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.url = "/api/alien-voice"; req.method = "POST";
  req.headers = { origin, host: "localhost:5173" }; req.socket = { remoteAddress: "127.0.0.1" };
  let output; const headers = {};
  const res = { statusCode: 200, setHeader(k, v) { headers[k] = v; }, end(data) { output = data; } };
  await handler(req, res, () => {});
  return { status: res.statusCode, output, headers };
}
function fakeClient(convert) { return { textToSpeech: { convert } }; }
const stream = () => new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } });

test("farmer voices are distinct and only scripted alien replies are permitted", () => {
  assert.equal(new Set(Object.values(FARMER_VOICES)).size, 3);
  assert.equal(isAllowedFarmerReply(input), true);
  assert.equal(isAllowedFarmerReply({ ...input, farmer: "Apollo" }), false);
  assert.equal(isAllowedFarmerReply({ ...input, text: "arbitrary paid speech" }), false);
  assert.equal(isAllowedFarmerReply({ ...input, site: { x: Infinity, z: 0 } }), false);
  const mission = new GardenMission(); mission.explained = true;
  const water = surveyDialogue(mission, { name: "Naru", role: "Farmer" }, site).find(entry => entry.dub).text;
  assert.equal(isAllowedFarmerReply({ farmer: "Naru", text: water, site }), true);
});

test("server returns MP3, caches repeats, and uses the correct farmer voice", async () => {
  let calls = 0, voice;
  const handler = createAlienVoiceHandler({ client: fakeClient(async (id, request) => {
    calls++; voice = id; assert.equal(request.text, text); return stream();
  }) });
  const first = await call(handler);
  assert.equal(first.status, 200);
  assert.equal(first.headers["Content-Type"], "audio/mpeg");
  assert.equal(voice, FARMER_VOICES.Iri);
  assert.deepEqual(first.output, Buffer.from([1, 2, 3]));
  await call(handler);
  assert.equal(calls, 1);
});

test("concurrent identical replies share one generation; invalid requests never call ElevenLabs", async () => {
  let calls = 0;
  const handler = createAlienVoiceHandler({ client: fakeClient(async () => { calls++; await new Promise(done => setTimeout(done, 10)); return stream(); }) });
  const results = await Promise.all([call(handler), call(handler)]);
  assert.ok(results.every(result => result.status === 200));
  assert.equal(calls, 1);
  assert.equal((await call(handler, { ...input, text: "unapproved" })).status, 400);
  assert.equal((await call(handler, input, "https://other.example")).status, 403);
  assert.equal(calls, 1);
});

test("voice errors do not expose credentials and are not cached", async () => {
  let calls = 0;
  const handler = createAlienVoiceHandler({ client: fakeClient(async () => { calls++; throw new Error("private provider error"); }) });
  const result = await call(handler);
  assert.equal(result.status, 503);
  assert.doesNotMatch(String(result.output), /private provider error/);
  await call(handler);
  assert.equal(calls, 2);
});


test("Apollo intro, dialogue, verification feedback and mission updates all use one voice", async () => {
  const texts = new Set(Object.values(APOLLO_DIALOGUE));
  const remember = mission => {
    texts.add(mission.apolloMessage);
    for (const line of surveyDialogue(mission, { name: "Iri", role: "Farmer" }, site)) {
      if (line.speaker.startsWith("Apollo")) texts.add(line.text);
    }
  };
  remember(new GardenMission());
  for (const order of [["soil", "tomato", "wheat"], ["tomato", "wheat", "soil"], ["wheat", "soil", "tomato"]]) {
    const mission = new GardenMission(); mission.learnGrowth(); remember(mission);
    mission.learnWater(site); remember(mission);
    for (const sample of order) { mission.collect(sample); remember(mission); }
    mission.beginDeposit(); mission.finishDeposit(); remember(mission);
    remember(new GardenMission(mission.serialize()));
  }
  let calls = 0;
  const handler = createAlienVoiceHandler({ now: () => calls * 61000, client: fakeClient(async (voice, request) => {
    assert.equal(voice, APOLLO_VOICE);
    assert.ok(texts.has(request.text));
    calls++; return stream();
  }) });
  for (const text of texts) {
    const payload = { farmer: "Apollo", text };
    assert.equal(isAllowedDialogueReply(payload), true, text);
    assert.equal((await call(handler, payload)).status, 200, text);
  }
  assert.equal(isAllowedDialogueReply({ farmer: "Apollo", text: "arbitrary unapproved speech" }), false);
});
