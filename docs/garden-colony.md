# Gale Crater — Garden Colony

The first alien settlement uses `Tomato Plant.fbx`, `Wheat Crop.fbx`, and
`hab_dome.fbx` from `public/assets`. It contains four raised beds (24 tomato
plants and 24 wheat plants), a terrain-supported hab dome, and three friendly
farmers: Iri, Vela, and Naru. Farmers use `Alien_Low_Green.fbx` and
`Alien_Low_Gray.fbx`, with independently cloned skeletons and native Walk/Idle
animations. Both models also contain Run. A small, non-accumulating reach over
the idle animation supplies the tending pose. Missing external PNG textures
use the embedded gray/green material colors.

Their ability regenerates soil and accelerates plant growth: tending gradually
greens the soil and grows plants, with a visible green pulse. Farmers stay
within the colony, cycle between work and rest, and enter/exit the dome.
Only farmers bypass the dome collider; the player cannot enter it. Friendly
farmers cannot be attacked. Hostile enemies and their combat system are removed.

E starts a nearby farmer's conversation, advances it, and closes it after the
last line. Walking away also closes it. Conversations pause that farmer's
routine. The first level is peaceful: its dialogue explains growing conditions,
sample collection, and the neighboring colony's water supply. The old dialogue
and hostile colony objective have been removed; `surveyDialogue` is the single
source of alien conversations for this level.
Pause freezes the colony and hides its interaction UI.

## Peaceful first survey

1. Talk to any farmer with E. The conversation explicitly asks how crops can
   grow on Mars. Reading the explanation unlocks alien-reported statistics and
   the objective checklist.

Press Q (or use the Q Objectives button) to slide the objectives tab open or
closed. New surveys initially show only “Talk to one of the aliens.” Sampling
and water tasks appear after reading the growing-condition explanation.
Apollo's mission message appears inside the objectives tab.
2. Near any crop bed, press E to collect a soil sample. Collect a tomato cutting
   at a tomato bed and a wheat cutting at a wheat bed. Each sample is collected
   once; crops remain alive. Sample prompts take priority over nearby chat.
3. Talk again to ask about water. Farmers explain that they conserve water but
   receive it from Ares Water Colony in exchange for crops. Its coordinates are
   recorded in the local in-game survey grid; the second colony is not built
   by this mission. Sampling and the water question may be completed in either
   order after first contact.
4. Once all three samples and water information are obtained, Apollo explicitly
   directs the player to report back to base FIRST. Navigation switches to the
   sample tray on the accessible foundation rim.
5. At the tray, E deposits the samples. A fade to black freezes the world,
   resets the astronaut and camera at the base, empties the sample case, and
   reveals three deposited sample containers. The screen fades back into the
   game with the mission COMPLETE, its readings and coordinates retained.
   The player stays at base; neither the mission nor the home screen restarts.

The readings (22 °C, 65% moisture, 96% soil restoration, 3× growth) are authored
fictional gameplay values, labeled as alien-reported in-game readings. Apollo
is the field-assistant radio/text interface. Reloading starts a fresh survey
with the first contact objective and an empty sample case. Saved base, colony,
and player spawn locations remain in place. Canceling the fade before deposit
commits leaves the current session's samples available for another try.

The colony is located on a suitable terrain patch near the base. A HUD shows
its distance and direction relative to the camera. Crop beds participate in
player grounding. Saved player spawns
inside the newly added dome fall back to the base foundation. Moving the base
into the colony is prevented to preserve its layout and farmers' routes.

To relocate it, stand at the desired garden center, pause, and choose Move
colony here. The dome and beds are rebuilt against the new terrain heights,
farmers restart their routes, and crop growth is retained. The location is
stored for this level in the browser under `lifeline:level-1:garden-colony`.
Placement must fit on the terrain and remain clear of the space base.

Validation includes all three real FBX assets, crop counts/scales, supported
placement, blocked dome crossings, full worker work/rest cycles, colony
boundaries, growth, talk selection, dialogue advancement, and real terrain
placement for both default and relocated bases. Browser visuals require a
separate visual check.
