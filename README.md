# Lifeline 3D, story-driven exploration game

> A third-person open-world sandbox game built with [Three.js](https://threejs.org/) — no game engine, just pure WebGL.


## Quick Start

```bash
# 1. Install dependencies
npm install
- if that doesn't work do npm audit fix then npm install again

# 2. Start dev server
npm run dev

# 3. Build for production
npm run build

# 4. Preview production build
npm run preview
```

> **Note:** If `npm install` fails, try `npm install --legacy-peer-deps`.

## Controls

| Key | Action |
|---|---|
| **W A S D / Arrow Keys** | Move (camera-relative) |
| **Shift** | Sprint |
| **Space** | Jump |
| **Mouse** | Look around |
| **Scroll** | Zoom in/out |
| **E** | Talk to aliens, collect samples, or deposit resources |
| **1** | Equip taser baton (available after waking at base) |
| **2** | Equip pickaxe (available after waking at base) |
| **3** | Equip shovel |
| **Left Click (Baton)** | Stun an alien. One hit puts an alien to sleep; the last alien remains downed and talkable |
| **Left Click (Pickaxe)** | Strike an ice block three times to mine an ice core. Must be close and facing the block; allow time between swings |
| **Left Click / E (Shovel)** | Dig a soil sample near a crop bed after speaking with a farmer |
| **Q** | Open/close objectives |
| **Enter** | Complete text or skip dialogue voice |
| **V** | Speak or retry player dialogue |
| **H** | Mining swing |
| **F** | Toggle third-person/free camera |
| **M** | Mute/unmute audio |
| **P / Esc** | Pause game and release mouse |


## Tech Stack

- **Three.js r184** — 3D rendering engine
- **Vite 8** — Dev server and build tool
- **JavaScript (ES Modules)** — No TypeScript
- **FBX / GLB** — 3D model formats
- **No game engine** — Everything is custom-built on raw WebGL

## License

MIT
