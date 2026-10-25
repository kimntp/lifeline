# Colony 2 — Ares Water Colony

Colony 1 contains six peaceful green farmers. Colony 2 contains six gray aliens
using `Alien_Low_Gray.fbx`; the ice outpost and its inhabitants remain hidden
until Colony 1 samples are reported at base. Its fixed position is defined in
`src/level-layout.js`, along with the base, garden, and player spawn. The coordinates given in the
garden dialogue match the actual ice settlement.

Before recognition, gray colonists work accessible ice faces with mining picks,
alternating mining and rest, then walking between different deposits along
obstacle-avoiding routes. Ice blocks and crystals use scattered positions,
varied headings, and slight grounded tilts. The wider, uneven arrangement
follows the local hillside contour, with the larger formations uphill rather
than in a circle around the center. Deposits are spaced a further 18% apart. The routine pauses during recognition dialogue.

The taser baton appears in the astronaut’s left hand after waking at base
following the first sample report. It stays hidden throughout the garden survey. Left-click swings it. It cannot harm green farmers or neutral gray aliens.
After E starts a gray alien's recognition conversation, finishing it or walking
away triggers hostility. Swinging during that conversation also closes it and
starts combat, releasing its dialogue lock so the hit can register. Gray aliens
pursue within their settlement, reach to
attack, and reduce the existing health value/bar. Damage and baton cooldowns
limit repeated hits; terrain/ice obstacles block close-range strikes. At zero
health the player fades back to base with restored health; encounter progress
remains intact. Baton hits use actual ice mesh intersections instead of broad
bounding boxes, and show a cyan stun flash plus a hit-count message. Misses and
cooldown also give feedback.

One baton hit immediately incapacitates each gray alien.
The first five fall asleep. The final alien becomes downed and responsive,
with no kill/death state. E opens his untranslated message. Apollo says the
translation was processed but substitutes resource instructions rather than
revealing the literal message. This unlocks three actionable tasks: collect an
ice core, scan the central water source, and collect a crystal sample. The tool
inventory is separate from the objectives panel. It contains the baton (1),
pickaxe (2), and shovel (3). The shovel is available for the first mission;
combat tools unlock at the sample-report wake-up. Switching tools does not show an equipped popup; approaching an ice block
briefly shows mining guidance. The complete controls remain in Pause → Instructions. Only the equipped tool is visible after the first
sample-report wake-up. Left-click with the pickaxe performs a mining swing;
three paced strikes on the same nearby ice block collect the core. Facing,
reach and intervening ice geometry are checked. The pickaxe never harms aliens.
E collects crystal samples and scans water; it cannot bypass pickaxe mining.
The final resource still triggers the injured-alien scene.

The pause menu has no location or spawn editing controls. Reloading resets the level's
mission/encounter state; world locations load from the fixed level layout. All timers use
simulation delta and freeze while paused or during fade transitions.

Completing all three resource tasks triggers a fade into an injured-alien
close-up exactly once. Gameplay freezes, the HUD clears, and the downed alien
trembles while the astronaut hears a direct plea without Apollo's translation.
Captions always appear; browser speech supplies temporary voice audio where
supported and respects mute/pause. E or Continue returns through another fade
to the previous gameplay camera, with samples and completed tasks retained.
Reduced-motion mode removes the trembling.
