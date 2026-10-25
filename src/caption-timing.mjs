export function buildCaptionCues(words) {
  const cues = [];
  let cue = null;
  for (const word of words ?? []) {
    if (word.type !== "word" || !word.text?.trim() ||
        !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.end < word.start) continue;
    const text = word.text.trim();
    if (cue && (word.start - cue.end > 0.8 || word.end - cue.start > 5 ||
        cue.text.length + text.length + 1 > 72)) {
      cues.push(cue);
      cue = null;
    }
    if (!cue) cue = { start: word.start, end: word.end, text };
    else {
      cue.text += ` ${text}`;
      cue.end = word.end;
    }
    if (/[.!?]["??']?$/.test(text)) {
      cues.push(cue);
      cue = null;
    }
  }
  if (cue) cues.push(cue);
  return cues;
}

export function captionAtTime(cues, time) {
  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const cue = cues[mid];
    if (time < cue.start) hi = mid - 1;
    else if (time >= cue.end) lo = mid + 1;
    else return cue.text;
  }
  return "";
}

// Without word timestamps, spread readable pages across the audio duration.
export function buildScriptCues(text, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const pages = [];
  for (const sentence of text.match(/[^.!?]+(?:[.!?]+|$)/g) ?? []) {
    let page = "";
    for (const word of sentence.trim().split(/\s+/)) {
      if (page && page.length + word.length + 1 > 110) {
        pages.push(page);
        page = "";
      }
      page += (page ? " " : "") + word;
    }
    if (page) pages.push(page);
  }
  const weights = pages.map(page => page.split(/\s+/).length + (/[.!?]$/.test(page) ? 0.8 : 0.2));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;
  return pages.map((page, i) => {
    const start = cursor;
    cursor += duration * weights[i] / total;
    return { text: page, start, end: i === pages.length - 1 ? duration : cursor };
  });
}

export function progressiveCaptionAtTime(cues, time) {
  const cue = cues.find(cue => time >= cue.start && time < cue.end);
  if (!cue) return "";
  const words = cue.text.split(/\s+/);
  // Finish the line early enough to read it before the next page appears.
  const progress = Math.min(1, (time - cue.start) / ((cue.end - cue.start) * 0.85));
  const count = Math.min(words.length, 1 + Math.floor(progress * words.length));
  return words.slice(0, count).join(" ");
}
