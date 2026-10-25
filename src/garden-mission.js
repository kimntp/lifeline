export const GROWING_CONDITIONS = [
  { label: "Local temperature", value: "22 °C" },
  { label: "Root-zone moisture", value: "65%" },
  { label: "Soil restored", value: "96%" },
  { label: "Growth rate", value: "3× baseline" },
];

const SAMPLE_NAMES = { soil: "Soil sample", tomato: "Tomato sample", wheat: "Wheat sample" };

export class GardenMission {
  constructor(saved = null) {
    this.explained = saved?.version === 1 && saved.explained === true;
    this.samples = Object.fromEntries(Object.keys(SAMPLE_NAMES).map(key => [key, this.explained && saved?.samples?.[key] === true]));
    this.waterKnown = this.explained && saved?.waterKnown === true
      && Number.isFinite(saved?.coordinates?.x) && Number.isFinite(saved?.coordinates?.z);
    this.coordinates = this.waterKnown ? { x: saved.coordinates.x, z: saved.coordinates.z } : null;
    this.completed = saved?.completed === true && this.readyToReport;
    this.depositing = false;
    this.revision = 0;
    this.apolloMessage = this.completed ? "Survey complete. Samples are safely deposited at base; the water colony coordinates are archived."
      : this.readyToReport ? this.returnMessage
      : this.explained ? "Continue the peaceful survey: collect the three samples and ask a farmer where the water comes from."
      : "Peaceful contact only. Ask a farmer how they grow crops in this Martian environment.";
  }

  get readyToReport() { return this.explained && this.waterKnown && Object.values(this.samples).every(Boolean); }
  get phase() { return this.completed ? "complete" : this.depositing ? "depositing" : this.readyToReport ? "return" : this.explained ? "survey" : "contact"; }
  get returnMessage() { return "All samples secured and water coordinates logged. Report back to base FIRST and deposit the samples before heading to the water colony."; }
  get inventory() { return this.completed ? [] : Object.keys(this.samples).filter(key => this.samples[key]); }

  changed(message) {
    this.apolloMessage = this.readyToReport && !this.completed ? this.returnMessage : message;
    this.revision++;
    return true;
  }

  learnGrowth() {
    if (this.explained || this.completed) return false;
    this.explained = true;
    return this.changed("Alien growing conditions received. With their permission, collect soil, tomato, and wheat samples, then ask about their water supply.");
  }

  collect(type) {
    if (!this.explained || this.completed || this.depositing || !Object.hasOwn(this.samples, type) || this.samples[type]) return false;
    this.samples[type] = true;
    return this.changed(`${SAMPLE_NAMES[type]} sealed and labeled. ${this.inventory.length}/3 samples collected.`);
  }

  waterDestination(site) {
    return this.coordinates ?? this.waterLocation ?? { x: site.x >= 0 ? -64 : 64, z: site.z >= 0 ? -52 : 52 };
  }

  learnWater(site) {
    if (!this.explained || this.waterKnown || this.completed) return false;
    this.coordinates = this.waterDestination(site);
    this.waterKnown = true;
    return this.changed("Water supply coordinates received: Ares Water Colony. Finish collecting your samples, then return to base before traveling onward.");
  }

  beginDeposit() {
    if (!this.readyToReport || this.completed || this.depositing) return false;
    this.depositing = true;
    this.revision++;
    return true;
  }

  cancelDeposit() {
    if (!this.depositing) return;
    this.depositing = false;
    this.changed(this.returnMessage);
  }

  finishDeposit() {
    if (!this.depositing || !this.readyToReport) return false;
    this.completed = true;
    this.depositing = false;
    return this.changed("Survey complete. Soil and crop samples are deposited for analysis. You are back at base; the water colony coordinates remain in your survey log.");
  }

  get objectives() {
    if (!this.explained) return [{ id: "contact", label: "Talk to one of the aliens", done: false }];
    const items = [
      { id: "soil", label: "Collect a soil sample", done: this.samples.soil },
      { id: "tomato", label: "Take a tomato sample", done: this.samples.tomato },
      { id: "wheat", label: "Take a wheat sample", done: this.samples.wheat },
      { id: "water", label: "Ask where the water comes from", done: this.waterKnown },
    ];
    if (this.readyToReport) items.push({ id: "base", label: "Return to base and deposit samples", done: this.completed });
    return items;
  }

  serialize() {
    return { version: 1, explained: this.explained, samples: { ...this.samples }, waterKnown: this.waterKnown,
      coordinates: this.coordinates ? { ...this.coordinates } : null, completed: this.completed };
  }
}

export function surveyDialogue(mission, profile, site) {
  const farmer = `${profile.name} — ${profile.role}`;
  if (!mission.explained) return [
    { speaker: "You", text: "How are you able to grow tomatoes and wheat in this Mars environment?" },
    { speaker: farmer, text: "Our abilities generate the conditions the roots need. We regenerate the soil, balance its nutrients, regulate a warm local climate, and hold moisture around the plants. We help the crops grow; we do not force them." },
    { speaker: farmer, text: "Our growing fields are around 22 degrees, with 65 percent root-zone moisture. We restore about 96 percent of the soil's growing potential, and our crops grow about three times as fast. You have our permission to take a small soil sample and a cutting from each crop.", effect: "growth" },
    { speaker: "Apollo — Field assistant", text: "Alien-reported readings logged. Survey objectives added: collect soil, tomato, and wheat samples, and ask the farmers about their water supply. Keep this visit peaceful." },
  ];
  if (!mission.waterKnown) {
    const coordinates = mission.waterDestination(site);
    return [
      { speaker: "You", text: "How do you make enough water for your crops here?" },
      { speaker: farmer, text: `We conserve water with our abilities, but we do not make it. Another colony supplies it in exchange for crops: Ares Water Colony. Here are their local survey coordinates: X ${coordinates.x}, Z ${coordinates.z}.`, effect: "water" },
      { speaker: "Apollo — Field assistant", text: Object.values(mission.samples).every(Boolean)
        ? "Coordinates received. Report back to base first. We need to put down the soil and crop samples for analysis before visiting the water colony."
        : "Coordinates received. Collect the remaining soil and crop samples, then report back to base first to deposit them. We will visit the water colony afterward." },
    ];
  }
  return [
    { speaker: farmer, text: "You are welcome in our garden. We will keep tending the crops while you finish your survey." },
    { speaker: farmer, text: "The water colony's coordinates are in your log. We trade our harvest for their water, and neither colony could thrive alone." },
  ];
}

export function nearestSamplePlot(colony, position, mission, footOffset = 0) {
  if (!mission.explained || mission.completed || mission.depositing) return null;
  let selected = null, nearest = 1.65;
  for (const plot of colony.plots) {
    const type = !mission.samples.soil ? "soil" : !mission.samples[plot.crop] ? plot.crop : null;
    if (!type || Math.abs(position.y - footOffset - plot.center.y) > 2.5) continue;
    const dx = Math.max(plot.bounds.min.x - position.x, 0, position.x - plot.bounds.max.x);
    const dz = Math.max(plot.bounds.min.z - position.z, 0, position.z - plot.bounds.max.z);
    const distance = Math.hypot(dx, dz);
    if (distance < nearest) { nearest = distance; selected = { plot, type }; }
  }
  return selected;
}
