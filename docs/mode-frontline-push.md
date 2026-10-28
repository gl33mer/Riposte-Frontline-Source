# Mode: FRONTLINE PUSH (asymmetric attack/defend) — implementation plan

Riposte: Frontline · new-mode plan. Not implemented. Grounded in existing
systems (file:line). Mode id: `push`. Working names: FR « Percée », EN "Frontline".

---

## 0. Concept and rules (v1)

Two teams on any map. **Attackers** (team 0) must capture three objectives **in
order** (A → B → C). **Defenders** (team 1) hold them and have a **limited pool
of respawn tickets**. Win/lose:

- Attackers capture C → **attackers win**.
- Defender tickets reach 0 → **attackers win** (defenders can no longer respawn).
- Match timer (`Settings.minutes`, existing `MATCH.timeLeft`) expires → **defenders win**.

Tunables (v1): ticket pool per lobby limit row (`limits: [40, 60, 80]`),
capture rate, capture radius, forward-spawn behaviour, timer from the existing
duration row. Killstreaks stay as they are (objective score ≈ +100 per capture
is the momentum reward; a streak-credit variant is a follow-up knob).

## 1. What it reuses (evidence)

| Need | Existing system |
|---|---|
| Objective points | `DOM.pts` — maps with `.dom` already author three symmetric points "A près de la base d'Alpha, C près de la base de Bravo" (09i-modes.js:335-363) → **the push line is the dom line**, direction by base. Maps without `.dom` get points derived from `SPAWNS[0]`/`SPAWNS[1]` + `spawnField()`/`navNode` (same grounding as `domInit`, 09i-modes.js:350) |
| Zone counting / contest | `domUpdate` (09i-modes.js:424-461): per-point entity count, contest, `p.v` progress |
| Marker mesh / minimap / pills | `domBuild` (404-417), `domMinimap` (555-564), `domRow` pills + `domCap` capture bar + `domHud` (501-538) |
| Host-authoritative sync | `domNetState`/`domNetApply` (465-473) riding the `'ps'` packet (`dm:` field, 09c-net.js:1192/773) |
| Bot plan | `07d-squad.js` — per-team plan with per-point need/urgency, attack/defend roles, `domSpot` bot spots (09i-modes.js:542-549) |
| Spawns | `spawnPool`/`spawnBase`/`spawnRate`/`spawnYaw` (09i-modes.js:186-324) — team-based pools and front logic |
| End / outcome / announce | `matchFinishSoon`/`matchFinish`/'end' broadcast, `matchOutcome`/`finKicker` (09l-fin.js), `hudMsg`, `sfxAnnounce` |
| Timed finish | `matchTick`'s `timeLeft <= 0` → `matchFinish()` (09-game.js:738) — **free** |
| Respawn gating | the survival/Endless pattern: gates at `updateDeadPlayer` (08-player.js:537) and `kcSkip` (09b-killcam.js:211) |

## 2. State and data model

```js
/* Percée : la ligne d'objectifs, l'objectif actif, les billets des défenseurs */
const PUSH = { pts: [], i: 0, atk: 0, def: 1, tickets: 60, ticket0: 60, done: false, tex: null };
```
`PUSH.pts` records mirror `DOM.pts` shape (`{ i, name, x, z, y, owner, v, n, contest, obj, el }`)
so `domBuild`/`domHud`/`domMinimap`/`domSpot` work unchanged on them.
`MATCH.limit` = `Settings.limitPush` (ticket pool). `MATCH.score` = `[captured, tickets]`.

## 3. Integration points (ordered)

**09i-modes.js**
1. `MODES.push` + `MODE_IDS`: `name/btn/sub/teams/lim/_t('Objectifs')/unit/limits:[40,60,80]/key:'limitPush'/respawn:4/botRespawn:5.5/prot:2/hint`.
2. `pushInit()` — build `PUSH.pts` from `CURMAP.def.dom` when present (order by distance from `spawnMid(SPAWNS[0])`), else derive three points (near attacker base / midpoint / near defender base) via `spawnField()` + `navNode` grounding; `domBuild(p)` each; fill `#domRow` pills; store `PUSH.ticket0 = MATCH.limit`.
3. `modeStart`: `if (MATCH.mode === 'push') pushInit();` next to `domInit()`; HUD labels via the existing `.score .row span` write (09i-modes.js:45) — row A "Objectifs", row B "Billets".
4. `modeUpdate`: `else if (MATCH.mode === 'push') pushUpdate(dt);`.
5. `pushUpdate(dt)`: count entities in the **active** point (reuse `domUpdate`'s radius test, `DOM.dy`), contest freeze, progress `p.v` 0→1 for attackers only; at 1 → `pushCaptured()` (lock `owner = atk`, `PUSH.i++`, announce, `+100` to attackers present, `domChanged`-style); host-side end checks (C captured / tickets 0) → `matchFinishSoon()`.
6. `killLimitReached`: `if (MATCH.mode === 'push') return false;` (end conditions live in `pushUpdate`, like `dom`).
7. `modeEnd`: `pushClear()` (dispose markers like `domClear`) — or reuse `domClear` if the points live in `DOM.pts`.
8. **Bots:** introduce `function objectives() { return MATCH.mode === 'push' ? PUSH.pts : DOM.pts; }` and swap the hard `DOM.pts` reads in `07d-squad.js`, `spawnYaw` (:319-322), `spawnRate` (:243-252), `spawnPool` (:191) for it (default stays `DOM.pts` → **dom unchanged**). Attackers attack `PUSH.i`; defenders defend `PUSH.i` (reuse the squad "attack/defend" roles; urgency = the active point).
9. **Spawn advance:** in `spawnPool`'s push branch, the attacker pool = `SPAWNS[0]` + field points **near/before the front**; once A is captured, add A's neighbourhood as a forward spawn (attackers only). Defender pool = base + around the active point.

**09c-net.js**
10. `netCfg`: `push` needs no new field beyond the ticket pool (`limit` already validated through `limits`) ✓ nothing to add (verify `limits` includes the pool values).
11. `netUpdate`: `pv: MATCH.mode === 'push' ? pushNetState() : undefined` on the `'ps'` publish (mirror line 1192); clients apply in the `'ps'` case (mirror line 773): `pushNetApply(m.pv)`.
12. `pushNetState`/`pushNetApply` in 09i-modes.js: `{ i, v: [progress…], o: [owners…], tk: tickets, dn: done }` — plain numbers, `numOr`-guarded on apply (host is authority, exactly like domination).
13. `netRebalanceBots`: push is a normal two-team mode → it already fills both teams via `NET_TEAM - hum[t]` ✓ no change.

**09l-fin.js / menus / HUD**
14. `matchOutcome` push branch: winner = `PUSH.done ? PUSH.atk : PUSH.def`; `sub` = "Objectifs {n}/3 · billets {t}". `finKicker`: "Objectifs percés" / "Billets épuisés" / "Temps écoulé".
15. `updateHud`: push branch writes `scA` = captured (0-3), `scB` = tickets, bars `scaleX(captured/3)` and `scaleX(tickets/ticket0)`, `scLim` = "Objectifs {i}/3"; `domRow` visible with the three pills (colors: captured by attackers = ally, active = hot, defender-held = enemy, neutral = dim) — the existing `domHud` colour logic per point carries over.
16. `matchRows`: push is a normal two-team mode → mode row + bots row + ticket limit row + duration row all work as-is ✓ (no filter change — unlike dom, push does **not** require `.dom`); teams text: `_t('Attaque contre défense, trois objectifs à percer')`.
17. i18n keys (FR → EN): mode name/sub/teams/hint; "Objectifs", "Billets", "Objectif {0} capturé", "Objectif {0} tenu", "Billets des défenseurs épuisés", "Objectifs percés", "La ligne avance : objectif {0}", etc.

## 4. Phases (dependency order)

- **P1 — shell, playable solo with dumb bots:** MODES entry, `pushInit` (line + pills), capture of the active point, lock/advance, end conditions, `matchOutcome`/`finKicker`, HUD numbers/bars, `domCap` bar reuse. Bots still wander (dom paths not yet pointed at push) — enough to see the mechanic.
- **P2 — capture polish:** contest freeze, capture announcements/pings, `+100`, pill colours, forward-spawn advance for attackers.
- **P3 — tickets:** decrement on defender death (`killEnt` hook: `if (MATCH.mode === 'push' && v.team === PUSH.def) PUSH.tickets = max(0, tickets-1)`), respawn gates (both respawn paths), "billets épuisés" end + HUD.
- **P4 — bots:** the `objectives()` accessor + squad/attack/defend roles + `spawnYaw`/`spawnPool`/`spawnRate` push branches. **Regression-check dom.**
- **P5 — network:** `pv` state + apply + host authority; verify the respawn gates and the ticket HUD sync.
- **P6 — menus/i18n/polish:** texts, hint, balance pass (capture rate, tickets, forward spawn), end-screen wording.

## 5. Risks and open questions

- **Squad generalisation is the main regression risk** (dom shares the code). Mitigation: `objectives()` defaults to `DOM.pts`; no behaviour change unless mode is push.
- **Who attacks in solo?** v1: the player attacks (team 0), bots fill both teams. Confirm, or add a lobby toggle (attack/defend) later.
- **Bots attacking in order**: the squad plan is point-based; sequential push needs the plan to weight the *active* point overwhelmingly and keep a couple of defenders back. May need 1-2 iterations after P4 (measure with a watchful eye, not the perf recorder).
- **Forward spawn camping / spawn traps**: the existing `SPAWN_TRAP` avoidance helps; tune objective spacing.
- **Balance**: ticket pool × bot lethality (DIFF) — separate solo/online tuning may be needed (`DIFF` is already shared; the mode can pick its own row like `DIFF_SURV` if playtests demand).
- **Streak momentum** (owner's idea): attackers earning streak credit on capture — a small optional hook in `pushCaptured` (e.g. `a.streak++` for attackers present with streak tracking intact).

## 6. Validation checklist

- [ ] Three objectives appear in order, pills and minimap match; only the active one captures; contest freezes; capture locks and advances with an announce.
- [ ] Attacker forward spawn moves up after A and B.
- [ ] Defender death decrements tickets; at 0 defenders stop respawning (both respawn paths) and the match ends for the attackers.
- [ ] Timer expiry ends it for the defenders; C capture ends it for the attackers; end screen names the winner and shows objectives/tickets.
- [ ] Bots attack the active point and defend it (watch a full bot-only round via the lobby).
- [ ] Online: both machines show identical progress/tickets/pills (state at ~15 Hz); host death does not stop the mode; no desync after a capture.
- [ ] Regression: TDM/FFA/dom/survival unchanged (especially dom squad behaviour).
