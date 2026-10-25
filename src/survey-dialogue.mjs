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

export const WAKING_DIALOGUE = [
  { speaker: "You - Inner thoughts", text: "What could that possibly have been? What a weird nightmare..." },
  { speaker: "Apollo", voiceSpeaker: "Apollo", text: "Did you hear what I said? I said your mission objective is to go to the colony to gather information on their water collection methods." },
];

export const DEPOSIT_ACKNOWLEDGMENT = [
  { speaker: "Apollo", voiceSpeaker: "Apollo", text: "Good job. These samples will really help benefit society. You've earned some rest. Head back to base and get some sleep." },
];
