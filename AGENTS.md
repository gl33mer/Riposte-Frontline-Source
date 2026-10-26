# Riposte: Frontline — agent guide

## Project
Browser FPS built on three.js r147. All geometry is procedural — no imported
models. Source comments are in French; the player-facing default language is
English. MIT-licensed with exceptions for branding and some assets.

## Build & Validation
- `python3 build.py` — concatenates every file in `src/*.js` in alphabetical
  order, injects into `shell.html`, writes `dist/riposte-frontline.html`
- `python3 tools/dev/check_decl.py` — fails if any top-level function is declared
  more than once
- **Run both after every change**
- **Never edit `dist/`** — it is a build artifact
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

## Current task: survival-mode prototype
Convert the PvP match flow into a solo timed survival mode for playtesting.

Required changes:
1. Force all bots onto one hostile team; player is alone
2. Replace the win condition with a timer that counts up until the player dies
3. Continuous bot respawns (not waves)
4. Disable killstreaks and vehicles
5. HUD: survival timer and kill counter only
6. Tune `DIFF` in `07-*` for solo survivability

Tuning levers, in order of impact:
1. Lower reaction time / raise aim error
2. Reduce grenade frequency (biggest solo punisher)
3. Reduce squad coordination (flanking is brutal solo)
4. Keep suppression and cover-seeking (they are what makes bots feel smart)
5. Tune duration and attrition — do not increase bot count to add difficulty

## Out of scope for this phase
Multiplayer, networking changes, new maps, new weapons, procedural generation,
destruction, horde scale (200+ entities), renderer changes, three.js upgrade,
bot pathfinding changes.

## Guardrails
- Match the local comment language (French) in files you edit
- Run `build.py` and `tools/dev/check_decl.py` after every change; report
  pre-existing failures before claiming your change works
- If a plan requires violating an architecture constraint above, stop and say
  so instead of working around it
