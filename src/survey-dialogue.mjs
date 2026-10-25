export const SURVEY_SHOTS = Object.freeze([
  { region: "GALE CRATER · GARDEN COLONY", action: "forcedFarming", duration: 7,
    caption: "Under armed watch, the farmers are forced back to the fields." },
  { region: "GALE CRATER · GARDEN COLONY", action: "batonStrike", duration: 4,
    caption: "A guard strikes a farmer who stops working." },
  { region: "GALE CRATER · GARDEN COLONY", action: "collapse", duration: 5,
    caption: "Exhausted workers collapse. The guards keep watch." },
]);

export const SURVEY_NARRATION = SURVEY_SHOTS.map(shot => ({ speaker: "Narrator", voiceSpeaker: "Narrator",
  text: shot.caption, speechText: `[whispering] [somber] ${shot.caption}`, emotional: true }));
