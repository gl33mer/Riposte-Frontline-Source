# Sandstorm → battle royale: plan

Status: **Phase A shipped** (this branch, `feature/sandstorm`) · Phases B–D are
planned, not implemented. This supersedes `docs/mode-sandstorm.md` for the
battle-royale direction; the older file still describes the first ring/loot
prototype.

Mode id `storm`, FR « Tempête de sable », EN "Sandstorm". Solo in Phase A.

---

## 1. Where the mode stands (Phase A, delivered)

A closing ring, no respawns, and a battle royale shape:

- **Free-for-all bots.** `allied()` treats `storm` like `ffa`: nobody has an
  ally, so the bots hunt each other as well as the player, and the last one
  standing wins. `soundFoe` follows (bots react to each other's noise).
- **Battle-royale pacing.** Bots are less aggressive (`initTactics` halves
  `aggr` in storm) and longer in place. `stormGoal` (called from `pickGoal`
  while roaming) sends a bot to cover and a long hold, or pulls it to the ring
  centre when the next stage is within 8 s or the bot nears the edge. Spawns use
  the free-for-all pool (both bases + field points), so the roster spreads out.
- **Player setup parameters** (Solo → Paramètres de partie, storm only):
  | Setting | Range | Notes |
  |---|---|---|
  | `stormBots` | 1–30 | bots in play; above 11 a **reserve** is created on demand (`makeBotReserve`) |
  | `stormLoot` | on/off | ground loot: guns, ammo crates, grenades |
  | `difficulty` (`bots`) | Recrue / Régulier / Vétéran | `botDiff()` now reads `Settings.difficulty` in storm |
  | `stormMin` | 5–30 min | how long the storm takes to fully close |
  | `stormStage` | 15–120 s | length of one shrink; stage count = `stormMin·60 / stormStage` |
- **Loot.** Guns are drawn from the whole `WEAPONS` table (`STORM_GUNS`), plus
  `STORM_NADE_N` grenades and `STORM_AMMO_N` ammo crates per match. Grenades and
  ammo are auto-pickups (`STORM.items`, `stormItemsUpdate`), reusing the
  grenade mesh/materials; guns use the existing drop path.
- **Reserve bots.** Built lazily at match start and kept for the session; kept
  **out of every other mode** (`modeRoster` turns them `off`, `netRebalanceBots`
  and `netAdoptBots` skip them, `boardList` hides `off` soldiers). Killcam
  buffer headroom raised (`KC_EXTRA = 48`).

Known limits accepted for Phase A:

- Bots do **not** loot or pick up anything (they keep their spawn weapon).
- Reserve models are built at match start, so their shaders may compile on the
  first in-game frame (a possible hitch on the first big storm on a machine).
- Up to 30 bots is CPU-heavy: `botSense` is O(n²) line-of-sight. Fine for a
  desktop stress test; phones should stay near the default 11.
- No per-stage custom durations (the last stage absorbs the remainder).
- `stormMin` sizes the storm, it is **not** a hard match cap: the match ends
  when one combatant remains, as in a battle royale.

---

## 2. Phase B — depth (single-player battle royale)

1. **Looting bots.** Teach bots to pick up a nearby better weapon
   (`DROP.list` + the same `swapWithDrop` rules, on a bot cooldown). This closes
   the biggest gap with the genre and makes the reserve fights varied.
2. **Behaviour layers.** A light per-bot "plan" in storm: land/hold a building
   (use `COVERS` + POI `hold` flags), rotate to the ring when the stage timer
   drops, and only then engage. Add a `STORM_PLAN` field to `BOT_STATE` (stable
   shape, like the other tactic fields).
3. **Storm visuals.** Dust wall at the edge (reuse `mapDressing`-style
   particles tinted sand), sky/bloom dim on the last stages (per-map
   `atmo.bloom`), a wind sound bed that rises with the stage. Ring map for the
   edge already exists (`ringHud`); add a world-space band.
4. **Loot tiers.** A couple of named drops (sniper, shotgun) revealed at stage
   boundaries with `hudMsg`, plus a rare medkit/armour pickup (needs a new item
   kind in `STORM.items`).
5. **Drop-in.** Spawn the player (and bots) from a short parachute/insertion
   instead of a ground spawn, purely cosmetic.
6. **Results.** A richer end screen: placement (#1 of N), survived time, kills,
   loot taken.

---

## 3. Phase C — co-op sandstorm (2–4 players vs bots)

The natural first multiplayer step; it reuses the survival co-op plumbing.

- **Lobby.** Add `storm` to the online mode list (today it is excluded), cap at
  4 (`netMaxPlayers`), force all humans onto the same team (`t === 0`), bots on
  team 1 but still FFA among themselves — or simpler for v1: bots hostile to
  humans, and humans allied. Decide in the mode-specific lobby rows
  (`matchRows`), like the Survival death/rule rows.
- **Host authority.** The host owns the ring and its stages, exactly like
  `survNetState`. Add a compact `st: { r, stage, t }` to the `'ps'` packet
  (`src/09c-net.js`), applied with `numOr`/`hasKey` guards; the guest reads it in
  `stormNetApply` and drives `RING`/the strip. The radius/grace are then the
  host's, and the wall kills identically on every machine (the grace timer is
  local per soldier, as `ringCheck` already does).
- **Win/death.** Host decides the end (`matchFinishSoon`) on the last hostile;
  human death is per-player, with the survival "Endless spectators" pattern for
  the dead (cross-reference `spectate-death-cam-options.md`).
- **Loot determinism.** Loot must be seeded by the host (a numeric seed in
  `NET.cfg`, expanded identically on every client) so drops match; or spawned
  host-side only and published — the seed is cheaper.
- **Bots.** Host simulates them (`netBot`), scaled by `stormBots`, published as
  remote entities exactly like `netRebalanceBots` today.

## 4. Phase D — PvP sandstorm with bots

- Two choices, pick one per lobby option:
  - **Solo-FREE (humans + bots, everyone hostile):** closest to battle royale;
    each human is their own side, bots fill the lobby. Needs the spectate cam for
    the many dead and a placement board.
  - **Duo/trio:** small human squads, bots as solos. `allied()` gets a storm-team
    map instead of the flat "nobody is an ally".
- **Lobby.** `netCfg` carries the victim-side variant; extend `netMaxPlayers`,
  the `'ps'` state, and the result screen (placement, team wipe). Team colours
  in `soldierLook`/`allied` must be derived from the squad map, not `team`
  alone — the single biggest refactor of this phase.
- **Anti-cheat/authority.** Same host-authoritative model as C; the last-shooter
  credit for the ring already lives in `zoneDeath`.

---

## 5. State to synchronise (Phases C/D)

| Field | Where | Drift guard |
|---|---|---|
| `r` (ring radius), `stage`, `t` (stage clock) | host → `'ps'.st` | `numOr`, clamp |
| stage count / durations | `NET.cfg` (lobby) | validated in `netCfg` |
| loot seed | `NET.cfg` | integer, expanded identically |
| bot roster (`stormBots`) | `NET.cfg` | capped by a max for the host |
| kills/score | existing kill/death events | unchanged |

`stopped`/`MATCH.online` guards: the client never computes the ring, only draws
it; `stormUpdate` returns early for `NET.role !== 'host'` (the `survUpdate`
pattern).

---

## 6. Constraints and traps (from `AGENTS.md` / `docs/OVERVIEW.md`)

- **Static nav grid / collision.** No new dynamic colliders; loot and dust are
  visuals only.
- **One global scope, alphabetical load.** New `STORM_*`/`storm*` names must stay
  unique; `check_decl.py` enforces it.
- **No per-frame allocation** in the hot path: `STORM.items`/`stormGoal` already
  avoid it (`hyp`, pooled vectors, no array builds per frame).
- **`BOT_STATE` / `PL` are object literals.** New bot fields go in `BOT_STATE`
  (`reserve` was added there); do not add runtime fields to `PL.ent`.
- **Network values** go through `hasKey`/`numOr`.
- **Player text**: FR source, EN via `i18n/en.txt`, no semicolons; run
  `build.py` + `check_decl.py` + `check_i18n.py`.

---

## 7. Open questions for the owner

1. **Co-op shape:** should bots be hostile to each other in co-op too (chaotic
   battle royale), or should co-op humans only face bots (simpler, fairer)?
2. **PvP shape:** free-for-all humans + bots, or small squads? This decides the
   Phase D refactor of `allied`.
3. **`stormMin` semantics:** the current "time to fully close" versus a hard
   match time limit (auto-end when the clock expires with several alive).
4. **Loot seeding** for online: deterministic seed vs host-published drops.
5. **Phone cap:** keep 11 as the default and warn above, or auto-lower
   `stormBots` on `COARSE` devices.
