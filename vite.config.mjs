import { createDialogueVoiceHandler } from "./server/alien-voice.mjs";
import { defineConfig, loadEnv } from "vite";
import { createScribeTokenHandler } from "./server/scribe-token.mjs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (env.ELEVENLABS_API_KEY) process.env.ELEVENLABS_API_KEY = env.ELEVENLABS_API_KEY;
  return {
    plugins: [{
      name: "elevenlabs-speech-token",
      configureServer(server) { server.middlewares.use(createScribeTokenHandler()); server.middlewares.use(createDialogueVoiceHandler()); },
      configurePreviewServer(server) { server.middlewares.use(createScribeTokenHandler()); server.middlewares.use(createDialogueVoiceHandler()); },
    }],
  };
});
