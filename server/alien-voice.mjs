import { SURVEY_NARRATION } from "../src/survey-dialogue.mjs";
import { STORY_DIALOGUE } from "../src/ice-dialogue.mjs";
import { FARMERS } from "../src/farmer-profiles.mjs";
import { buildAlignedCaptionCues } from "../src/caption-timing.mjs";
import { APOLLO_DIALOGUE } from "../src/apollo-dialogue.mjs";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { GardenMission, surveyDialogue } from "../src/garden-mission.js";

const ROLE_VOICES = {
  Soilkeeper: "JBFqnCBsd6RMkjVDRZzb", // George: Iri and Tavi
  Grower: "EXAVITQu4vr4xnSDxMaL", // Sarah: Vela and Seli
  Seedkeeper: "onwK4e9ZLuTAKqWW03F9", // Daniel: Naru and Oru
};
export const FARMER_VOICES = Object.fromEntries(FARMERS.map(farmer => [farmer.name, ROLE_VOICES[farmer.role]]));

// Every Apollo utterance uses this voice, including the intro and verification feedback.
export const APOLLO_VOICE = "onwK4e9ZLuTAKqWW03F9"; // Daniel

export const STORY_VOICES = {
  Apollo: APOLLO_VOICE,
  Narrator: "JBFqnCBsd6RMkjVDRZzb", // George, whispered cinematic narration
  "Gray colonist": "JBFqnCBsd6RMkjVDRZzb", // George, including the downed alien
  "Company guard": "cjVigY5qzO86Huf0OWal", // Eric
};
const storyReply = body => [...STORY_DIALOGUE, ...SURVEY_NARRATION].find(entry => entry.voiceSpeaker === body?.farmer && entry.text === body?.text);

function apolloScript() {
  const messages = new Set(Object.values(APOLLO_DIALOGUE));
  const remember = mission => {
    messages.add(mission.apolloMessage);
    messages.add(mission.returnMessage);
    for (const line of surveyDialogue(mission, { name: "Iri", role: "Farmer" }, { x: 0, z: 0 })) {
      if (line.speaker.startsWith("Apollo")) messages.add(line.text);
    }
    messages.add(new GardenMission(mission.serialize()).apolloMessage);
  };
  remember(new GardenMission());
  for (let mask = 0; mask < 8; mask++) {
    for (const water of [false, true]) {
      const mission = new GardenMission();
      mission.learnGrowth(); remember(mission);
      if (water) { mission.learnWater({ x: 0, z: 0 }); remember(mission); }
      for (const [index, sample] of ["soil", "tomato", "wheat"].entries()) {
        if (mask & (1 << index)) { mission.collect(sample, "shovel"); remember(mission); }
      }
      for (const sample of ["soil", "tomato", "wheat"]) {
        const next = new GardenMission(mission.serialize());
        next.collect(sample, "shovel"); remember(next);
      }
      if (mission.beginDeposit()) {
        mission.cancelDeposit(); remember(mission);
        mission.beginDeposit(); mission.finishDeposit(); remember(mission);
      }
    }
  }
  return messages;
}
const APOLLO_SCRIPT = apolloScript();
export function isAllowedDialogueReply(body) {
  if (storyReply(body)) return true;
  if (body?.farmer === "Apollo") return typeof body.text === "string" && APOLLO_SCRIPT.has(body.text);
  return isAllowedFarmerReply(body);
}

export function isAllowedFarmerReply({ text, farmer, site }) {
  if (!Object.hasOwn(FARMER_VOICES, farmer) || typeof text !== "string" || text.length > 1600 ||
      !Number.isFinite(site?.x) || !Number.isFinite(site?.z) || Math.abs(site.x) > 100000 || Math.abs(site.z) > 100000) return false;
  const profile = { name: farmer, role: "Farmer" };
  const mission = new GardenMission();
  const replies = [...surveyDialogue(mission, profile, site)];
  mission.explained = true;
  replies.push(...surveyDialogue(mission, profile, site));
  mission.waterKnown = true;
  replies.push(...surveyDialogue(mission, profile, site));
  return replies.some(entry => entry.dub === true && !entry.speaker.startsWith("Apollo") && entry.text === text);
}

export function createAlienVoiceHandler({ client = new ElevenLabsClient(), now = Date.now } = {}) {
  const cache = new Map(), pending = new Map(), requests = new Map();
  let cacheBytes = 0;
  return async (req, res, next) => {
    if (!["/api/dialogue-voice", "/api/alien-voice"].includes(req.url?.split("?")[0])) return next();
    const send = (status, error) => {
      res.statusCode = status; res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error }));
    };
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return send(405, "Use POST."); }
    try {
      if (req.headers["sec-fetch-site"] === "cross-site" ||
          (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)) return send(403, "Origin not allowed.");
    } catch { return send(403, "Origin not allowed."); }
    let body;
    try {
      const chunks = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 8192) return send(413, "Request too large.");
        chunks.push(Buffer.from(chunk));
      }
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!body || !isAllowedDialogueReply(body)) return send(400, "Choose a scripted dialogue reply.");
    } catch { return send(400, "Invalid voice request."); }
    const scripted = storyReply(body);
    const spokenText = scripted?.speechText ?? body.text;
    const voice = scripted ? STORY_VOICES[scripted.voiceSpeaker] : body.farmer === "Apollo" ? APOLLO_VOICE : FARMER_VOICES[body.farmer];
    const model = (body.farmer === "Apollo" || scripted?.emotional) ? "eleven_v4" : "eleven_flash_v2_5";
    const timed = body.includeTimestamps === true;
    const key = `${model}:${voice}:${timed}:${spokenText}`;
    try {
      if (!cache.has(key) && !pending.has(key)) {
        const time = now(), ip = req.socket.remoteAddress || "local";
        for (const [address, entry] of requests) if (time - entry.start > 60000) requests.delete(address);
        const entry = requests.get(ip) ?? { start: time, count: 0 };
        if (entry.count >= 12 || requests.size >= 512 || pending.size >= 4) return send(429, "Voice service busy. Try again shortly.");
        entry.count++; requests.set(ip, entry);
        const generated = (async () => {
          const options = {
            text: spokenText, modelId: model, outputFormat: "mp3_44100_128",
            voiceSettings: { stability: scripted?.emotional ? 0.35 : body.farmer === "Apollo" ? 0.5 : 0.55, similarityBoost: 0.75 },
          };
          const requestOptions = { timeoutInSeconds: 45, maxRetries: 0 };
          let buffer;
          if (timed) {
            const speech = await client.textToSpeech.convertWithTimestamps(voice, options, requestOptions);
            const cues = buildAlignedCaptionCues(speech.normalizedAlignment ?? speech.alignment);
            if (!speech.audioBase64 || !cues.length) throw new Error("Missing speech timing");
            buffer = Buffer.from(JSON.stringify({ audioBase64: speech.audioBase64, cues }));
          } else {
            const stream = await client.textToSpeech.convert(voice, options, requestOptions);
            buffer = Buffer.from(await new Response(stream).arrayBuffer());
          }
          if (!buffer.length || buffer.length > 4 * 1024 * 1024) throw new Error("Invalid voice audio");
          while (cache.size >= 64 || cacheBytes + buffer.length > 24 * 1024 * 1024) {
            const first = cache.keys().next().value;
            cacheBytes -= cache.get(first).length; cache.delete(first);
          }
          cache.set(key, buffer); cacheBytes += buffer.length;
          return buffer;
        })();
        pending.set(key, generated);
        generated.finally(() => pending.delete(key)).catch(() => {});
      }
      const audio = cache.get(key) ?? await pending.get(key);
      if (res.destroyed) return;
      res.statusCode = 200;
      res.setHeader("Content-Type", timed ? "application/json" : "audio/mpeg");
      res.setHeader("Content-Length", String(audio.length));
      res.end(audio);
    } catch { if (!res.destroyed) send(503, "Dialogue voice unavailable. Continue using the displayed text."); }
  };
}

export const createDialogueVoiceHandler = createAlienVoiceHandler;
