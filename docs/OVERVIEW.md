# Repository overview — Riposte: Frontline

**Purpose of this file:** let an agent (or a developer) with *zero context* find
its way around this repository quickly. `AGENTS.md` holds the non-negotiable
rules; this file holds the map, the flows, and the traps. Read `AGENTS.md`
first for the constraints, then use this to locate anything.

---

## 1. What this is

A browser FPS (three.js **r147, pinned** — do not upgrade), all geometry built
procedurally in code (no imported 3D models), source comments in **French**,
player-facing text in **English by default** (see `i18n/`), MIT with branding
exceptions (`NOTICE.md`). No bundler, no ES modules, no framework: `src/*.js`
files are concatenated in filename order into one global scope.

## 2. Build, run, validate

| Command | What it does |
|---|---|
| `python3 build.py` | Concatenates every `src/*.js` **in alphabetical order**, injects into `shell.html`, writes `dist/riposte-frontline.html` (standalone game + `dist/tex`, `dist/sfx`). It also runs the script checks (syntax, forbidden characters, **player-text style**) and regenerates `docs/assets.md`, `dist/version.json` |
| `python3 tools/dev/check_decl.py` | Fails if a top-level function is declared twice (single global scope) |
| `python3 tools/dev/check_i18n.py` | Fails on missing / unused / duplicate translation keys |
| `python3 tools/dev/check_texte.py` | Player-text style (run by build.py: **no semicolons** in player-facing strings — prefer periods/commas; no forbidden dashes) |
| `python3 tools/dev/assets.py` | Regenerates `docs/assets.md` (never edit that file by hand) |
| `tools/dev/bench.js`, `shot.py`, `apercu.py`, `dbg.py` | Optional dev tools (playwright rendering bench, screenshots, previews) |

**Never edit `dist/`** (build artifact). **Run `build.py` + `check_decl.py` after
every change**, and `check_i18n.py` when touching text.

To play locally: serve the repo (or just open `dist/riposte-frontline.html`);
`?diag` prints a GPU/connection report, `?essai=<série>` loads a solo match with
a killstreak for testing (`src/09zm-essai.js`).

## 3. How the game runs

**Boot** — `src/99-start.js` calls `boot()` (`src/09-game.js`): common base
(renderer, effects, soldiers, weapons, viewmodel, menus), then `MATCH.state =
'menu'`. Maps are **not** built at boot; one map is built when a match starts
(`src/09a-loading.js`, `mapEnsure`) and freed when no longer wanted.

**State machine** — `MATCH.state`: `loading` (boot, and mid-match map
transitions: it freezes all gameplay), `menu`, `playing`, `paused` (the match
*keeps running* behind the pause menu — `pauseGame`), `finish` (result
announcement, slow motion), `killcam`, `ended` (results screen).

**Frame** — `frame()` (`src/09-game.js`): menus early-return (animated
background), otherwise `matchTick()` → `renderFrame()` (one
`updateMatrixWorld` for all composer passes), plus dynamic resolution/frame-cap
logic and the performance recorder laps.

**`matchTick` order** (the spine of the game):
`cdTick`/`playHold` (countdown freezes everything) → `MATCH.time`/`timeLeft` →
events queue → `modeUpdate` (mode rules) → `updatePlayer` → `botsTick` →
nades/knives/smokes/drops/props → killstreaks/aircraft → `drawTacMap`+`updateHud`
→ **time-out check** → `kcRecord` → `netUpdate`.
`pfrLap(n)` calls split these into the profiler's 7 steps (see §8).

## 4. Source layout (`src/`, 144 files, alphabetical load)

| Prefix | Subsystem |
|---|---|
| `00-i18n.js`, `00b-preflight.js` | Translations (`_t`, `i18n/en.txt` injection), startup guards |
| `01-core.js` | **The heart** (~1740 lines): `Settings`, scene/camera/viewmodel scene, HUD write helpers (`hudText/hudStyle/hudHtml/hudCls`), math helpers (`hyp`, `numOr`, `hasKey`, `clamp`, `damp`), `LAYER_*` render layers, `RQ` quality tiers, `DYN`/`RS` dynamic resolution (sub-rectangle, no target recreation), `CAP`/`VSYNC` frame cap, `LAG` fence-bounded frame queue, `HF` high-frame decimation, CSM shadows (staggered cascades), flash-light pool, composer + passes (prepass / world / SSAO / viewmodel / bloom / sun rays / final) |
| `01a-gpu.js` | GPU context loss/recovery, `gpuBarrier`, `gpuCompileScene`, quality fallbacks, `?diag` report, `GPUT` GPU timer |
| `02-map.js` | `MAPS` registry, `mapById`, `CURMAP`, `SPLAT`, `mapAdd` (map-owned objects), `MAP_DEFS` convention |
| `02-relief.js` | Terrain relief, `gy0`/`groundHeight`, the out-of-bounds `RING` + `VOID`, `ringCheck`/`zoneDeath`/`ringHud` |
| `02z-load.js` | `mapSetup`/`mapTeardown`, ambience, `mapDressing`, POI/SPAWNS wiring |
| `02a-02q` | Construction kits: materials/textures, architecture, lights, props, vehicles, nature, winter, rails, dynprops, port, water, grass, flora, garden, greenhouse, sand |
| `02y*` | The nine map plans + their kits (`02s-sable` Khamsin, `02t-givre`, `02u-embruns`, `02v-floreal`, `02yf-meltem`, `02yg/02yh-tephra`, `02yi/02yj-stratus`, `02yk/02yl-simoun`, `02ym/02yn-french-dream`) |
| `03-nav.js` | Nav grid build, A* (`findPath`/`smoothPath`/`navWalkable`), generation-stamped (allocation-free search) |
| `04-fx.js` | Particles/tracers/holes/sparks (typed arrays, custom shader) |
| `04b-physprops.js` | Rigid-body props physics: fixed 100 Hz, sleep/wake, pair cache, spatial hash |
| `05*` | Audio: `05-audio.js` core/synth, `05a-sfx` bank, `05b-rankup`, `05c-ambiance` per-map sounds |
| `06*` | Soldiers & weapons: rig/animation (`06a-rig`, `06ab-anim`, `06ac-loco`), posing/LOD (`06b-soldier`, `06c-models`), ragdoll (`06h`), gear/hands/body/cloth/outfits (`06e`, `06f`, `06g`, `06gb-tissu`, `06ga-tenues`, `06gc/gd`), weapon defs (`06i-armes`) and models (`06j`–`06p`), camos (`06q`), weapons core (`06-weapons`), reload (`06d`), progression (`06r-arsenal` XP, `06s-defis` challenges) |
| `07*` | Bots: `07-bots` (`DIFF`/`DIFF_SURV`, `makeBot`, senses, grenades), `07b-tactics` (tactics/cover/suppression), `07c-controller` (movement shared by player and bots — `ctlMove`, `MOVE_SPEED`), `07ca-recul` (recoil), `07d-squad` (domination team plan), `07e-humain` (temperament, slide) |
| `08*` | Player: `08-player` (`PL`, `updatePlayer`, death/respawn), `08a-binds`, `08b-killstreaks` (`KS`), `08c-pickups` (drops), `08d-heli`, `08e-fpv` (drone), `08f-mecha`/`08g-mecha-pilote` |
| `09*` | Game glue (see below) |
| `99-start.js` | Entry point → `boot()` |

**`09*` in detail** (the files most work touches):

| File | Contents |
|---|---|
| `09-game.js` | `MATCH` state, `$`/`HUD`/`HUDE`, `killEnt`/`applyDamage`/`voidDeath`, `updateHud`, `fillEnd`, `startMatch`/`endMatch`/`toMenu`/`pauseGame`, `botsTick`, `matchTick`, `frame`, `boot`, `hudMsg`, `updateStreakHud`, death screen |
| `09i-modes.js` | **The modes**: `MODES`/`MODE_IDS`/`modeDef`/`allied`, `modeStart`/`modeRoster`/`modeUpdate`/`modeEnd`, the whole **spawn system** (`spawnPool`/`spawnRate`/`spawnYaw`/`chooseSpawn`/`spawnOpening`), DOMINATION (`DOM`, `domInit`/`domUpdate`/`domHud`/`domMinimap`/`domNetState`), and **SURVIVAL** (`SURV`, extraction marker, rounds, map queue, `survNetState`/`survNetMap`) |
| `09a-loading.js` | `mapEnsure`/`mapBuild`/`mapUnload`/`mapRelease`, loading progress |
| `09c-net.js` | The whole networking layer (see §7); `09cb-serveurs.js` game server, `09d-netrelay.js` relay |
| `09e-menus.js` (+`09ea-liste.js`) | All menus, `matchRows` (the shared lobby/solo settings rows), solo pages, deploy screen, `UI` |
| `09l-fin.js` | Result announcement: `matchOutcome`, `finByLimit`, `finKicker`, `matchFinish`, `finDone` |
| `09b-killcam.js` | Killcam: recording ring buffer (`kcRecord`), replay (`startKillcam`/`updateKillcam`/`endKillcam`), `kcSkip` |
| `09y-decompte.js` | Match-start countdown (`cdStart`/`cdGo`/`playHold`) |
| `09zo-perfs.js` | **Performance recorder** (see §8) |
| `09m-marqueurs.js` | Ally chevrons over heads |
| `09ga-minicarte.js` | Minimap statics/zone rendering helpers |
| `09j-compte.js` | Accounts (server-side not included), `acctMatchEnd`, XP |
| `09n-armurerie.js`, `09o-vitrine.js` | Arsenal UI, weapon showcase renders |
| `09q-tactile.js`, `09qb-tactile-layout.js`, `09qc-manette.js`, `09qd-visee.js`, `09qe-pavetactile.js` | Touch and gamepad input/layout |
| `09zm-essai.js` | Dev: `?essai=` loads a solo match with a killstreak ready |
| `09zn-outil-zones.js` | Dev tool: map zone authoring |
| `09zj-grenade-reglage.js`, `09zk-couteau-reglage.js` | Dev tuning panels |
| others | `09f-news`, `09g-music`, `09h-update` (auto-reload), `09i-chat`, `09k-legal`, `09p-avatar`, `09r-pwa`, `09s-rankup`, `09t/09ta-social/amis`, `09u-tenues`, `09v-moderation`, `09w-fond` (menu background), `09x-invites`, `09z-communaute`, `09zl-economie` |

**Outside `src/`:** `shell.html` (all DOM + CSS + the script injection marker),
`i18n/en.txt` (FR→EN dictionary; keys are the French strings), `assets/`
(photo textures, skies, HDRI, sounds, music — CC0), `tools/dev/`, `docs/`,
`dist/` (build output, never edited).

## 5. Key globals to know

| Global | Where | Role |
|---|---|---|
| `MATCH` | 09-game.js | Match state: `state`, `mode`, `time`, `timeLeft`, `score`, `limit`, teams |
| `PL` (`PL.ent`) | 08-player.js | The local player entity (object literal — **never add/remove fields at runtime**, see §9) |
| `entities` | 07-bots.js | Every soldier: `PL.ent`, bots (host-owned), remote players/bots (`isRemote`) |
| `MODES`/`MODE_IDS`/`modeDef()`/`allied()` | 09i-modes.js | Mode definitions and alliances |
| `DOM`, `SURV` | 09i-modes.js | Mode state (domination points, survival extraction/rounds) |
| `SPAWNS`, `POI`, `NAV`, `COL`, `RAMPS`, `COVERS` | built per map | Static geometry/nav data (never mutated after load) |
| `NET`, `NET.cfg` | 09c-net.js | Networking; `NET.cfg` = host-authoritative lobby settings |
| `Settings` | 01-core.js | Persisted local settings (quality, difficulty, mode, limits, `Settings.mode`…) |
| `MAPS`/`MAP_DEFS`/`CURMAP`/`MAPL` | 02-map.js/02z-load.js/09a-loading.js | Map registry, current map, loader state |
| `WEAPONS`/`KSDEF`/`KS_IDS`/`CLASSES` | 06i-armes.js/06ri | Weapons, killstreaks, player classes |
| `DIFF`/`DIFF_SURV`/`botDiff()` | 07-bots.js | Bot difficulty rows (`DIFF_SURV` = survival/co-op) |
| `HUD`/`HUDE`, `$` | 09-game.js | HUD state and cached HUD elements (`hudElsInit`) |
| `RQ`, `DYN`, `RS`, `CAP`, `VSYNC`, `LAG`, `HF`, `GPUT`, `PFR` | 01-core.js / 01a-gpu.js / 09zo-perfs.js | Quality tier, dynamic resolution, frame pacing, performance recorder |

## 6. The game-mode system (and how to add a mode)

A mode is a `MODES` entry plus a few branch points, all in `src/09i-modes.js`:

1. `MODES.<id>` = `{ name, btn, sub, teams, lim, unit, limits, key, respawn, botRespawn, prot, hint }`
   and add the id to `MODE_IDS`. `key` is the `Settings` field the lobby limit row writes.
2. `modeStart(mode)` — reset/build mode state (called by `startMatch`).
3. `modeRoster()` — which soldiers are in play and on which team (see the FFA cut and the survival team-forcing branches).
4. `modeUpdate(dt)` — per-frame rules (called from `matchTick`, not during countdown/finish).
5. `killLimitReached()` — when the mode ends on a score/limit (modes with their own end conditions return `false` and call `matchFinishSoon()` themselves).
6. `modeEnd()` — teardown (called by `toMenu`).
7. **End**: `matchOutcome`/`finKicker` (`09l-fin.js`), and the time-out path (`matchTick`).
8. **HUD**: `updateHud` (`09-game.js`) + `modeStart`'s score-row labels; `#domRow`/`#domCap` are reusable generic objective UI.
9. **Spawns**: `spawnPool`/`spawnYaw`/`spawnRate` branches (team-based by default).
10. **Bots**: the squad plan (`07d-squad.js`) assigns bots to objectives; `objectives()`-style accessors are the pattern for new objective modes.
11. **Online**: sync state through the host's `'ps'` packet (see §7).
12. **Menus/i18n**: `matchRows` rows for lobby options + `i18n/en.txt` keys.

**Shipped:** `tdm`, `ffa`, `dom`, `survival` (solo + the extraction loop + 4-player
co-op, on the feature branches).
**Planned (worked plans in `docs/`):** Frontline Push, Hunter/Killer, Salvage
Race, Sandstorm.

## 7. Networking in brief (`src/09c-net.js`)

Peer-to-peer (PeerJS) with an optional relay/game server; **the host is
authoritative** for the match clock, the end of the match, domination points and
survival state. Every machine simulates only its own player (and the host
simulates the bots, published as remote entities). The host publishes a `'ps'`
packet ~15×/s carrying its own state plus `tl` (clock), `cd` (countdown) and the
mode state (`dm:` domination, `sv:` survival — the pattern for any new
host-authoritative mode: a compact numeric object, applied client-side with
`numOr` guards). Kills/deaths are announced by the victim's machine and applied
everywhere (`netEvent`/`netEventIn` → `killEnt`). Host migration exists for
game-server lobbies. Lobbies cap at 8 (4 for survival, via `netMaxPlayers`).

## 8. Performance culture (read before optimizing)

The game ships its **own frame recorder**: Options → Vidéo → « Afficher les
performances », then play a match; the report (same menu) attributes every frame
to 7 steps (`player / bots / props / logic / prep / shadow / render`) and lists
worst hitches with the events around them. **Measure before changing anything.**

Already implemented (do not re-propose): depth prepass, custom CSM with
staggered cascades, IBL cubemaps, MSAA-resolve skipping, dynamic resolution over
a sub-rectangle, fence-bounded frame queue with driver bail-outs, HF bot
decimation, quality tiers learned from hardware, physics/pair-cache/sleep,
typed-array particles, allocation-free nav A*, shader/asset warmups.
Two audits in `docs/performance-pass.md` and `docs/performance-pass-2.md` list
the remaining, mostly small, candidates.

## 9. Traps and rules that bite

- **Single global scope + alphabetical load order.** Every top-level name is
  global; `check_decl.py` enforces uniqueness. Runtime cross-references are fine
  in any order; top-level side effects are not.
- **`PL` and `BOT_STATE` are object literals** whose fields must all be declared
  up front (V8 shape stability) — never add/remove fields at runtime.
- **No per-frame allocation** in hot paths. Use `hyp()`/`hyp3()` (never
  `Math.hypot`), `hasKey`/`numOr` for network values, pooled temporaries
  (`_v1`, `_v2`, `_r`, …). Measured: a stray per-frame array is ~100 ns (noise),
  but hundreds of them (see the SSAO cut pass) are real GC pressure.
- **Static collision and navigation.** `COL`/`RAMPS`/`NAV` are built once at map
  load; never add geometry at runtime (no dynamic colliders).
- **Map-owned objects** go through `mapAdd()` so `mapUnload` frees them.
- **Player-facing text**: French source, English default → every new string needs
  a key in `i18n/en.txt` (`check_i18n.py`), and **no semicolons** in player text
  (build.py's style check).
- **Comments in French** in every file you touch.
- **`dist/` is generated** — never edit it; `docs/assets.md` likewise.
- Two files share the `09i-` prefix (`09i-chat.js`, `09i-modes.js`); order is
  still deterministic.

## 10. Docs in this folder

| File | Contents |
|---|---|
| `OVERVIEW.md` | This file |
| `assets.md` | Auto-generated asset inventory (do not edit) |
| `performance-pass.md` | First performance audit (inventory + candidates) |
| `performance-pass-2.md` | Verification of the independent review + the combined ladder |
| `mode-frontline-push.md` | Planned mode: asymmetric A→B→C attack/defend + tickets |
| `mode-hunter-killer.md` | Planned mode: the Juggernaut role transfers on kill |
| `mode-salvage-race.md` | Planned mode: two teams race for shared caches |
| `mode-sandstorm.md` | Planned bonus mode: the closing ring + scavenging |
