# Performance pass — opportunity map and difficulty

Riposte: Frontline · audit document. No code changed. Grounded in a full read
of the frame loop, the perf recorder, and the rendering/networking/AI hot
paths (file:line references included).

**Headline finding: this codebase is already optimized to an unusual depth.**
Most standard techniques are implemented *and* tuned against real owner
reports. The remaining easy wins are small; the meaningful ones are in
rendering pass policy and per-frame micro-allocations. **Measure first** —
the game ships its own frame-attribution recorder, so every item below can be
confirmed or discarded with data before writing code.

---

## 1. How to measure (in order of usefulness)

1. **The built-in recorder** (09zo-perfs.js): Options → Vidéo →
   « Afficher les performances ». Records every frame of a match with
   7-step attribution — `player / bots / props / logic / prep / shadow /
   render` — plus median/p90/p99 intervals, measured GPU time, draw calls,
   triangles, awake props, JS heap, long tasks, and a **worst-hitch table
   with the events (explosion/flash/kill) in the preceding second**. The
   copyable report (Options → Vidéo → « Rapport de performances ») persists in
   localStorage (`dc_perf_last`). One full match per suspect machine is the
   single most valuable artifact for this pass.
2. **GPU report**: `?diag` in the URL (01a-gpu.js) — context losses,
   programs, driver tier. Pair with `about:gpu` / `chrome://gpu` on the
   client machine (browser, GPU in use, hardware acceleration state).
3. **bench.js** (tools/dev, playwright) — rendering benchmark for
   before/after on a headless baseline.
4. **DevTools Performance + Memory** — for GC/long-task signatures the
   recorder already summarizes (`longTasks`, heap column).

**Diagnosing a laggy client (e.g. the Chrome/restart case):** get that
machine's PFR report + `?diag` + `chrome://gpu`. The game already
auto-detects and recovers GPU context loss (`gpuLostNow`/`gpuAutoRetry`),
downgrades refused renders to simple materials, and *disables its own
frame-queue optimization* when a driver lies about fences (Radeon/eGPU
cases, 01-core.js:1405-1440). An "extreme lag fixed by restart + browser
swap" profile usually shows up as: context loss/recovery entries in the GPU
log, a different GPU selected by the other browser, or long tasks at
startup. The recorder will say which.

## 2. Already implemented (do not re-propose)

| Subsystem | Where | What |
|---|---|---|
| Dynamic resolution | 01-core.js:1468+ | Measured-GPU-time scaling via **sub-rectangle viewport/scissor** (no render-target recreation on scale change), quality ladder rungs, 85 %/60 % hysteresis, `roomy/onTime` gating, auto-boost above profile |
| Frame queue / latency | 01-core.js:1405-1440 | fenceSync short queue bounded to 1 in-flight frame, skip instead of queue, **self-ban when a driver reports fences late** (LAG.ban) |
| Frame pacing | 01-core.js:1393-1403 | vsync tracking for high-Hz displays, fps cap incl. "half", eco mode |
| Shadows | 01-core.js:839-850 | CSM with staggered cascades (near every k frames, others alternating 2k), camera-movement-triggered refresh, HF-aware |
| Flash lights | 01-core.js:851-875 | Fixed pool, two precompiled shader variants, 2 s hold to avoid per-shot material re-evaluation |
| Composer | 01-core.js:1169-1228 | Optional depth prepass, quality-gated SSAO (with cutout handling), **bloom copy-quad skipped**, rays optional, MSAA by profile |
| Per-frame scene | 09-game.js:704-708 | Single `updateMatrixWorld` for ~15 render calls, auto-update disabled during render |
| Bots | 09-game.js:712-720, 07-* | HF staggered updates on high-Hz displays, aim-token system, staggered sensing, static nav/cover grids |
| HUD | 09-game.js:309-313 | Change-checked writes (`hudText/hudStyle/hudHtml`), throttled minimap (≤125 Hz), throttled zone/rank texts, static minimap prerender, cached dom letters (DOM_MM) |
| Networking | 09c-net.js:1182+ | 66 ms publish, per-player rate limits, event dedup with acks, typed ring buffers |
| Killcam | 09b-killcam.js:41-66 | KC_HZ-throttled typed ring buffer, allocation-free |
| GC discipline | everywhere | Pooled temporaries (`_v1/_v2/HS[]`), V8 shape comments (BOT_STATE, PL), `hyp/hyp3`, `hasKey/numOr`, particles on typed arrays (04-fx.js) |
| Asset lifecycle | 09a-loading.js | Full map disposal on unload, prebuilds at boot, deferred thumbnails, worker light bake, staged shader compile + warmup |

## 3. Opportunity map

### Quick wins (trivial → easy, low risk)

| # | Gain | Where | Expected impact | Difficulty |
|---|---|---|---|---|
| Q1 | `PL.dmgInd` is re-`filter`ed — **a new array every frame** (violates the house no-per-frame-alloc rule). In-place compaction loop. | 09-game.js:368 | Direct: tiny; removes a steady GC drip | Trivial (3 lines) |
| Q2 | ~20 `$('…')` getElementById lookups per frame in `updateHud` (+ `drawMinimap`, `domHud`…). Cache element refs in module consts at init. | 09-game.js:314-380, 09i-modes.js:501+ | Small; largest on low-end/mobile CPU | Easy, mechanical |
| Q3 | Minimap redraws up to 125 Hz on high-refresh screens (`HUD.mmAt >= 8`). Cap drawing at ~60 Hz (`>= 16`); keep the resize/fit check uncapped. | 09-game.js:346 | Small-medium on high-Hz / weak-GPU machines; visually nil | Trivial (one line) |
| Q4 | `vmPass` renders the viewmodel scene **unconditionally**, even when the weapon is hidden (death screen, mecha, drone, end screen). Set `vmPass.enabled = VM.root.visible` per frame after a state audit. | 01-core.js:1216, frame() | A whole render-pass fixed cost during those states | Easy-medium (state audit) |

### Medium (act only with PFR evidence)

| # | Gain | Where | Notes | Difficulty |
|---|---|---|---|---|
| M1 | Audit `clothUpdate`/`grassUpdate` for distance culling (distant soldiers' cloth sim). | 06gb-tissu, 02n-flore; shows in the `prep` lap | Unknown current culling — check the report first | Medium |
| M2 | Extend HF-style staggering to the other entity loops (nades/smokes/drops/props) — likely unnecessary at current counts. | matchTick; `props` lap | Audit-first | Medium |
| M3 | End screen keeps the full world rendering behind results (orbit camera). Could half-rate or freeze it — owner-visual decision. | 09-game.js:813-819 | Free win only if the live backdrop isn't wanted | Easy, but a design call |
| M4 | `KC.events.shift()` / `soundEvents.shift()` are O(n) — harmless today; only if long-task evidence points there. | 09b-killcam.js:65, 09-game.js:941 | Low priority | Easy |

### Hard / architectural (not recommended now)

| # | Gain | Why hard |
|---|---|---|
| H1 | Merge bloom+rays into `finalPass` (fewer passes) | Visual-regression risk on every map's look; three.js pinned at r147 |
| H2 | Worker offload (cloth/AI) | Clashes with the single-global-scope architecture; sync cost likely eats the gain |
| H3 | KTX2/Basis compression for the 20 MB photo textures | Build-pipeline change; improves load time, not frame time |
| H4 | GPU-driven culling / compute | Impossible on the pinned three r147 WebGL path |

## 4. Verified clean (audited this pass — leave alone)

- **Survival/co-op additions**: `sv` sync ≈ 60 B at 15 Hz (same class as
  domination's `dm`); `survUpdate` = a boolean chain + one `hyp()`;
  marker = 2 meshes + 2 opacity writes; bot scaling = boolean flips once per
  round; the hold-bar HUD block short-circuits in all other modes.
- `updateRemote` (no per-frame allocations), `kcRecord` (typed ring),
  `netPresence` at 15 Hz (allocation class accepted — same as `domNetState`),
  `drawTacMap` (early-out when the tablet is closed, 08b-killstreaks.js:407),
  `hitSpheres` (pooled), `allyMarksUpdate` (staggered 150 ms raycasts),
  spawn scoring (spawn-time only), off-bot inactivity (zero cost).

## 5. Looks like a win but isn't (anti-list)

- **String change-detection idiom** (`hudStyle/hudText` with template strings
  built per frame, e.g. `fmtTime`, bar transforms): micro-seconds; replacing
  it means touching hundreds of call sites for noise. The idiom is *why* DOM
  writes are already minimal.
- `fmtTime` per frame; `new Set()` in `drawTacMap` (only while the tablet is
  open); `netPresence` object allocations; array `shift()`s on tiny capped
  arrays — all below measurement noise.
- `Math.hypot` — already banned game-wide (hyp/hyp3).

## 6. Recommended sequence

1. **Collect**: one PFR report per machine of interest (including the Chrome
   laptop) + `?diag`. Decide from the `prep/shadow/render` and long-task
   columns before touching anything.
2. **Batch the quick wins** (Q1–Q4) as one change; re-run the same map/mode
   with the recorder on; compare the same laps. Expected combined effect is
   modest — the goal is to clear the floor and prove the workflow.
3. **Medium items only with evidence** (M1 first if `prep` is hot).
4. House rules per change: `python3 build.py` + `tools/dev/check_decl.py`
   green, no per-frame allocation introduced, French comments, dist never
   hand-edited.
