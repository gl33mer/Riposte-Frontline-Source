# Mode: SANDSTORM (the closing ring) — implementation plan

Riposte: Frontline · bonus mode, added on request ("anything creative aligned
with the codebase"). Not implemented. Mode id: `storm`. Working names:
FR « Tempête », EN "Sandstorm".

---

## 0. Concept and rules (v1)

A sandstorm closes on the map in stages. Outside the moving wall you get a
countdown, then die (the existing out-of-bounds rule). **No respawns** — every
death is final, so the roster thins as the wall tightens. The player starts with
their class and **scavenges** the map: weapon drops are scattered at random
reachable points (and enemies drop their weapons on death, as always). The run
ends when the player dies (defeat, with survival time and kills) **or when every
hostile bot is down (a real victory — "you survived the storm")**.

Solo first (the mode is solo-only in v1, like Survival): player alone, all bots
hostile. A team/last-team-standing variant is a documented stretch (§6).

**Why it is creative but cheap:** it joins three systems that already exist and
have never been combined — the per-map **out-of-bounds ring** (with its ready
veil/countdown HUD), the **drop/pickup economy**, and Survival's
**hostile-roster trick** (player team 0, all bots team 1).

## 1. What it reuses (evidence)

| Need | Existing system |
|---|---|
| The wall, the death, the credit | `RING { on, x, z, r, hard, t }` set per map from `CURMAP.def.ring` (02-relief.js:19-27, teardown :79); `ringCheck` (187-194) → grace `RING.t` then `zoneDeath`; `zoneDeath` (196-203) credits the last shooter within 5 s and kills with the « Désert » cause (`NET_WSPECIAL.zone`, no killcam) |
| Out-of-zone UI (veil + seconds) | `ringHud` (02-relief.js:205+) — `#ringOut` veil darkening with `--k`, countdown to death. **Free.** |
| No respawns | `MODES.storm.respawn: Infinity` (Survival precedent) and `botRespawn: Infinity` → `killEnt` sets `respawnT = Infinity` → the `updateBot` respawn tick never fires (07b-tactics.js:212). Bots simply stay dead: the thinning emerges with **zero code** |
| Hostile roster | Survival's `modeRoster` branch (all bots team 1, no `off` cut, 09i-modes.js:53-70) — reused verbatim for `storm` |
| Loot | The drop construction (`DROP.list.push`, 08c-pickups.js:41) and the pickup path (`updateDrops`: ammo + swap by proximity); enemies already drop weapons on death (`dropKilledWeapon` in `killEnt`) |
| Player death ends the run | Survival's `killEnt` trigger (`!MATCH.online` + `v.isPlayer` → `MATCH.finalPending` + `matchFinishSoon`) and the `matchOutcome`/`finKicker`/`fillEnd`/`endMatch` survival branches |
| HUD/timer/strip/end screen | The Survival HUD branch (09-game.js:323-325), the round strip pattern (`#scLim`), the elapsed clock (`fmtTime(-MATCH.timeLeft)`), the single-board end (`.one`, `fillEndFfa`) |
| Reachable random points | `SPAWNS[0].concat(SPAWNS[1], spawnField())` + `navNode`/`gy0` (the `survOpen` picker) for loot and for any ring fallback centre |

## 2. State and data model

```js
/* Tempête : la zone qui se referme, et ses étapes */
const STORM = { r0: 0, rMin: 0, stage: 0, stages: 6, tStage: 45, t: 0, loot: [], started: false };
```
`MATCH.score` unused (like Survival); kills shown from `PL.ent.kills`.

## 3. Integration points (ordered)

**09i-modes.js**
1. `MODES.storm` + `MODE_IDS`: `name/btn/sub/teams: _t('Vous seul, la tempête se referme') / lim: _t('Sans limite') / limits: null / key: null / respawn: Infinity / botRespawn: Infinity / prot: 2 / hint`.
2. `stormInit()` from `modeStart` (after the map is loaded — `modeStart` already runs post-load): centre = the map's authored `RING.x/z` when `CURMAP.def.ring` exists, else the map rectangle's centre (`MAP.x0/x1/z0/z1`, the clamp source in 09c-net.js:843); `STORM.r0` = the authored `RING.r` or half the map's larger extent + margin; `STORM.rMin = 0.18 * r0`; force `RING.on = true`, `RING.x/z`, `RING.r = r0`, `RING.t = 10`; scatter the loot (§ below).
3. `stormUpdate(dt)` in `modeUpdate`: every `STORM.tStage` s advance a stage (`stage++`, `RING.r = lerp(r0, rMin, (stage/stages)^1.15)`, `RING.t = lerp(10, 4, stage/stages)` — the wall gets deadlier as it tightens), announce "La tempête se referme ({stage}/{stages})" (`hudMsg` + `sfxAnnounce`); **victory check**: no live hostile left → `matchFinishSoon()` (the player is alive → win).
4. Mode roster: reuse the Survival branch (`MATCH.mode === 'survival' || MATCH.mode === 'storm'`) for the all-bots-team-1 forcing.
5. `killEnt`'s solo trigger: add `storm` to the survival test (`(MATCH.mode === 'survival' || MATCH.mode === 'storm') ? v.isPlayer : killLimitReached()`).
6. `killLimitReached`: `storm` → false (like survival).
7. `modeEnd`: `stormClear()` (nothing to dispose beyond loot bookkeeping; `RING.on` is reset by `mapSetup`/teardown, line 79 — confirm).
8. Loot: `stormLoot()` — drop `N` (e.g. 6) weapons at random reachable points (the `survOpen` picker), built through the existing drop path (08c-pickups.js:41 pattern, weapon defs from `WEAPONS`). The player picks them up by walking over them (`updateDrops` handles ammo and swap). Note the limitation: **bots do not loot** (they keep their spawn weapon) — acceptable for v1.

**09-game.js / 09l-fin.js (display and end)**
9. `updateHud`: `storm` joins the survival branch — `scA` = kills, `scB` = live bots remaining ("Bots restants"), `#timer` = elapsed (`fmtTime(-MATCH.timeLeft)`) or the stage countdown, `#scLim` = "Tempête {stage}/{stages}"; the veil is already drawn by `ringHud(e)` (09-game.js:325).
10. `matchOutcome` storm branch: `PL.ent.alive ? 'win' : 'loss'` — win sub "Vous avez survécu à la tempête · {kills} éliminations", loss sub "Vous avez survécu {time} · {kills} éliminations" (the survival wording); `finKicker`: "Tempête passée" / "Pris par la tempête".
11. `fillEnd`/`endMatch` `.one` (single board): add `storm` to the survival/ffa route; `fillEndFfa`'s survival caption branch covers it (or reuse it with the storm wording).
12. `matchTick`'s timeout is irrelevant (no time limit) — Survival's guard (`MATCH.mode !== 'survival'`) must also skip `storm`, or set `MATCH.timeLeft = 0`-style; simplest: extend the guard to `storm`.

**Offline-only plumbing**
13. Menus: solo-only, like Survival — `matchRows`' online filter must exclude `storm` too (`(id !== 'survival' && id !== 'storm') || !o.online`); the solo setup skips the limit/duration rows exactly as it does for survival. **No networking work at all** (a stretch team variant would add a `st: {r, stage}` field to `'ps'`, mirroring `survNetState`).
14. i18n: mode name/sub/teams/hint; "La tempête se referme"; "Vous avez survécu à la tempête"; "Pris par la tempête"; "Bots restants"; plus the existing "Désert" death cause (already translated).

## 4. Phases (dependency order)

- **P1 — the wall:** MODES entry, `stormInit` (ring override + defaults), `stormUpdate` stages, the ring HUD already warns — playable solo: the player dies outside, bots die too (their existing `ringCheck` path), no respawns.
- **P2 — flow:** the victory check, the death trigger, `matchOutcome`/`finKicker`/end-screen routing, the HUD numbers and strip, the `matchTick` timeout guard.
- **P3 — loot:** `stormLoot` scatter + pickup verification; balance the count/placement (near objectives/traffic).
- **P4 — menus/i18n/polish/balance:** solo-only filter, texts, stage timing (`tStage`/`stages`), grace tightening; optional flavour — dust particles at the edge (reuse the `mapDressing` snow-style system, 02z-load.js:98, tinted sand) and a sky/bloom dim during late stages (per-map `atmo.bloom`), both marked optional.

## 5. Risks and open questions

- **`ringCheck` coverage**: confirm it already runs for every soldier on ring maps (it does in production for the maps that ship a ring; the plan's first P1 task is to verify the call site for bots and remotes — if it is only in the player's HUD path, add it to the bot/remote update).
- **`RING.hard`** (default 1e9, unused by `ringCheck` as read) — verify what consumes it (minimap or veil) before overriding the ring, so a shrinking `r` does not leave `hard` stale.
- **Grace vs. attrition**: v1 keeps the existing grace→death model (10 s → 4 s). A damage-over-time variant (escalating `applyDamage` with the « Désert » cause) is a nicer feel but adds a per-entity damage path — documented as an option, not v1.
- **Bots outside an early ring**: with `r0` covering the map, nobody dies until the wall moves; ensure the first stage's radius does not clip a base (clamp `r0` to contain both `SPAWNS`).
- **Solo win path**: killing all bots is a long shot with 11 hostiles that never respawn — that is the point; consider starting bots at a reduced count (Survival's `survBotCap` style, e.g. 8) so the win is reachable. Owner's call.
- **Team/FFA stretch variant** (§6) needs the spectate cam for the many dead — cross-reference `spectate-death-cam-options.md`.

## 6. Stretch (documented, not v1)

- **Team storm / last team standing**: two teams, no respawns, the match ends when one team is wiped (the survival `survUpdate` alive-count pattern, 09i-modes.js); needs `st: { r, stage, t }` on the `'ps'` packet (mirror `survNetState`) and a spectate cam for the dead.
- **Loot tiers**: name a few high-value drops (e.g. the sniper / the shotgun) at the stage boundaries, with a `hudMsg` reveal — pure tuning, no new systems.

## 7. Validation checklist

- [ ] The wall is visible from the start or appears at stage 1; the veil + countdown warn when outside; death is credited to the last shooter and uses the « Désert » cause.
- [ ] Each stage announces and visibly tightens the wall; the grace shortens; the strip shows the stage.
- [ ] Nobody respawns — player or bots; the roster thins; the player wins when the last bot falls; dying ends the run with time + kills.
- [ ] Loot lies at random reachable points and can be taken/ swapped by proximity; enemies still drop their weapons.
- [ ] Solo menu shows the mode (not in the online lobby); no networking code runs.
- [ ] Regression: Survival (solo + co-op), dom, TDM, FFA, co-op unaffected; ring maps' original out-of-bounds behaviour unchanged outside this mode.
