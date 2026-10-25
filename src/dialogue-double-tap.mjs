export function createDialogueDoubleTap(windowMs = 350) {
  let previous = null;
  return {
    press(now) {
      const double = previous !== null && now >= previous && now - previous <= windowMs;
      previous = double ? null : now;
      return double;
    },
    reset() { previous = null; },
  };
}
