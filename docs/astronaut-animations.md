# Astronaut animations

Inspected directly with Three.js FBXLoader from `public/assets/Astronauta.fbx`.
There are 16 clips: 10 action clips and 6 T-pose reference clips. Names below
are exact, including spelling and accents.

| Embedded name | Duration (seconds) | Project use |
| --- | ---: | --- |
| `Armação\|PistolIdle` | 1.000 | Looping preview |
| `Armação\|0TPose.002` | 0.042 | Reference pose preview |
| `Armação\|PistolPickup` | 0.792 | One-shot preview |
| `Armação\|0TPose.006` | 0.042 | Reference pose preview |
| `Armação\|0TPose.004` | 0.042 | Reference pose preview |
| `Armação\|Minering` | 0.708 | H / attack mining swing; one-shot preview |
| `Armação\|ColetandoChao` | 1.000 | Ground collection; one-shot preview |
| `Armação\|ArmaçãoAction` | 0.583 | Unspecified action; one-shot preview |
| `Armação\|0TPose` | 0.042 | Reference pose preview |
| `Armação\|Walk` | 0.792 | Walking loop |
| `Armação\|Die` | 0.792 | Death preview, holds final frame |
| `Armação\|0TPose.003` | 0.042 | Reference pose preview |
| `Armação\|Running` | 0.583 | Sprinting loop |
| `Armação\|ColetandoPistola` | 2.375 | Pistol collection; one-shot preview |
| `Armação\|Idle` | 1.208 | Stationary / airborne loop |
| `Armação\|0TPose.007` | 0.042 | Reference pose preview |

Press Esc or P to pause, then choose Animation previews to play any clip.
One-shot previews hold their final frame. Choose Back, then Resume to continue
automatic gameplay. The rest of the world stays paused during a preview.
These previews play animations only; collection, pistol and death gameplay
mechanics are not added. Jump physics remain active; the file contains no named
jump, fall or hit animations. The native mining swing is reused for attacks.

`src/astronaut-animations.js` binds tracks by UUID to the animated parent bones.
FBXLoader creates nested identity copies of shared bones for the seven skinned
suit meshes. Those copies inherit their parent's animation and must not receive
the same animation again, which would compound transforms and deform the suit.
Regression checks evaluate every clip and verify those copies stay at identity
and inherit exactly the parent's world transform. Bone position tracks are
preserved. The old `Player_*.fbx`
animations are no longer loaded for the astronaut's different rig.

Validation: `node --test tests/astronaut-animations.test.mjs`.
The tests parse the real asset with image decoding stubbed, check the inventory
and every skeleton binding, evaluate all clips, exercise locomotion and repeated
one-shots, and check preview exit and unchanged player transforms. FBXLoader
reports that the source mesh has some vertices with more than four skin weights;
Three.js trims excess weights during import. Browser appearance requires visual
verification separately.
