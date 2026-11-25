# Courtyard House: WebXR hand-tracking walkthrough (1:1)

Walk through a **life-size** single-storey courtyard house in VR on **Meta Quest 3** with your bare hands, or on a **desktop** browser using your webcam (MediaPipe) or keyboard and mouse.

There is no backend and no build step. It is plain static files (HTML, CSS and ES modules) with pinned CDN libraries, and it works as-is on **GitHub Pages**, including from a sub-directory such as `https://you.github.io/repo/`.

---

## What's in the scene

| Area | Size | What to try |
|---|---|---|
| Front garden | – | Start point, welcome sign, **1 m grid**, **2.0 m measuring pole** (0.5 m bands), **1.70 m reference person**, compass, arrows on the path |
| Entrance Hall | 6 × 4 m | The front door opens automatically as you walk up to it |
| Living Room | 5 × 12 m | Sofa, bookshelf, reading chair, floor lamp |
| Courtyard (open sky) | 6 × 8 m | Reflecting pool, tree, bench, **day / night orb** |
| Kitchen & Dining | 5 × 6 m | Counters, island, table with 4 chairs, pendant lamp |
| Bedroom | 5 × 6 m | Bed, wardrobe, desk |

**Interactions (simple on purpose):**
- **Doors** swing open as you approach and close behind you.
- **Glowing wall buttons** next to each room entrance switch that room's lights. Amber means off and green means on. In VR, touch one with your index fingertip. On desktop, click it.
- **Glowing orb** in the courtyard switches between day and night. Touch it in VR, or click it on desktop (or use the *Night/Day* button or the <kbd>N</kbd> key). At night every room light switches on automatically.
- **Room signs** fade in as you get close, showing each room's name, size and area.
- **Walls and furniture block** artificial movement, and you slide along walls. Your real, physical movement is never blocked.
- **Minimap** (desktop): click anywhere to jump there.

---

## Controls

| Gesture | Action |
|---|---|
| Thumb + **index** pinch | Walk forward in the direction your head faces (horizontal only) |
| Thumb + **ring** pinch | Smooth turn left |
| Thumb + **pinky** pinch | Smooth turn right |
| No pinch | Stop immediately |

Either hand works. You can walk with one hand and turn with the other at the same time. If one hand turns left while the other turns right, the turns cancel out.

Desktop extras: <kbd>W</kbd>/<kbd>↑</kbd> forward, <kbd>S</kbd>/<kbd>↓</kbd> back, <kbd>A</kbd>/<kbd>D</kbd> or <kbd>←</kbd>/<kbd>→</kbd> turn, drag to look, <kbd>R</kbd> reset, <kbd>N</kbd> day/night.

---

## Publish on GitHub Pages

1. Create a repository (for example `webxr-quest3`) and upload **the contents** of this folder so that `index.html` sits at the repository root.
2. Open **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, pick the branch `main` and the folder `/ (root)`, then save.
3. After a minute or two the site is live at `https://<user>.github.io/<repo>/`.

The included empty `.nojekyll` file tells GitHub Pages to serve every file unchanged. All paths are relative, so the sub-directory URL works.

## Test on Meta Quest 3

1. On the headset, enable hand tracking: **Settings → Movement tracking → Hand tracking: On**. Turning on *Auto switch between hands and controllers* is also recommended.
2. Open **Meta Quest Browser** and go to your GitHub Pages URL. HTTPS is required, and GitHub Pages provides it.
3. Close the welcome dialog, then press **Enter VR** and allow the permissions the browser asks for.
4. **Put the controllers down.** Hands appear as small spheres on every joint.
5. A small status panel floats low in your view. It shows **L/R** dots for tracked hands and the current action, such as *WALKING*, *TURN LEFT* or *READY*. It also warns you if no hands are detected or controllers are still active.
6. Pinch to move. Exit with the Quest menu button. The page returns to desktop mode where you left off.

> **Tip:** keep your palm facing **down or away** from you while pinching. A pinch with the palm facing your face is Quest's own system gesture, and it opens the Meta menu.

## Test on desktop

1. Open the URL in Chrome or Edge. For local testing, `localhost` also counts as a secure context.
2. Press **Start Camera**, confirm the dialog, and allow camera access. The model (about 7 MB) loads only at this point.
3. Your hand skeleton is drawn over a mirrored video preview. The fingers that are pinching turn green, and the gesture card at the bottom lights up.
4. If the camera is denied or missing, an error message tells you so. Keyboard and mouse always work.

## Run locally

```bash
cd webxr-quest3
python3 -m http.server 8080      # then open http://localhost:8080
npm test                         # optional: runs the unit tests (Node 18+), no install needed
```

To try VR from a local machine you need HTTPS on the headset. The easiest way is to push to GitHub Pages. Alternatively, use `adb reverse tcp:8080 tcp:8080` with the Quest connected by USB and open `http://localhost:8080` in Quest Browser.

---

## Scale & transforms (how 1:1 is kept correct)

The scene uses **one unit = one real metre**, and the house is modelled in real metres (for example, walls are 3.0 m high and the front door is 1.2 × 2.3 m). The model is therefore shown at **1:1**, and what you see in the headset matches real-world size.

The design keeps four things separate, and **never scales the head-tracking data**:

```
scene (metres)
 ├─ site / model           ← model scale lives HERE only (modelScale, default 1)
 └─ rig                    ← locomotion: X/Z translation + yaw (pinch walk / turn)
     └─ tracking-space     ← 0 m with 'local-floor'; +1.60 m only if the headset gives 'local'
         └─ camera         ← VR: raw Quest 3 head pose in metres (untouched)
                             desktop: fixed eye height 1.60 m + mouse pitch
```

- **Head pose:** Quest 3 reports head position in real metres relative to the floor (`local-floor`), and this is used unchanged. Your real height, crouching and leaning all work naturally. The camera height is **never forced** to a fixed value in VR.
- **Locomotion** only moves and rotates the `rig`. Walking uses the head's **horizontal** facing direction, so looking up or down never changes your walking direction. Speed is in m/s × `deltaTime`, which makes it frame-rate independent.
- **Turning** rotates the rig around the vertical axis **through your head**. If you are standing away from the centre of your play space, you still turn in place instead of being swung around.
- **Reference-space fallback:** if `local-floor` is not granted, the app uses `local` and lifts the tracking space by 1.60 m, so you are not placed at floor level.

### Viewing a model built at another scale (e.g. 1:70)

If a model's units are not real metres, for example a scan of a **1:70 architectural maquette** where 1 unit equals 1 maquette metre, only the **model** is scaled, by the inverse of the drawing scale:

```
modelScale = 70            (1 maquette metre × 70 = 70 real metres)
real eye height = 1.60 m   → in maquette units 1.60 / 70 ≈ 0.02286
```

Load it with `?model=assets/models/your-model.glb&modelScale=70`. The model is enlarged to life size and you walk through it with your real, unscaled head tracking. That is the same result as shrinking yourself to 1/70 inside the maquette (eye height 0.02286 maquette units), but it keeps the WebXR tracking maths untouched. For a model that is already in metres, use `modelScale=1` or leave the parameter out.

## Loading your own glTF/GLB model

1. Put the file in `assets/models/`, for example `assets/models/house.glb`.
2. Open `index.html?model=assets/models/house.glb` (add `&modelScale=…` if the model is not in metres).
3. The built-in house is hidden while the garden, scale references and lighting stay. Collision is switched off for custom models because they have no collision data, and the minimap shows only the garden.

---

## Project structure

```
webxr-quest3/
├── index.html            UI, import map (three 0.170.0, MediaPipe tasks-vision 0.10.14)
├── css/style.css
├── js/
│   ├── main.js           scene, render loop (renderer.setAnimationLoop), input routing, UI
│   ├── config.js         all tunables: speeds, thresholds, scale, start point
│   ├── xr-manager.js     Enter/Exit VR, 'local-floor' → 'local' fallback, session lifecycle
│   ├── hand-tracking.js  Quest 3 WebXR joints (fillPoses) → gesture input + joint rendering
│   ├── desktop-hands.js  webcam + MediaPipe Hand Landmarker → the same gesture input
│   ├── gestures.js       shared gesture engine (pure JS, unit-tested)
│   ├── locomotion.js     walk / turn / teleport of the rig (pure JS, unit-tested)
│   ├── collision.js      2D wall & furniture collision with sliding (pure JS, unit-tested)
│   ├── site.js           the Courtyard House, doors, switches, day/night, labels
│   └── hud.js            in-VR status panel + desktop minimap
├── assets/models/        drop .glb / .gltf files here
├── tests/                node --test unit tests
├── package.json          only for `npm test` (no dependencies, no build)
└── .nojekyll
```

## Gesture engine details

Both trackers produce the same input: wrist, middle-finger knuckle, and the thumb, index, ring and pinky tips, in metres. On Quest these come from WebXR joint poses. On desktop they come from MediaPipe *world* landmarks. The engine then works as follows:

1. **Normalises** each thumb-to-fingertip distance by **hand size** (wrist to middle knuckle), so thresholds work for small and large hands.
2. Uses **hysteresis**. A pinch starts below `press` and ends only above `release` (VR: 0.25 / 0.36; webcam: 0.32 / 0.45, because webcam depth is noisier).
3. Applies a **debounce**. A pinch must last 80 ms before it starts, while releasing is instant.
4. Allows **one gesture per hand**. If several fingers are pinched, the tightest pinch wins, and near-ties follow the priority *walk > turn right > turn left*. Once a gesture is active it is latched, so other fingers cannot take over until it is released.
5. Stops everything **immediately** when a hand is lost or leaves the camera view.

All values live in `js/config.js`. The *Pinch ratios* line in the Status panel shows live values (i = index, r = ring, p = pinky), which helps when tuning.

## Performance notes (Quest 3)

- All static geometry is merged into one mesh per material, giving about 65 draw calls and about 18k triangles in total.
- Lambert materials, no real-time shadows, and room lights that are always present (switching only changes intensity, so shaders are never recompiled).
- The 50 hand joints are drawn as a single `InstancedMesh`. Joint data is read every XR frame with `XRFrame.fillPoses`.
- MediaPipe is never downloaded in VR. Entering VR stops the webcam pipeline so the two trackers never run at the same time.

## Verification status

To be transparent about what has been checked:

- ✅ **Unit tests** (21) pass with `npm test`. They cover pinch normalisation, hysteresis, debounce, multi-pinch priority, the latching rule, two-hand combination, tracking loss, frame-rate-independent walking, turning around the head, teleport and collision sliding.
- ✅ **Headless Chrome desktop run** (served from a sub-directory) produced no JavaScript errors. It checked keyboard walking and turning, the wall blocking walking, walking through the front door, clicking a light switch, minimap teleport, day/night, and the camera error path when no webcam is present. The WebXR hand path was also exercised with a **mock** XR frame (joint poses into the gesture engine, producing *walk*).
- ⚠️ **Not yet verified on a real Meta Quest 3**, and **not yet verified with a real webcam** (the test machine had neither). WebXR session start, real joint data, the pinch thresholds for real hands, and MediaPipe model loading need a first run on real devices. If pinches feel too sensitive or too hard to trigger, adjust `CONFIG.gestures` in `js/config.js`.

## Troubleshooting

| Problem | Fix |
|---|---|
| *VR not available* on Quest | Use **Meta Quest Browser** on the **https** GitHub Pages URL |
| Status panel says *Hand tracking unavailable* | Quest Settings → Movement tracking → Hand tracking **On** |
| Status panel says *Put the controllers down* | Put the controllers down and wait for hands to appear |
| Pinch opens the Meta menu | Keep your palm facing down or away while pinching |
| Webcam pinches flicker | Improve lighting, keep the hand 40–70 cm from the camera, or raise `gestures.desktop.release` |
| Turning makes you queasy | Lower `turnSpeed` in `config.js` (for example to 35) |
