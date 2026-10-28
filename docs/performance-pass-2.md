# Performance pass 2 — indie review verification and the combined ladder

Riposte: Frontline · second audit, following `indie_perf_review.md` (independent
review) and our own `performance-pass.md` (pass 1, untouched). No code changed.

**Method.** Every claim in the indie review was checked against the source
(file:line evidence below), cross-referenced with pass 1, and where the claim
implied an allocation/cost pattern it was **measured** with a throwaway
micro-benchmark (`/tmp/opencode/perf-micro.mjs`, run with `node`). Outcome:
the review is accurate on substance; three of its items are new relative to
pass 1, one claim is not reproducible, one net figure is off by a constant,
and two of its "open" items were already resolved by pass 1.

---

## 1. Claim-by-claim verification

| # | Indie-review claim | Status | Evidence |
|---|---|---|---|
| 1 | `ssaoCutPass()` — full-scene traverse + fresh arrays **every frame** when AO is on | **Confirmed, and worse than stated** | 01-core.js:1149-1159: `const vis = [], mats = []` and `vis.push([o, o.visible])` → **a 2-element array per object** (not just two arrays). Installed as `renderOverride` (1210-1213) and `overrideVisibility` (1202-1208) → **two full traversals per frame**. Measured: 15.7 µs vs 3.6 µs for a reused parallel-array version (~900 in-engine objects → ~900 array allocations/frame, ~54 k/s at 60 fps) |
| 2 | SSAO = full extra scene render | **Confirmed** (res detail corrected) | 1189-1194: three.js `SSAOPass` with `beautyRenderTarget` re-created at **RS.cw×RS.ch (full render size), 4× MSAA** — the review's "half-res" applies to the AO computation targets, not the beauty pass |
| 3 | `RaysPass` 32 taps at half res | **Partially confirmed** | Half-res ✓ (1082); **but already early-outs when the sun is off-screen or rays are off** (1085) — the review missed this |
| 4 | Bots sense every frame at ≤120 fps; suggest low-fps decimation mirroring HF.k | **New — valid** | `botsTick` staggers only via `HF.k`, which engages above 175 fps / 340 fps (`hfUpdate`, 01-core.js:1345). Bots already consume accumulated dt (`e.hfDt`), so a `dt`-driven decimation is a symmetric, small change |
| 5 | `findPath` GC churn (A* itself clean) | **Confirmed** | 03-nav.js:311-315: `ids = []` + `ids.map(→ new V3)` → one V3 per nav node per repath; `smoothPath` (331-341) allocates `out`; `navWalkable` samples every 0.45 m (up to 14 candidates) |
| 6 | Minimap up to 120/s | **Confirmed — same as pass 1 Q3** | 09-game.js:360 (`t - HUD.mmAt >= 8`) |
| 7 | "the jammed variant already uses 24 fps" | **Not reproducible** | Jam *skips entities* (09-game.js:264-276), cadence unchanged. No 24 fps path found |
| 8 | Per-shot allocations in `fireRay` | **Confirmed** | 07-bots.js:323-336: `wn = new V3(...)`, `end = origin.clone()...`, `dir.clone().negate()`, plus `kcEvent('ray', { a: clone, b: clone, dir: clone })` → ~5-6 V3s + 1 object per shot |
| 9 | `fillScoreboard()` full innerHTML 4×/s | **Confirmed, benign** | 09-game.js:434-447, throttled by `HUD.boardT = 0.25`; ≤12 rows, only while the board is open |
| 10 | `drawTacMap()` every frame — "couldn't verify early-out" | **Resolved by pass 1** | 08b-killstreaks.js:407: `if (!KS.map.open) return;` — correct, no work when closed |
| 11 | `propBlast` — one world ray per body, all in one frame | **Confirmed** | 04b-physprops.js:605-613 (`rayWorld` per body in reach) |
| 12 | "Netcode — 20 Hz state tick" | **Minor correction** | 09c-net.js:1187: publish interval is 66 ms (**~15 Hz**) or on flush; heartbeat 1 Hz ✓ |
| 13 | KTX2/basis textures the one open generic item | **Confirmed** | dist/tex 20 MB + base64 packs; matters most on the iGPU tier |

---

## 2. Benchmark results (throwaway micro-bench, /tmp/opencode/perf-micro.mjs)

| Pattern | Cost | Verdict |
|---|---|---|
| `ssaoCutPass` pair-arrays, fresh (1200 objs) | **15.7 µs + 1200 allocs** | **real** — the only measurable allocation storm |
| same, parallel arrays reused | 3.6 µs + 0 allocs | 4.3× faster, zero GC |
| `Array.filter` rebuild (8 elems) | 102 ns | noise — but violates the house no-per-frame-alloc rule |
| in-place compaction (8 elems) | 42 ns | hygiene only |
| `Math.hypot(x,y)` | 16.4 ns | **4× the `hyp` rule's cost** — rule validated |
| `Math.sqrt(x*x+y*y)` | 4.1 ns | keep the rule |
| template string per frame | 12.2 ns | noise — pass 1 anti-list confirmed |
| number compare | 2.9 ns | — |
| `array.shift()` on 60-cap | 12.9 ns | noise |
| ring index | 4.3 ns | — |

**Reading:** only item #1 has a cost above measurement noise. Everything else
in the "allocations" family is GC hygiene, not frame time — worth doing as a
batch, not worth chasing individually.

---

## 3. New actionable items (pass 2), by practicality

| ID | Item | Where | Effort | Expected |
|---|---|---|---|---|
| P2-1 | Make `ssaoCutPass` allocation-free (parallel reusable arrays) + a dirty flag to skip re-collection when the scene set is unchanged; invalidate on map load / entity add-remove | 01-core.js:1149-1159, 1202-1213 | S | **real**: ~900 allocs/frame gone, ~12 µs/frame saved when AO on; less scene churn |
| P2-2 | Low-fps AI decimation (`HF.k` mirror: `k = max(HF.k, dt > 12 ms ? 2 : 1)`), bots already accumulate `hfDt` | 09-game.js:712-720, 01-core.js:1345 | S | worst-case CPU frames; **must be tested at 30/60/90 fps** (aim/reaction stay time-accurate via `d`) |
| P2-3 | Zero-alloc shot path: temporary reuse for `wn`/`end`/impact dir; **bounded preallocated V3 pool for killcam `ray` events** (600-event ring → ~1800 V3s, allocated once) | 07-bots.js:323-336, 09b-killcam.js:67 | S–M | removes ~5-6 allocs/shot/soldier — exactly during firefights (matches owner hitch reports) |
| P2-4 | Amortize `propBlast` occlusion rays over 2–3 frames via the existing events queue | 04b-physprops.js:605-613 | S | explosion-frame spikes (crate-dense maps) |
| P2-5 | Pool `findPath` output points per bot (+ optional pinned-path cache keyed on goal) | 03-nav.js:311-341 | M | AI spikes on group repath; cache variant needs validity care |
| P2-6 | Scale `RaysPass` sample count by quality tier | 01-core.js:1074-1089 | S–M | GPU on weak tiers, only when facing the sun |
| P2-7 | SSAO structure: depth-only AO from the existing prepass depth (or tier-scaled kernel) instead of a full beauty re-render | 01-core.js:1184-1214 | L | largest GPU item for AO users; three.js `SSAOPass` is heavyweight |
| P2-8 | `fillScoreboard` content-keyed string cache | 09-game.js:434-447 | XS | negligible (benign today) — do only with the batch |
| P2-9 | KTX2/basis texture pipeline for `dist/tex` | build.py + tex packs | L | download size + VRAM, mainly iGPU tier |

## 4. Combined ladder (pass 1 + pass 2)

1. **Measure** — one PFR report per machine (see pass 1 §1). Directs everything.
2. **Batch A (hygiene + measured):** P2-1 (`ssaoCutPass`), Q1 (`dmgInd` in-place),
   Q2 (cached HUD element refs), Q3 (minimap 60 Hz), Q4 (`vmPass.enabled`),
   P2-3 (shot-path pool), P2-8. All small, individually reversible; validate
   with before/after PFR on Kervénec + one AO-on run.
3. **Batch B (worst-case frames):** P2-2 (low-fps AI decimation) — the only item
   aimed at *dropped* frames rather than averages; test across 30–144 fps.
4. **Batch C (event spikes):** P2-4 (blast rays), P2-5 (path pooling).
5. **Deferred / large:** P2-6, P2-7 (SSAO rework), P2-9 (KTX2) — only with
   report evidence from the affected hardware tier.

## 5. Closed / benign (do not spend time)

- `RaysPass` sun early-out ✓ exists; `drawTacMap` early-out ✓ exists;
  `fillScoreboard` ✓ throttled and small; `shift()` on capped arrays ✓ noise
  (13 ns); template-string change detection ✓ noise (12 ns) — pass 1's
  anti-list stands, now with numbers.
- Physics, ragdolls, nav A*, CSM, dynamic resolution, frame queue, flash
  lights, boot warmups: all confirmed already at or beyond the review's
  recommendations — **no action** (both reports agree).

## 6. The indie review's "do not do" — we concur

Do not rewrite the renderer, CSM, or physics (the hardware landmines are
mapped in the code comments: PowerVR context loss, Samsung shadow breakage,
Intel fence serialization, RX 580 late fences, eGPU). The leverage left is
measurement-driven: pass structure (P2-1, P2-7), event-time allocations
(P2-3, P2-4, P2-5), worst-case AI cadence (P2-2), and the texture pipeline
(P2-9).
