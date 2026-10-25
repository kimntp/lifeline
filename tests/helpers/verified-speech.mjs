// Existing mission/layout tests isolate speech recognition; dedicated speech tests use the real state machine.
export function verifiedSpeechFactory() {
  return { state: { status: "verified" }, reset() {}, cancel() {}, destroy() {}, async start() {} };
}

export function silentDubbingFactory() {
  return { busy: false, stop() {}, destroy() {}, setPaused() {}, async start() {} };
}
