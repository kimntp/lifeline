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
routine. Dialogue reveals the company's actual objective: enslave the farmers
and export crops to Earth. Pause freezes the colony and hides its interaction UI.

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
