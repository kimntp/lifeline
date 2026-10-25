import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { buildCaptionCues } from "../src/caption-timing.mjs";

const root = new URL("../", import.meta.url);
const envFile = new URL(".env", root);
if (existsSync(envFile)) loadEnvFile(envFile);

try {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key || key === "your_elevenlabs_api_key_here") {
    throw new Error("Set ELEVENLABS_API_KEY in .env first (copy .env.example). Keep the key local.");
  }
  const source = new URL("public/assets/audio/Apollo Intro.mp3", root);
  const output = new URL("public/assets/audio/apollo-intro.captions.json", root);
  const form = new FormData();
  form.append("file", new Blob([await readFile(source)], { type: "audio/mpeg" }), "Apollo Intro.mp3");
  form.append("model_id", "scribe_v2");
  form.append("timestamps_granularity", "word");
  form.append("tag_audio_events", "false");
  console.log("Uploading Apollo Intro.mp3 to ElevenLabs for timed transcription...");
  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST", headers: { "xi-api-key": key }, body: form,
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) {
    throw new Error(`ElevenLabs returned HTTP ${response.status}. Check your key, speech-to-text permission, and account credits.`);
  }
  const transcript = await response.json();
  const cues = buildCaptionCues(transcript.words);
  if (!cues.length) throw new Error("ElevenLabs returned no timed speech. Existing captions were kept.");
  await writeFile(output, JSON.stringify({ speaker: "Apollo", text: transcript.text, cues }, null, 2) + "\n");
  console.log(`Saved ${cues.length} timed captions. Refresh the game to load them.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
