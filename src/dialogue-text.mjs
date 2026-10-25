const keyword = /\b(?:lifeline|lifelife)\b/gi;
const escapeHtml = text => text.replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

export function dialogueTextHtml(text) {
  return escapeHtml(text).replace(keyword, '<span class="dialogue-highlight">Lifeline</span>');
}

export function renderDialogueText(element, text) {
  const normalized = text.replace(keyword, "Lifeline");
  if (element.textContent !== normalized) element.textContent = normalized;
  if (/\bLifeline\b/.test(normalized)) {
    const html = dialogueTextHtml(normalized);
    if (element.innerHTML !== html) element.innerHTML = html;
  }
}
