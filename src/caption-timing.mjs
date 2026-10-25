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

// Fill a page with whole sentences while retaining each word's original timing.
export function groupCaptionPages(sentences, maxCharacters = 320) {
  const pages = [];
  for (const sentence of sentences) {
    const previous = pages.at(-1);
    const compatible = previous && ((previous.words && sentence.words) || (!Number.isFinite(previous.start) && !Number.isFinite(sentence.start)));
    if (compatible && previous.text.length + sentence.text.length + 1 <= maxCharacters) {
      previous.text += ` ${sentence.text}`;
      previous.end = sentence.end;
      if (sentence.words) previous.words = [...(previous.words ?? []), ...sentence.words];
    } else pages.push({ ...sentence, ...(sentence.words ? { words: [...sentence.words] } : {}) });
  }
  return pages;
}

// Without word timestamps, spread readable pages across the audio duration.
export function buildScriptCues(text, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const sentences = [];
  for (const sentence of text.match(/[^.!?]+(?:[.!?]+|$)/g) ?? []) {
    const page = sentence.trim().replace(/\s+/g, " ");
    if (page) sentences.push({ text: page });
  }
  const pages = groupCaptionPages(sentences).map(page => page.text);
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
  if (cue.words?.length) return cue.words.filter(word => word.start <= time).map(word => word.text).join(" ");
  const words = cue.text.split(/\s+/);
  // Finish the line early enough to read it before the next page appears.
  const progress = Math.min(1, (time - cue.start) / ((cue.end - cue.start) * 0.85));
  const count = Math.min(words.length, 1 + Math.floor(progress * words.length));
  return words.slice(0, count).join(" ");
}


// Provider timestamps define sentence boundaries and word reveals, not an estimated reading speed.
export function buildAlignedCaptionCues(alignment) {
  const characters = alignment?.characters;
  const starts = alignment?.characterStartTimesSeconds ?? alignment?.character_start_times_seconds;
  const ends = alignment?.characterEndTimesSeconds ?? alignment?.character_end_times_seconds;
  if (!Array.isArray(characters) || !Array.isArray(starts) || !Array.isArray(ends) ||
      characters.length !== starts.length || characters.length !== ends.length) return [];
  const letters = [], timing = [];
  characters.forEach((part, index) => {
    for (const character of String(part)) { letters.push(character); timing.push({ start: starts[index], end: ends[index] }); }
  });
  const text = letters.join("");
  const tags = [...text.matchAll(/\[[^\]]*\]/g)].map(match => [match.index, match.index + match[0].length]);
  const cues = [];
  let cue = null;
  for (const match of text.matchAll(/\S+/g)) {
    if (tags.some(([start, end]) => match.index >= start && match.index < end)) continue;
    const start = timing[match.index]?.start, end = timing[match.index + match[0].length - 1]?.end;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const word = { text: match[0], start, end };
    if (!cue) cue = { start, end, text: "", words: [] };
    cue.words.push(word); cue.text = cue.words.map(word => word.text).join(" "); cue.end = end;
    if (/[.!?]["')]*$/.test(word.text)) { cues.push(cue); cue = null; }
  }
  if (cue) cues.push(cue);
  for (let index = 0; index < cues.length; index++) {
    cues[index].end = cues[index + 1]?.start ?? cues[index].end + 0.2;
  }
  return groupCaptionPages(cues.filter(cue => cue.end > cue.start));
}
