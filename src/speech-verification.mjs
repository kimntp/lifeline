const contractions = {
  "i'm": "i am", "i'll": "i will", "i've": "i have", "we're": "we are", "we'll": "we will",
  "we've": "we have", "you're": "you are", "you'll": "you will", "you've": "you have",
  "they're": "they are", "they'll": "they will", "they've": "they have",
  "it's": "it is", "that's": "that is", "what's": "what is", "how's": "how is",
  "don't": "do not", "doesn't": "does not", "didn't": "did not", "isn't": "is not",
  "aren't": "are not", "wasn't": "was not", "weren't": "were not", "can't": "cannot",
  "won't": "will not", "couldn't": "could not", "wouldn't": "would not", "shouldn't": "should not",
};
export function normalizeSpeech(text) {
  return String(text).toLowerCase().replace(/[\u2018\u2019]/g, "'")
    .replace(/\b[a-z]+(?:'[a-z]+)+\b/g, word => contractions[word] ?? word)
    .replace(/[^a-z0-9\s]/g, " ").trim().replace(/\s+/g, " ");
}
export function compareDialogue(expected, spoken) {
  const expectedText = normalizeSpeech(expected), actualText = normalizeSpeech(spoken);
  const target = expectedText ? expectedText.split(" ") : [];
  const actual = actualText ? actualText.split(" ") : [];
  const table = Array.from({ length: target.length + 1 }, () => new Uint16Array(actual.length + 1));
  for (let i = target.length - 1; i >= 0; i--) {
    for (let j = actual.length - 1; j >= 0; j--) {
      table[i][j] = target[i] === actual[j] ? 1 + table[i + 1][j + 1] : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const missing = [], unexpected = [];
  let i = 0, j = 0;
  while (i < target.length || j < actual.length) {
    if (i < target.length && j < actual.length && target[i] === actual[j]) { i++; j++; }
    else if (i < target.length && (j === actual.length || table[i + 1][j] >= table[i][j + 1])) missing.push(target[i++]);
    else unexpected.push(actual[j++]);
  }
  return {
    match: Boolean(expectedText) && expectedText === actualText,
    prefix: actual.length > 0 && actual.length < target.length && actual.every((word, index) => target[index] === word),
    missing, unexpected,
  };
}

// Map matched normalized tokens back to the original displayed words.
// Recompute for every partial result because the recognizer can revise it.
export function speechWordFeedback(expected, spoken, final = false) {
  const words = String(expected).match(/\S+/g) ?? [];
  const tokens = [], ranges = [];
  for (const text of words) {
    const start = tokens.length;
    const normalized = normalizeSpeech(text);
    if (normalized) tokens.push(...normalized.split(" "));
    ranges.push({ text, start, end: tokens.length });
  }
  const heard = normalizeSpeech(spoken);
  const actual = heard ? heard.split(" ") : [];
  const table = Array.from({ length: tokens.length + 1 }, () => new Uint16Array(actual.length + 1));
  for (let i = tokens.length - 1; i >= 0; i--) {
    for (let j = actual.length - 1; j >= 0; j--) {
      table[i][j] = tokens[i] === actual[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const matched = new Set();
  let i = 0, j = 0;
  while (i < tokens.length && j < actual.length) {
    if (tokens[i] === actual[j]) { matched.add(i++); j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return ranges.map(({ text, start, end }) => ({
    text,
    status: end > start && Array.from({ length: end - start }, (_, index) => start + index).every(index => matched.has(index))
      ? "correct" : final && end > start ? "missed" : "pending",
  }));
}

export function createSpeechChallenge({ connect, onChange = () => {}, timeoutMs = 45000 }) {
  let generation = 0, connection = null, abort = null, timer = null;
  let state = { status: "idle", expected: "", transcript: "", message: "Press V to speak the displayed line.", missing: [], unexpected: [] };
  const emit = patch => { state = { ...state, ...patch }; onChange({ ...state }); };
  function stop() {
    generation++;
    clearTimeout(timer); timer = null;
    abort?.abort(); abort = null;
    connection?.close(); connection = null;
  }
  return {
    get state() { return { ...state }; },
    reset(expected) {
      stop();
      emit({ status: "idle", expected, transcript: "", missing: [], unexpected: [], message: "Press V to speak the displayed line. Pause after speaking." });
    },
    cancel() {
      if (!["connecting", "listening"].includes(state.status)) return;
      stop();
      emit({ status: "idle", transcript: "", message: "Recording stopped. Press V to try again.", missing: [], unexpected: [] });
    },
    destroy() { stop(); },
    async start() {
      if (!state.expected || ["connecting", "listening", "verified"].includes(state.status)) return;
      stop();
      const attempt = generation;
      abort = new AbortController();
      const committed = [];
      emit({ status: "connecting", transcript: "", missing: [], unexpected: [], message: "Connecting microphone... Allow microphone access if asked." });
      const fail = message => {
        if (attempt !== generation) return;
        stop();
        emit({ status: "error", message });
      };
      timer = setTimeout(() => fail("No complete attempt received. Press V to try again."), timeoutMs);
      try {
        const opened = await connect({
          signal: abort.signal,
          onReady: () => {
            if (attempt === generation) emit({ status: "listening", message: "Listening. Read the line, then pause. V cancels." });
          },
          onPartial: text => {
            if (attempt === generation) emit({ transcript: [...committed, text].filter(Boolean).join(" ") });
          },
          onCommit: text => {
            if (attempt !== generation || !normalizeSpeech(text)) return;
            committed.push(text);
            const transcript = committed.join(" ");
            const result = compareDialogue(state.expected, transcript);
            if (result.match) {
              stop();
              emit({ status: "verified", transcript, missing: [], unexpected: [], message: "" });
            } else if (result.prefix) {
              emit({ status: "listening", transcript, message: "Keep going. Finish the displayed line, then pause." });
            } else {
              stop();
              emit({ status: "retry", transcript, missing: result.missing, unexpected: result.unexpected,
                message: "Incorrect. Press V and repeat the complete line." });
            }
          },
          onError: () => fail("Speech recognition is unavailable. Check microphone permission and connection, then press V to retry."),
        });
        if (attempt !== generation) opened?.close();
        else connection = opened;
      } catch (error) {
        if (attempt !== generation) return;
        fail(error.name === "NotAllowedError"
          ? "Microphone access was denied. Allow it in browser settings, then press V to retry."
          : "Could not start speech recognition. Check microphone access and connection, then press V to retry.");
      }
    },
  };
}
