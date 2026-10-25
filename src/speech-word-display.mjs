import { speechWordFeedback } from "./speech-verification.mjs";

const escapeHtml = text => text.replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

export function renderSpeechWords(element, state) {
  if (!state.expected) return;
  const html = speechWordFeedback(state.expected, state.transcript, state.status === "retry")
    .map(word => `<span class="speech-word speech-word-${word.status}">${escapeHtml(word.text)}</span>`).join(" ");
  if (element.innerHTML !== html) element.innerHTML = html;
}
