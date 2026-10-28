# Mode: SALVAGE RACE (teams race for shared caches) — implementation plan

Riposte: Frontline · new-mode plan. Not implemented. Grounded in existing
systems (file:line). Mode id: `salv`. Working names: FR « Récupération », EN "Salvage".

---

## 0. Concept and rules (v1)

Two teams race for the **same** limited pool of caches (e.g. 5) dropped at
random reachable points. A cache is **secured** by holding its zone for
`SALV.hold` seconds (any team member inside; **contested** if both teams are
inside → progress frozen). A secured cache belongs to that team and leaves play.
First team to `Settings.limitSalv` caches (`limits: [2, 3, 4]`) wins; pool
exhausted → most caches wins; timer expiry → most caches wins (existing path).
Normal PvP respawns — killing is tactical, not the objective.

**This is the cheapest of the four modes**: ~70% is the extraction-loop code
generalised from one marker to a pool.

## 1. What it reuses (evidence)

| Need | Existing system |
|---|---|
| Random reachable cache points | `survOpen`'s picker — `SPAWNS[0].concat(SPAWNS[1], spawnField())` + `navNode`/`gy0` grounding + a minimum distance (09i-modes.js:survOpen) |
| Marker mesh + look | `survBuild` (group at x/y/z, ground ring + 3 m veil, `MeshBasicMaterial`, `mapAdd`, `polygonOffset`) and `survTextures`' canvas recipes |
| Pulse / minimap blink | `survMarkerTick` (09i-modes.js), `survMinimap(g, scale)` (blink at 2 Hz, disc + radius circle) |
| Hold mechanics | `survUpdate`'s in-zone test + `SURV.hold` accumulation; `#domCap` bar write (09-game.js) and the big `#cd` countdown (`survHoldShow`, 09i-modes.js) |
| Contest semantics | `domUpdate`'s per-point `n[team]` counting + `contest` (09i-modes.js:424-461) |
| Host-authoritative sync | `domNetState`/`domNetApply` (`p: [[v, owner]…]`) and `survNetState`/`survNetApply` — the `'ps'` packet fields (09c-net.js:1192/773) |
| Score/limit/end | `killLimitReached` (a `salv` branch), `matchFinishSoon`, the `timeLeft` timeout, `matchOutcome`/`finKicker` |
| HUD | `#scA`/`#scB` + bars (captures vs. the limit), `#scLim`, `#domRow` pills (one per cache), `#domCap` bar |
| Bot spots | `domSpot` (09i-modes.js:542-549) — "a standable spot in the zone" pattern, and the `objectives()` accessor proposed in the Frontline Push plan |

## 2. State and data model

```js
/* Récupération : le dépôt de caches, partagé par les deux camps */
const SALV = { caches: [], pool: 5, hold: 8, maxD: 90, tex: null };
// cache: { x, z, y, owner: -1, hold: 0, taken: false, obj, ringMat, veilMat, n: [0,0], contest: false }
```
`MATCH.score[t]` = caches secured by team t. `MATCH.limit = Settings.limitSalv`.

## 3. Integration points (ordered)

**09i-modes.js**
1. `MODES.salv` + `MODE_IDS`: `name/btn/sub/teams: _t('Deux camps, les mêmes caches à récupérer')/lim: _t('Caches à récupérer')/unit: 'caches'/limits: [2,3,4]/key: 'limitSalv'/respawn: 4/botRespawn: 5.5/prot: 2/hint`.
2. `salvInit()` (called from `modeStart`, next to `domInit`): pick `SALV.pool` distinct points (`spawnField`+`SPAWNS`, min distance from each other and from both bases, grounded via `navNode`), build each marker (`salvBuild(rec)`) and fill `#domRow` with one pill per cache.
3. `salvBuild(rec)` / `salvTextures()` / `salvMinimap(g, scale)` / `salvTickMarkers(dt)`: **written alongside the `surv*` ones** (small duplication, same recipes) rather than refactoring the shipped survival code — matches the house pattern (`domTextures` vs `survTextures` already coexist). `mapAdd` each marker so `mapUnload` owns it.
4. `modeStart`: `if (MATCH.mode === 'salv') salvInit();`; HUD row labels ("Caches" / "Caches") via the existing write at 09i-modes.js:45.
5. `modeUpdate`: `else if (MATCH.mode === 'salv') salvUpdate(dt);`.
6. `salvUpdate(dt)`: per unclaimed cache — count live entities in radius (`DOM.rad`/`DOM.dy` reuse) → `n[]`, `contest`; advance `hold` when exactly one team is present; at `hold >= SALV.hold` → `owner = that team`, `taken = true`, `MATCH.score[owner]++`, announce + `+100` to the holders, marker recolours (or fades out); host-side end check (`score >= MATCH.limit` → `matchFinishSoon()`).
7. `killLimitReached`: `if (MATCH.mode === 'salv') return false;` (end decided in `salvUpdate`, like dom).
8. `modeEnd`: `salvClear()` (dispose markers/textures, like `domClear`).
9. Bots: use the shared `objectives()` accessor (built once for Push/Salvage) so `07d-squad.js`/`domSpot`/`spawnYaw`/`spawnRate` treat caches as objectives; v1 goals = nearest unclaimed cache (`g.cache = i`, the `g.dom = i` pattern at 09i-modes.js:546); later refinement: split attackers between the two nearest caches and keep one defender on a held cache.
10. `spawnPool`: salvage is a normal two-team mode → the tdm-style pool (own half) is fine ✓ (no branch needed) — caches are spread over the field.

**HUD (09-game.js)**
11. `updateHud`: `salv` branch — `scA`/`scB` = caches secured, bars toward `MATCH.limit`, `scLim` = "Premier à {limit} caches"; `domRow` shown with one pill per cache (dim = unclaimed, ally = ours, enemy = theirs, hot = contested — the exact `domHud` palette logic, 09i-modes.js:501-538); `#domCap` bar for the cache you are standing in (the existing "inside" logic) and the big `#cd` countdown when securing (`survHoldShow` reuse).

**09c-net.js**
12. `'ps'` gains `sl: MATCH.mode === 'salv' ? salvNetState() : undefined` (mirror line 1192); client applies in the `'ps'` case (mirror line 773): `salvNetApply(m.sl)`.
13. `salvNetState`/`salvNetApply` (09i-modes.js): `[[owner, hold, taken]…]` — the **same shape as `domNetState`'s `p: [[v, owner]…]`**; host is authority (it counts everyone's positions, exactly as `domUpdate` does today — the client-side counting is already guest-gated by `domGuest()`; mirror that pattern).
14. `netCfg`: `salv` validates through the standard `limits`/`time` path ✓ nothing to add.

**Menus / i18n**
15. `matchRows`: normal two-team rows (limit row = caches) ✓ no filter change; teams text as above.
16. `matchOutcome`/`finKicker` salv branches: winner = higher caches (draw possible); kickers "Toutes les caches récupérées" / "Temps écoulé".
17. i18n: mode name/sub/teams/hint, "Caches", "Cache récupérée", "Cache disputée", "Récupération en cours", plus the reuse of "Extraction ouverte"-style strings where they fit.

## 4. Phases (dependency order)

- **P1 — shell, solo playable:** MODES entry, `salvInit`/markers/pills, `salvUpdate` hold+secure, score/HUD/bars, end conditions, `matchOutcome`/`finKicker`. Bots wander (no objective AI yet).
- **P2 — feel:** contest freeze, marker recolour on capture, `#domCap` + big countdown, announcements, minimap blink colours.
- **P3 — bots:** the `objectives()` accessor (shared with Push) + cache goals; regression-check dom.
- **P4 — network:** `sl` state + apply, host authority (position counting is host-side, mirroring `domUpdate`).
- **P5 — menus/i18n/polish/balance:** `SALV.pool`/`hold`/`maxD`, cache count vs. map size, texts.

## 5. Risks and open questions

- **Do not disturb survival**: build `salv*` functions alongside `surv*`; the only shared surface should be nothing at runtime (no shared mutable textures) — verify survival still passes its own checklist after P1.
- **Cache count vs. map size**: 5 caches on a small map is crowded, on a big map it is a long run — `SALV.pool`/`maxD` may need per-map-type scaling (`CURMAP.def.type` close/mid/open exists).
- **Bot coordination**: sharing the same caches needs the squad plan to avoid all bots stacking on one cache — the squad "need/urgency" logic (07d-squad.js) is designed for exactly this, so wiring caches into it (P3) is the real fix; v1 (nearest cache) will be crude.
- **Normal respawns make securing easy** (a defender dies, comes back) — that is intended (the race, not the fight, is the pressure). Tune `SALV.hold` up if securing feels trivial.
- **Optional later**: rounds with the map queue (reuse `survTransition`) — explicitly out of v1.

## 6. Validation checklist

- [ ] Five caches appear at distinct reachable points; pills/minimap match; the same caches are visible to both teams.
- [ ] Holding alone fills the bar; both teams inside freezes it (contested); securing recolours the cache, scores the team, and removes it from play.
- [ ] First to the limit ends the match; pool exhausted ends it by count; timer expiry ends it by count.
- [ ] Bots converge on unclaimed caches and contest them (watch a bot-only round).
- [ ] Online: identical cache states on both machines at ~15 Hz; host death does not stop the race; no desync after 3 captures.
- [ ] Regression: survival (solo + co-op, its own markers/HUD), dom, TDM, FFA unchanged.
