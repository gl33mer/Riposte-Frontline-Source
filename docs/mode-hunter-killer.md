# Mode: HUNTER/KILLER (juggernaut) — implementation plan

Riposte: Frontline · new-mode plan. Not implemented. Grounded in existing
systems (file:line). Mode id: `hk`. Working names: FR « Traque », EN "Manhunt"
(the role: « le Colosse » / "the Juggernaut").

---

## 0. Concept and rules (v1)

One combatant is the **Colosse**: 300 HP, ~0.62× movement speed, a distinctive
procedural look, revealed to everyone on the minimap and with an on-screen
marker. Everyone else hunts them. **Killing the Colosse makes the killer the
new Colosse** (full HP, immediately, where they stand); the dead Colosse
respawns as a hunter. Score = kills, with a bonus for taking down the Colosse.
Match ends on the kill limit (`Settings.limitHk`) or the timer
(`Settings.minutes`) — both existing finish paths. Bots backfill both roles.

## 1. The key design choice: the role **is** a team

Put **the Colosse alone on team 1**, all hunters on team 0. Everything
relational then works with **zero changes**:

| Behaviour | Why it is free |
|---|---|
| Hunters cannot hurt each other; anyone can hurt the Colosse | `applyDamage`'s ally check (09-game.js:14, online) + bots never target allies |
| Distinct look, ally chevrons, minimap colours | `skinRel` (06ga-tenues.js:66) → the Colosse renders as an enemy to hunters and vice versa |
| Bots do not shoot each other; the Colosse is the only valid target | target selection is team-based (`botSense`, 07-bots.js) |
| Remote team changes propagate | `netApply` already re-teams and re-skins remotes when their published team changes (09c-net.js:909) |
| Spawn bases, `spawnYaw` facing, spawn safety | the standard two-team paths (09i-modes.js:186-324) |

Scoring/HUD/end reuse the **FFA display path** (the same trick survival used):
`ffaList`/`ffaCmp`/`ffaRank`, `ffaScore` (`MATCH.score = [my kills, best]`),
`killLimitReached`'s ffa branch, `fillEndFfa`, and `matchOutcome`'s ffa branch —
all keyed on `ffa`/`survival` today; `hk` joins them.

## 2. State and data model

```js
/* Traque : le Colosse, et ses réglages */
const HK = { jug: null, hp: 300, slow: 0.62, scale: 1.18, bonus: 150 };
```
`MATCH.limit = Settings.limitHk` (new Settings key + `MODES.hk.limits = [20, 30, 50]`).
No new MATCH fields.

## 3. Integration points (ordered)

**Role and attributes**
1. `MODES.hk` + `MODE_IDS` (`name/btn/sub/teams: _t('Un Colosse traqué par tous')/lim _t('Limite d\u0027éliminations')/unit/limits/key:'limitHk'/respawn/botRespawn/prot/hint`); `Settings.limitHk` default in 01-core.js:46.
2. `spawnEntity` (07-bots.js:110): `e.health = MATCH.mode === 'hk' && e === HK.jug ? HK.hp : 100`.
3. Health-normalised feedback: a `healthMax(e)` helper used by the damage vignette (09-game.js:804) and any health-percentage read (prot/HUD) so a 300 HP Colosse reads correctly.
4. Speed: `ctlMove` (07c-controller.js:71) `if (MATCH.mode === 'hk' && e === HK.jug) spd *= HK.slow;` and the bot speed formula (07b-tactics.js:527) with the same test.
5. Look: a fifth tenue (`06ga-tenues.js` — `SKIN_OF_CAT`/`skinId`/`soldierPrebuild`) named `juggernaut`, plus `model.root.scale = HK.scale` on the Colosse only (geometry is shared per team — scaling the root is safe, see `netDisposeModel`'s note 09c-net.js:871). Optional accent: an emissive tint via the existing camo/holo material path (06q-camos.js).

**Transfer**
6. `HK.jug` set at match start (`modeStart`): solo → a random bot; online → the host's chosen bot. `modeRoster`: `hk` keeps the full roster (`off` cut like ffa/**survival**: no cut) and assigns `e.team = (e === HK.jug ? 1 : 0)` for bots (mirror the survival team-forcing branch, 09i-modes.js:57-70).
7. `killEnt` hook (09-game.js, next to the survival trigger): `if (MATCH.mode === 'hk' && v === HK.jug && !MATCH.fin) hkTransfer(v, a);`
8. `hkTransfer(dead, killer)`: pick `killer` when it is a valid live combatant (`killer !== dead`), else the nearest live hunter (zone/void deaths); call `hkSetJug(newJug)`: old Colosse → team 0, new → team 1, `spawnEntity(new)` (full HP, existing prot), look/scale refresh (`soldierLook` + scale), `hudMsg` + `sfxAnnounce`, `+HK.bonus` score to the killer, `HK.jug = new`. `modeUpdate`'s `hkUpdate(dt)` re-asserts scale/look if a respawn changed them.
9. Reveal: `drawMinimap` (09-game.js:264-276) draws the Colosse with an accent blip/arrow regardless of sat/uav (the `sat` branch is the precedent); `allyMarksUpdate` (09m-marqueurs.js:41) also marks the Colosse for everyone (`|| o === HK.jug`) with a distinct CSS class (`.am.jug`).

**Flow / scoring / end**
10. `allied` stays as-is (team-based) — hunters are allies, the Colosse is not ✓.
11. `modeUpdate`: `else if (MATCH.mode === 'hk') hkUpdate(dt);` (scale/look re-assert + host-side end conditions if the ffa branch is not reused for them).
12. Route the ffa paths: `killLimitReached` (`if (MATCH.mode === 'ffa' || MATCH.mode === 'hk')`), `ffaScore` in `modeUpdate`, the `scLim` rank line in `updateHud` (:324), `fillEnd`/`endMatch`'s ffa branch (:447/:533 already also handle survival → add hk), `matchOutcome`'s ffa branch (09l-fin.js:22) and the score rows' labels in `modeStart` (:45, the `['Vous','Rival']` case).
13. Respawning: normal (`modeDef().respawn`) — the ex-Colosse respawns as a hunter. No survival-style gates needed (everyone respawns; the role moves by the kill, not by respawn).

**Bots**
14. Hunter targeting: prefer the visible Colosse in the sense/target step (07-bots.js `botSense`/target choice) — one preference, no behaviour change otherwise.
15. Colosse bot: the existing tactics already read health, so 300 HP reads as "play bold" (`decideTactic`, 07b-tactics.js); optionally damp `fear`/`pers` (07e-humain.js) so it pushes instead of holding.
16. Bot role transfer (solo): `hkSetJug(bot)` re-teams the bot (modeRoster-style team write), `spawnEntity`, look/scale — the same path as players.

**Network**
17. `'ps'` gains `hk: netIdOf(HK.jug)` (next to `sv`/`dm`, 09c-net.js:1192); clients apply `hkNetApply(id)` in the `'ps'` case: scale/look for that entity (local or remote), and if `id === NET.me` the local player becomes the Colosse (team 1 + HP + look). Remotes' teams/HP follow their own publishes (09c-net.js:909/917) ✓.
18. Host authority: the host's `killEnt` sees every death (its own + `netEventIn 'kill'`, 09c-net.js:963-971) → the host alone calls `hkTransfer` and the `hk` field carries the result; clients never transfer locally.
19. `netCfg`: `hk` needs only the validated `limit`/`time`/`diff` ✓ nothing to add; `netRebalanceBots` — for hk, team 1 must hold exactly one bot: a hk branch (`t === 1 ? (HK.jug && !HK.jug.isPlayer ? 1 : 0) : NET_TEAM - hum[0]` …) or simplest: let `modeRoster` own the teams and have `netRebalanceBots` fill team 0 only. Decide during P4.

**Menus / i18n / end screen**
20. `matchRows`: a normal two-team mode; the kill-limit row uses `limits`, the duration row works; teams text: `_t('Un Colosse traqué par tous')`; hint explains the transfer.
21. i18n: mode name/sub/teams/hint; « Colosse », « Vous êtes le Colosse », « {0} est le Colosse », « Colosse abattu », « Vous avez abattu le Colosse ».

## 4. Phases (dependency order)

- **P1 — shell (solo playable):** MODES + Settings key, HK state, `spawnEntity` HP, speed, scale/look, `hkSetJug`/`hkTransfer`, the `killEnt` hook, modeRoster teams, FFA routing (score/HUD/end). No reveal, no net.
- **P2 — presence:** minimap reveal + the on-screen marker + transfer announcements + health vignette normalisation.
- **P3 — bots:** hunter target preference, Colosse aggression, bot transfer.
- **P4 — network:** `hk` field + apply, host arbitration, bot team ownership online.
- **P5 — menus/i18n/polish/balance:** texts, hint, HP/speed/bonus tuning, solo start role (bot vs player).

## 5. Risks and open questions

- **Team HUD cosmetics:** when the player is the Colosse they are "Bravo" on the score rows (the row classes handle it automatically, `mine` follows `PL.ent.team`, 09-game.js:508). Acceptable and dramatic; confirm.
- **Solo start role:** v1 a bot starts as the Colosse (the player hunts first). One-line change to start as the Colosse instead — owner's call.
- **A remote Colosse's model scale** must be applied on every machine (the `hk` field drives it) — verify in P4 (netApply does not touch scale today).
- **Hunter pile-on vs. first-shot luck:** with 11 hunters, the Colosse dies fast; tune HP/speed and consider the kill *bonus* rather than the role for the last hit (v1: killer takes it — classic).
- **The Colosse in a vehicle/mecha (killstreaks):** today a mecha can be called by anyone; decide whether the Colosse keeps streaks (v1: yes, unchanged — note it; the mecha path already has its own HP).
- **Kill limit vs. time:** both supported; recommend a kill limit for pace with the timer as a backstop.

## 6. Validation checklist

- [ ] A Colosse spawns visibly larger/slower/300 HP; hunters' shots hurt it; hunter friendly fire is off.
- [ ] Killing it transfers the role (announce, +bonus, look/scale/HP swap, old Colosse respawns as a hunter).
- [ ] Zone/void death of the Colosse transfers to the nearest hunter.
- [ ] Minimap + marker reveal the Colosse to everyone; the HUD score row and end screen match the actual results.
- [ ] Solo: bots hunt the Colosse and take the role; the player can become the Colosse and be hunted.
- [ ] Online: the transfer is host-decided and identical on every machine (team, HP, scale, marker); no desync after 2-3 transfers.
- [ ] Regression: TDM/FFA/dom/survival/co-op unchanged (especially the ffa branch it borrows).
