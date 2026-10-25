// Only temporary single-use tokens enter the browser; the API key stays on the server.
export async function connectSpeechAttempt({ signal, onReady, onPartial, onCommit, onError }) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone requires localhost or HTTPS.");
  const [response, { Scribe, RealtimeEvents, CommitStrategy }] = await Promise.all([
    fetch(`${import.meta.env.BASE_URL}api/scribe-token`, { method: "POST", signal }),
    import("@elevenlabs/client"),
  ]);
  if (!response.ok) throw new Error("Speech connection unavailable.");
  const { token } = await response.json();
  signal.throwIfAborted();
  if (typeof token !== "string" || !token) throw new Error("Missing speech token.");
  let closed = false;
  const connection = Scribe.connect({
    token, modelId: "scribe_v2_realtime", commitStrategy: CommitStrategy.VAD,
    vadSilenceThresholdSecs: 1.5, languageCode: "en",
    microphone: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const close = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener("abort", close);
    connection.close();
  };
  signal.addEventListener("abort", close, { once: true });
  connection.on(RealtimeEvents.SESSION_STARTED, () => {
    if (closed || signal.aborted) { connection.close(); return; }
    onReady();
  });
  connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, data => { if (!closed) onPartial(data.text ?? ""); });
  connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, data => { if (!closed) onCommit(data.text ?? ""); });
  connection.on(RealtimeEvents.ERROR, () => { if (!closed) onError(); });
  connection.on(RealtimeEvents.CLOSE, () => { if (!closed) onError(); });
  if (signal.aborted) close();
  return { close };
}
