# Riposte: Frontline — agent guide

## Project
Browser FPS built on three.js r147. All geometry is procedural — no imported
models. Source comments are in French; the player-facing default language is
English. MIT-licensed with exceptions for branding and some assets.

**New here? Read `docs/OVERVIEW.md` first** — it maps every source file, the
boot/frame/mode flows, the networking layer and the traps. This file holds the
rules; that one holds the map.

## Build & Validation
- `python3 build.py` — concatenates every file in `src/*.js` in alphabetical
  order, injects into `shell.html`, writes `dist/riposte-frontline.html`. It also
  checks the script syntax and the **player-text style** (no semicolons in
  player-facing strings — prefer periods or commas; no forbidden dashes) and
  regenerates `docs/assets.md`.
- `python3 tools/dev/check_decl.py` — fails if any top-level function is declared
  more than once
- `python3 tools/dev/check_i18n.py` — fails on missing, unused or duplicate
  translation keys (run it whenever player-facing text changes; new strings need
  a key in `i18n/en.txt`)
- **Run these after every change**
- **Never edit `dist/`** — it is a build artifact. `docs/assets.md` is generated
  by `tools/dev/assets.py` (through `build.py`) — never edit it either.
- No bundler, no ES modules, no framework

## Non-negotiable architecture
- **Single global scope.** Every file in `src/` shares one namespace. New
  top-level symbols must be globally unique.
- **Alphabetical load order.** Files execute in `src/` filename order. Top-level
  side effects happen in that order; runtime references between files are fine
  in any order.
- **Static collision.** `COL` AABBs and `RAMPS` are built once at map load.
  There is no dynamic collision layer. Only pre-authored colliders can be
  toggled (e.g. via a `disabled` flag); adding geometry at runtime is not
  supported.
- **Static nav grid.** Built once from collision data at map load. Bot
  reachability does not survive geometry changes.
- **three.js r147, pinned.** Do not upgrade.

## File map
| Range | Subsystem |
|-------|-----------|
| `00-*`, `01-*` | Translations, startup, rendering, GPU settings |
| `02-*` | Maps, terrain, materials, lighting, water, vegetation, map kits |
| `03-*` | Bot navigation (`03-nav.js`) |
| `04-*` | Effects, particles, object physics |
| `05-*` | Sound |
| `06-*` | Weapons, soldier models, animations, outfits, ragdolls |
| `07-*` | Bot AI, `DIFF` table |
| `08-*` | Player, controls, killstreaks, vehicles |
| `09-*` | Match flow, loading, networking, menus, UI |

## Performance rules (do not violate)
- Use `hyp()`, `hyp3()` — never `Math.hypot()` (allocates per call)
- Use `hasKey()`, `numOr()` for any network-sourced value
- Particles are `THREE.Points` with a custom shader; keep the typed-array hot
  path allocation-free
- Player object is an object literal for stable V8 shape — do not convert to
  dictionary mode
- Per-frame code must not allocate

## Current state
The **survival mode is shipped** on its feature branches: the solo prototype
(hostile roster, count-up timer, killstreaks off, `DIFF_SURV`), the **extraction
loop** (combat timer → extraction point → 10 s hold → map transition with
carried stats, round bot scaling, shuffled map queue) and the **4-player co-op**
layer (host-authoritative `sv` state on the `'ps'` packet, lobby options Death
Mode / Extraction Rule, team forcing, Endless spectating). The first two
performance passes and their Batch A fixes are in.

**Planned next (worked plans in `docs/`, not implemented):** Frontline Push,
Hunter/Killer, Salvage Race, Sandstorm.

### Survival tuning reference (`DIFF_SURV`, `src/07-bots.js`)
Levers, in order of impact:
1. Lower reaction time / raise aim error
2. Reduce grenade frequency (biggest solo punisher)
3. Reduce squad coordination (flanking is brutal solo)
4. Keep suppression and cover-seeking (they are what makes bots feel smart)
5. Tune duration and attrition (`MODES.survival.botRespawn`) — do not increase
   bot count to add difficulty

## Scope
The owner directs scope. Unless directed otherwise: no three.js upgrade, no
renderer rewrite, no imported assets (all geometry is code-built), no
destruction, no horde scale (200+ entities), no bot pathfinding changes.
Multiplayer and networking work is done at the owner's direction (co-op
survival shipped that way). New modes follow the recipe in `docs/OVERVIEW.md`
§6; large refactors, new modes and performance work are planned in `docs/`
before implementation.

## Guardrails
- Match the local comment language (French) in files you edit
- Run `build.py` and `tools/dev/check_decl.py` after every change, and
  `tools/dev/check_i18n.py` when player-facing text changes; report pre-existing
  failures before claiming your change works
- Player-facing strings: French in the source, English by default through
  `i18n/en.txt`; no semicolons in them (see Build & Validation)
- Keep new top-level names globally unique, allocate nothing per frame in hot
  paths, and never touch `dist/`
- If a plan requires violating an architecture constraint above, stop and say
  so instead of working around it
