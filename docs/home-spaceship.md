# Home-screen spaceship

The title uses the original `assets/jsf_RealTimeModel.fbx` and the supplied PNGs in
`assets/ship-textures/`. The FBX has two UV-mapped meshes, `main` and `aux`, but no
embedded textures, external texture links, or animation clips. Its imported bounds
are approximately 427 × 228 × 524 units. The nose points along imported world +Z.

`home-ship-model.js` maps `jsf_mainMat` to the `mainMat` diffuse, normal, metallic,
and roughness files. `jsf_auxMat` uses the corresponding `auxielieryMat` files;
that spelling is intentional. Diffuse maps use sRGB; the other maps use linear
data. The additional supplied alpha PNG is retained with the original textures.
The FBX remains unchanged. Indexed geometry reduces duplicated vertex processing
while retaining UVs and normals. No GLB conversion is required by FBXLoader.

A dedicated transparent Three.js renderer keeps the title independent of the
gameplay camera and renderer. An axis-correction parent turns +Z into flight +X;
the flight parent handles heading and gentle banking. Routes use arc-length spline
sampling, 35–50-second passes, conservative projected bounds, and offscreen resets.
On narrow displays the route passes below the menu, or remains to its left when
there is insufficient vertical space. Rendering pauses in hidden tabs. Leaving
home disposes the renderer, geometry, materials, textures, observers, and listeners.

The start button still requests mouse capture directly from its activation event.
After capture succeeds, the title fades to black before the existing gameplay
callback runs. The black overlay remains until that callback resolves. Failed
capture or initialization restores the title controls. Reduced motion freezes the
ship, stops the status pulse, and shortens the fade.

Preview with `npm run dev`. Check assets, flight bounds, cleanup, and startup with
`node --test tests/*.test.mjs`; build with `npm run build`.
