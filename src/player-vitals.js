export function createPlayerVitals(state) {
  const root = document.createElement("section");
  root.id = "player-vitals";
  root.setAttribute("aria-label", "Suit vitals");
  root.hidden = true;
  const rows = [
    { key: "health", max: "maxHealth", label: "Health", icon: "+" },
    { key: "oxygen", max: "maxOxygen", label: "Oxygen", icon: "O\u2082" },
  ].map(({ key, max, label, icon }) => {
    const row = document.createElement("div");
    row.className = `vital-row vital-${key}`;
    row.innerHTML = `
      <div class="vital-detail">
        <div class="vital-heading"><span class="vital-icon" aria-hidden="true">${icon}</span><span class="vital-value"></span></div>
        <div class="vital-track" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100">
          <div class="vital-fill"></div>
        </div>
      </div>`;
    root.appendChild(row);
    return { key, max, row, track: row.querySelector(".vital-track"),
      fill: row.querySelector(".vital-fill"), value: row.querySelector(".vital-value"), previous: null };
  });
  document.body.appendChild(root);
  return (visible) => {
    root.hidden = !visible;
    for (const item of rows) {
      const maximum = Math.max(1, Number(state[item.max]) || 100);
      const current = Math.max(0, Math.min(maximum, Number(state[item.key]) || 0));
      const percent = Math.round(current / maximum * 100);
      if (item.previous === percent) continue;
      item.previous = percent;
      item.value.textContent = `${percent}%`;
      item.track.setAttribute("aria-valuenow", String(percent));
      item.fill.style.transform = `scaleX(${percent / 100})`;
      item.row.classList.toggle("vital-low", percent <= 25);
    }
  };
}
