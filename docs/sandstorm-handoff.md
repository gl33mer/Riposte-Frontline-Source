# Handoff prompt — implement Sandstorm, phase P1 + P2

**Read this as a prompt to yourself, in a fresh session.** You are picking up a
mature, heavily optimized browser FPS (three.js r147, one global scope, French
comments, English player text). Everything below is verified against the source
(`file:line` given) — do not re-derive it from scratch, but do read the files
you touch.

## 0. Read first (in this order)

1. **`AGENTS.md`** — the non-negotiable rules (single global scope, alphabetical
   load order, static collision/nav, no per-frame allocation, `hyp`/`hasKey`/`numOr`,
   `PL`/`BOT_STATE` literal discipline, French comments, `dist/` never edited,
   player text needs `i18n/en.txt` keys and no semicolons, `check_decl.py`).
2. **`docs/OVERVIEW.md`** — the map of the repo: the boot/frame/`matchTick`
   flows, the source layout, the mode recipe (§6), the networking layer, the
   performance culture, and the traps.
3. **`docs/mode-sandstorm.md`** — the full mode plan. This handoff implements
   **P1 and P2 only**; P3 (loot) and P4 (menus/polish) come later, after the
   owner tests.

Mode identity: id `storm`, FR « Tempête », EN "Sandstorm". Solo-only in v1
(player alone, all bots hostile — the Survival roster trick).

## 1. Scope — exactly P1 + P2, nothing else

**P1 — the wall and the stages (playable end-to-end, bots dumb is fine):**
- `MODES.storm` + `MODE_IDS` in `src/09i-modes.js`:
  `name/btn/sub/teams/lim/limits: null/key: null/respawn: Infinity/botRespawn: <see §3.2>/prot: 2/hint`.
- `const STORM = { r0, rMin, stage, stages, tStage, t }` (new global, stable shape).
- `stormInit()` called from `modeStart()` (after the map is loaded): take the
  map's authored ring when it has one, else synthesize one — see §3.1 for the
  exact fields including **`hard`**.
- `stormUpdate(dt)` from `modeUpdate()`: advance one stage every `tStage`
  seconds, shrink `RING.r` (and keep `hard` ahead of it), tighten the grace
  `RING.t`, announce each stage (`hudMsg` + `sfxAnnounce`).
- Reuse the existing out-of-zone UI for free: `ringHud` draws the veil and the
  countdown when the player is outside (`src/02-relief.js:205+`, already called
  from `updateHud`). **Do not build new out-of-zone UI.**
- Reuse the existing kill path: `ringCheck` → `zoneDeath` → `killEnt` with the
  « Désert » cause, credited to the last shooter within 5 s
  (`src/02-relief.js:187-203`). Working for **all** soldiers already (§3.3).
- `stormClear()` from `modeEnd()`, and **restore the ring from the map** (§3.1).

**P2 — flow, victory, death, HUD:**
- **Victory check** in `stormUpdate` (host/solo authority): no live hostile bot
  left → `matchFinishSoon()`. The player is alive at that moment → the result
  computes as a win (§3.4).
- **Death trigger**: the player's death ends the run — extend the solo survival
  trigger in `killEnt` (`src/09-game.js`, the block that sets `MATCH.finalPending`
  and calls `matchFinishSoon()`; the condition is currently
  `MATCH.mode === 'survival' ? v.isPlayer : killLimitReached()`).
- **Result plumbing**: `matchOutcome` and `finKicker` (`src/09l-fin.js`), plus
  `fillEnd`/`endMatch`'s single-board route and `fillEndFfa`'s caption flag
  (`src/09-game.js`) — mirror the Survival branches exactly.
- **HUD**: extend the Survival branch in `updateHud` (`src/09-game.js`:
  `scA` = kills, `scB` = live hostile bots, `#timer` = elapsed
  `fmtTime(-MATCH.timeLeft)`, `#scLim` = "Tempête {stage}/{stages}" written once
  per stage — not per frame), and join the mode in `modeStart`'s score-row labels
  + the `.score` class toggle that hides row B/bars/limits.
- **The timeout guard**: `matchTick`'s `timeLeft <= 0` → `matchFinish()` must skip
  `storm` as it skips `survival` (`src/09-game.js`, the line with
  `MATCH.mode !== 'survival'`), and `startMatch` must start `MATCH.timeLeft` at 0
  for storm like it does for survival (`mode === 'survival' ? 0 : …`). **If you
  forget either, the match ends on frame 1 or the clock counts down instead of up.**
- `modeRoster`: extend the Survival branch to storm (`e.team = surv ? 1 : e.team0`
  → include storm) — **critical**, see §3.5.
- `killLimitReached`: `storm` → `false` (end conditions live in `stormUpdate`).
- Menus: `matchRows` must hide the difficulty/limit/duration rows for storm and
  exclude it from the online lobby; give it a `teams` line and a `hint`.

**Not in this phase:** loot drops (P3), menu polish/balance (P4), any team
variant, any networking (solo-only; the online filter excludes `storm`).

## 2. Files you will touch (and why)

| File | Change |
|---|---|
| `src/09i-modes.js` | `MODES.storm` + `MODE_IDS`; `STORM` state; `stormInit`/`stormUpdate`/`stormClear`; hooks in `modeStart`/`modeUpdate`/`modeEnd`; `modeRoster` team forcing; `killLimitReached` |
| `src/09-game.js` | `updateHud` HUD branch; `matchTick` timeout guard; `startMatch` timeLeft + `#scLim` line; `killEnt` death trigger; `fillEnd`/`endMatch` routing |
| `src/09l-fin.js` | `matchOutcome` + `finKicker` storm branches |
| `src/09b-killcam.js` | `kcSkip` respawn gate (`MATCH.mode !== 'survival'` → also storm) |
| `src/09e-menus.js` | `matchRows`: the `surv` flag, the online filter, the teams text |
| `src/07-bots.js` | `botDiff()` — decide the difficulty row for storm (§3.6) |
| `src/02-relief.js` | **Nothing** — RING is read/overridden from outside; only reuse its helpers |
| `i18n/en.txt` | every new player-facing key |

## 3. Traps and gotchas (verified — these will bite otherwise)

### 3.1 The ring: three fields, one persistence trap
`RING = { on, x, z, r, hard, t }` (`src/02-relief.js:19`), set per map by
`reliefBuild`: `RING.on = !!(D && D.ring); if (RING.on) Object.assign(RING, { x: 0, z: 0, t: 10 }, D.ring)` (`:27`), cleared by `mapUnload` (`:79`).

- **`hard` is a movement clamp, not decoration.** `src/02-map.js:217` pulls any
  position back to the circle of radius `hard` ("pas plus loin que hard"). The
  default `hard = 1e9` means *no* clamp, so players could run to the map edge
  while `r` shrinks without ever leaving… wait — they *do* leave `r` (the grace
  timer runs), but they can wander arbitrarily far. **Set `hard = r + ~10 m`**
  (exactly what Simoun does: `ring: { r: SM_R, hard: SM_R + 10, t: 10 }`,
  `src/02yl-simoun.js:452`) so players can step just outside (grace + veil) but
  not run away.
- **Only Simoun ships a ring** (`02yl-simoun.js:452`; the `ring: true` in
  `02yc-cyclades-bati.js:69` is an unrelated prefab flag). The other eight maps
  need a synthesized ring: centre = map rectangle centre (`MAP.x0/x1/z0/z1`,
  used by the `netPos` clamp in `src/09c-net.js:843`), `r0` = half the larger
  extent + margin, `rMin ≈ 0.18 * r0`, `hard = r + 10`, `t = 10`.
- **THE PERSISTENCE TRAP:** `mapSetup`/`reliefBuild` run only on a *map build*.
  `mapEnsure` returns early when the map is already loaded
  (`src/09a-loading.js:30`), and a map stays loaded for a while
  (`MAPL_KEEP = 60 s`). So **a storm match followed by a Rejouer (or any match)
  on the same loaded map would inherit the shrunk ring** — players would die in a
  TDM match. Fix: derive the ring from the map in `modeStart` for **every** mode
  (mirror `reliefBuild`'s line: `RING.on = !!(CURMAP.def && CURMAP.def.ring)` +
  `Object.assign` from the def), then let `stormInit` override it; and also
  restore it in `stormClear`/`modeEnd` as a belt. Two lines, kills the whole class
  of bug (also test: storm → Rejouer → storm, and storm → menu → TDM on the same map).

### 3.2 `botRespawn`: no respawns *and* corpses are mutually exclusive
`killEnt` gives dead bots `v.respawnT = modeDef().botRespawn`
(`src/09-game.js:91`); `updateBot` respawns when it reaches 0
(`src/07b-tactics.js:212`). But `animSoldier` treats **`respawnT === Infinity` as
"out of play"** and hides the body with no ragdoll (`src/06b-soldier.js:485-491`,
the branch whose comment lists `modeRoster`/`netBotOff`/`startMatch`).
- `botRespawn: Infinity` → no respawn ✓ but **dead bots vanish instantly, no corpse**.
- `botRespawn: 1e6` → no respawn in any realistic session ✓ **and corpses stay**
  (verified: a dead bot only runs `releaseCover` + `animSoldier` + the respawn
  arithmetic, `src/07b-tactics.js:209-214`; `respawnT < 0.9` controls the sink, so
  no sinking with a huge value; ragdolls sleep after ~12 s, 11 corpses max).
- Recommendation: **`1e6`** for flavour; either is acceptable — state your choice
  in the commit message. Player side: `respawn: Infinity` ✓ (the run ends on death
  anyway). Also note `kcSkip` would respawn a dead player on Space/click — it is
  already gated for survival (`src/09b-killcam.js:211`); **extend that gate to
  storm** even though the death screen only lives ~1 frame there.

### 3.3 The ring already kills everyone (verified — no extra code)
`ringCheck` is called per soldier after movement:
`src/08-player.js:337` (player), `src/07b-tactics.js:536` (bots — with the note
that bots have no nav nodes outside the circle), `src/08e-fpv.js:198` (drone).
`e.outT` (seconds outside) is a pre-existing field: `outT: 0` is in `BOT_STATE`
(`src/07-bots.js:78`); for `PL.ent` it is created lazily on ring maps — that is
pre-existing behaviour, **do not add more runtime fields to `PL.ent`** (V8 shape
discipline; keep storm state in `STORM`). Do not confuse it with the unrelated
`outT` parameter of `ik2` (`src/06b-soldier.js:17`).

### 3.4 Endings
- Victory: no live hostile left → `matchFinishSoon()`. `matchOutcome` for storm:
  `PL.ent.alive ? 'win' : 'loss'` (mirror the Survival branch in
  `src/09l-fin.js`). Death of the player goes through `killEnt`'s solo trigger and
  sets `MATCH.finalPending` → the **final killcam of your own death still plays**
  (that is the Survival flow, keep it); the win path has no killcam (no final
  kill) → straight to the results, like domination/time-out.
- `#scLim`/strip and the HUD must not fight the Survival branch: extend the
  existing `if (MATCH.mode === 'survival')` in `updateHud` with `|| 'storm'` rather
  than adding a parallel branch, as the two share the layout.
- The `.score.surv` CSS class (hides row B, bars, the limit strip) is applied in
  `modeStart`; include storm in that toggle and reuse the same class (no new CSS).

### 3.5 The roster/team forcing is load-bearing
If you forget `modeRoster`'s team forcing for storm, bots stay on their boot
teams — five of them share **team 0 with the player**, so `allied()` makes them
teammates, `applyDamage` suppresses their hits on you, and you get an invulnerable
co-op stroll instead of a survival match. Extend the Survival line
(`src/09i-modes.js:57-70`: `e.team = surv ? 1 : e.team0` and the `surv` flag used
for the HUD/roster comments) to include `storm`. The FFA `off` cut must **not**
apply (it does not: the cut is built only for ffa ✓) — all bots stay in play.

### 3.6 Menus and difficulty
`matchRows` (`src/09e-menus.js:444-461`) does `MD.limits.map(...)` for the limit
row — storm must have `limits: null` **and** be inside the `surv` flag that skips
those rows, or the lobby crashes. Decide the difficulty row explicitly: Survival
hides it because `DIFF_SURV` is fixed. Simplest consistent choice for storm:
**join `surv` in `matchRows` and use `DIFF_SURV`** (`botDiff()` in
`src/07-bots.js:13` — extend its survival test to storm) — 11 hostile bots is the
same problem Survival solved. Note the alternative (keep the row, use the normal
`DIFF`) in your report if you disagree; either is defensible, but be explicit.
Also exclude `storm` from the **online** lobby (the `(id !== 'survival' || !o.online)`
filter) — it is solo-only.

### 3.7 House rules that apply here (short list)
- French comments in every file you touch; player strings via `_t()` with a key in
  `i18n/en.txt`; **no semicolons** in player text (build.py's style check fails the
  build); no forbidden dashes.
- No per-frame allocation: the stage check is a timer + a few writes; write the
  strip/announcement only when the stage actually changes (not per frame).
- New top-level names must be unique (`STORM`, `stormInit`, `stormUpdate`,
  `stormClear`, `STORM_*` are free — grep `storm` first).
- Never edit `dist/`.

## 4. Fast ways to test (the full storm is slow)

Solo menu → **Tempête** (the setup page shows no limit/duration rows).
Test on **Simoun** first (authored ring), then **Khamsin** (synthesized ring).
From the browser console (`STORM`/`RING` are globals):
- `STORM.stages = 3; STORM.tStage = 5` — a whole storm in ~15 s;
- `RING.r = 8; RING.hard = 18` — instant wall around the player;
- `RING.t = 4` — shorter grace before the zone kill;
- the death is credited to your last shooter within 5 s (`zoneDeath`) — shoot a
  bot, let the wall take it, and check the killfeed/score.

## 5. Acceptance for P1+P2 (report these in your summary)

- [ ] The wall is visible/announced; each stage shrinks it and shortens the grace;
      the veil + countdown appear when outside; death is credited and shows the
      « Désert » cause.
- [ ] Nobody respawns (player or bots); the roster thins; all bots hostile.
- [ ] Killing the last bot wins the run ("Vous avez survécu à la tempête"); dying
      ends it with survived time + kills; both end screens are correct (single board).
- [ ] `storm` → Rejouer → `storm`, and `storm` → menu → TDM on the same loaded map:
      the ring is correct in every case (no leaked shrinking wall).
- [ ] Bots die to the ring as it closes (watch a bot outside the wall).
- [ ] Solo menu shows the mode; the online lobby does not.
- [ ] Regression: Survival (solo + co-op), FFA, TDM, dom unaffected.

## 6. Workflow

1. Branch: `feature/sandstorm` off the current `feature/coop-survival` (the branch
   the owner deploys) unless told otherwise.
2. Implement P1, then P2. After each: `python3 build.py` +
   `python3 tools/dev/check_decl.py` + `python3 tools/dev/check_i18n.py`; fix
   before moving on.
3. **Stop after P2 and report for testing** — do not start P3 (loot) unprompted.
   Report: what changed (files), the acceptance list above, the **new build id**
   (the front-page badge shows `Version 5.6.0 · <id>`; `build.py` prints
   `identifiant de version : <id> · <date>`) so the owner can confirm the deploy,
   and any open decisions you made (§3.2 corpses, §3.6 difficulty).
4. Commit in logical units (mode shell / flow+HUD / menus+i18n) and push.
