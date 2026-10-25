// This module is server-only. Never import it from src/.
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

export function createScribeTokenHandler({ client = new ElevenLabsClient(), now = Date.now } = {}) {
  const requests = new Map();
  return async (req, res, next) => {
    if (req.url?.split("?")[0] !== "/api/scribe-token") return next();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    const send = (status, message) => { res.statusCode = status; res.end(JSON.stringify(message)); };
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return send(405, { error: "Use POST." });
    }
    if (req.headers["sec-fetch-site"] === "cross-site") return send(403, { error: "Cross-site request denied." });
    if (req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host) return send(403, { error: "Origin not allowed." });
      } catch { return send(403, { error: "Invalid origin." }); }
    }
    const time = now();
    for (const [ip, entry] of requests) if (time - entry.start >= 60000) requests.delete(ip);
    const ip = req.socket.remoteAddress || "local";
    const entry = requests.get(ip) ?? { start: time, count: 0 };
    if (entry.count >= 12 || requests.size >= 512) return send(429, { error: "Too many attempts. Try again shortly." });
    entry.count++;
    requests.set(ip, entry);
    try {
      const result = await client.tokens.singleUse.create("realtime_scribe");
      if (!result.token) throw new Error("Missing token");
      send(200, { token: result.token });
    } catch {
      send(503, { error: "Speech service unavailable. Check the server's ElevenLabs configuration." });
    }
  };
}
