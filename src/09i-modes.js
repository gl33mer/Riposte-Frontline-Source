/* ==========================================================================
   MODES DE JEU
   Quatre modes : trois en solo comme en ligne (l'hôte du salon choisit le mode ; en ligne, c'est lui qui décide de la fin de la partie et
   qui tient les points de la domination, les invités en reçoivent l'état, voir domNetApply), un en solo seulement :
     tdm  match à mort par équipe : 6 contre 6, premier camp à N éliminations ;
     ffa  match à mort : chacun pour soi, les 12 soldats s'affrontent, premier à N éliminations ;
     dom  domination : trois points à tenir (A côté d'Alpha, B au centre, C côté Bravo), chaque point tenu rapporte
          un point de score toutes les DOM.tick secondes, premier camp à N points ;
     survival  survie (solo, ou en ligne à quatre : l'état tenu par l'hôte, survNetState) : des bots rappelés manche
          après manche (quatre, puis un de plus à chaque passage) ; le chrono de manche ouvre l'extraction, dix
          secondes tenues au point font passer à la carte suivante (éliminations et temps conservés), la mort seule
          termine la partie (Hardcore : la première, Sans fin : la dernière, les morts reviennent au passage).
   MATCH.mode vaut 'tdm' tant qu'aucun mode n'est choisi. Les règles d'alliance passent par
   allied(a, b) : en match à mort, personne n'est l'allié de personne, quelle que soit l'équipe d'origine du soldat (qui
   ne sert plus qu'à la tenue et à la base de départ).
   Ce fichier porte aussi le système d'apparition (spawnOpening au départ, chooseSpawn ensuite), qui dépend du mode : voir plus bas.
   ========================================================================== */
const MODES = {
  tdm: { name: _t('Match à mort par équipe'), btn: _t('Par équipe'), sub: _t('Match à mort par équipe'), teams: _t('6 contre 6 (vous et 5 alliés)'), lim: _t('Limite d\u0027éliminations'), unit: _t('éliminations'),
    limits: [20, 30, 50, 75], key: 'limit', respawn: 4, botRespawn: 5.5, prot: 2,
    hint: _t('Deux équipes de six. Le premier camp à la limite d\u0027éliminations l\u0027emporte.') },
  ffa: { name: _t('Match à mort'), btn: _t('Chacun pour soi'), sub: _t('Match à mort, chacun pour soi'), teams: _t('Chacun pour soi, vous et 7 bots (8 joueurs)'), lim: _t('Limite d\u0027éliminations'), unit: _t('éliminations'),
    limits: [10, 20, 30, 50], key: 'limitFfa', respawn: 3, botRespawn: 3.5, prot: 2,
    hint: _t('Personne n\u0027est votre allié. Le premier à la limite d\u0027éliminations l\u0027emporte.') },
  dom: { name: _t('Domination'), btn: _t('Domination'), sub: _t('Domination, trois points à tenir'), teams: _t('6 contre 6, trois points à tenir'), lim: _t('Score à atteindre'), unit: 'points',
    limits: [100, 150, 200, 250], key: 'limitDom', respawn: 4, botRespawn: 4.5, prot: 2,
    hint: _t('Restez dans la zone d\u0027un point pour le capturer. Chaque point tenu rapporte un point toutes les 4 secondes.') },
  survival: { name: _t('Survie'), btn: _t('Survie'), sub: _t('Survie : tenez le plus longtemps possible'), teams: _t('Seul ou à plusieurs, contre des bots de plus en plus nombreux'),
    lim: _t('Sans limite'), unit: _t('éliminations'), limits: null, key: null, respawn: Infinity, botRespawn: 5.5, prot: 2,
    hint: _t('Vous seul contre tous. Le chrono compte votre survie et les bots réapparaissent sans fin. Tenez le plus longtemps possible.') },
  storm: { name: _t('Tempête de sable'), btn: _t('Tempête de sable'), sub: _t('Tempête, la zone se referme'), teams: _t('Vous seul, la tempête se referme'),
    lim: _t('Sans limite'), unit: _t('éliminations'), limits: null, key: null, respawn: Infinity, botRespawn: 1e6, prot: 2, // botRespawn 1e6 : aucune réapparition, mais les corps restent au sol (Infinity les ferait disparaître, 06b-soldier.js)
    hint: _t('La tempête se referme par étapes. Hors de la zone, le sable vous emporte. Aucune réapparition. Tenez jusqu\u0027au dernier bot.') },
};
const MODE_IDS = ['tdm', 'ffa', 'dom', 'survival', 'storm'];
function modeDef() { return MODES[MATCH.mode] || MODES.tdm; }
/* Alliés : même équipe, sauf en match à mort où chacun joue pour soi */
function allied(a, b) { return a === b || (MATCH.mode !== 'ffa' && a.team === b.team); }
/* Un bruit (tir, explosion) est-il celui d'un adversaire de b ? */
function soundFoe(s, b) { return MATCH.mode === 'ffa' ? s.who !== b : s.team !== b.team; }
/* Classement du match à mort : éliminations, puis moins de morts, puis score */
const ffaCmp = (a, b) => b.kills - a.kills || a.deaths - b.deaths || b.score - a.score;

/* ---------- Début et fin de partie ---------- */
function modeStart(mode) {
  MATCH.mode = MODES[mode] ? mode : 'tdm';
  SPAWN_LOG.length = 0; DEATH_LOG.length = 0; SPAWN_TRAP.length = 0; OPEN.on = true; // départ : chacun sa place (spawnOpening), jusqu'au « En avant ! »
  for (const e of entities) { e.protT = 0; e.lastDeath = null; e.caps = 0; }
  ringReset(); // l'anneau de la carte est remis à neuf à chaque partie (une tempête l'a laissé rétréci : la carte reste chargée entre deux parties)
  squadReset();
  if (MATCH.mode === 'survival') survStart(); // avant modeRoster : la manche compte les bots rappelés (survBotCap)
  modeRoster();
  domClear();
  if (MATCH.mode === 'dom') domInit();
  if (MATCH.mode === 'storm') stormInit(); // après la carte (modeStart court une fois la carte chargée) : la zone se pose, et le butin se sème
  MATCH.over = false;
  const D = modeDef();
  document.querySelectorAll('.score .row span').forEach((s, i) => { s.textContent = MATCH.mode === 'ffa' ? [_t('Vous'), _t('Rival')][i] : MATCH.mode === 'survival' ? [_t('Éliminations'), ''][i] : MATCH.mode === 'storm' ? [_t('Éliminations'), _t('Bots restants')][i] : TEAM_NAMES[i]; });
  $('domRow').classList.toggle('hidden', MATCH.mode !== 'dom');
  document.querySelector('.score').classList.toggle('dom', MATCH.mode === 'dom'); // au doigt, les pastilles prennent la place de la limite (shell.html)
  document.querySelector('.score').classList.toggle('surv', MATCH.mode === 'survival'); // la Survie : le chrono et les éliminations seulement (shell.html)
  document.querySelector('.score').classList.toggle('storm', MATCH.mode === 'storm'); // la Tempête : les deux camps (les bots restants), sans barres ni limite (shell.html)
  $('domCap').className = '';
  return D;
}
/* Soldats en jeu et tenue de chacun. Match à mort : 7 bots seulement, tous vus en ennemis (tenue sombre, bandes rouges : skinRel),
   pour qu'aucun ne ressemble à un allié. Autres modes : tous en jeu, alliés en clair, ennemis en sombre (06ga-tenues.js).
   Survie : survBotCap(SURV.round) bots en jeu (quatre à la manche 1, un de plus à chaque manche), les autres en attente (off),
   tous chez Bravo, tous vus en ennemis. Tempête : tous les bots d'origine en jeu, tous chez Bravo, tous vus en ennemis. */
function modeRoster() {
  const ffa = MATCH.mode === 'ffa', bots = entities.filter((e) => !e.isPlayer), cut = MATCH.online ? 0 : bots.length - FFA_BOTS; // en ligne, l'hôte active les bots (netRebalanceBots)
  const surv = MATCH.mode === 'survival'; // la Survie : survBotCap(SURV.round) bots en jeu, les autres attendent leur manche (off)
  const foe = surv || MATCH.mode === 'storm', cap = surv ? survBotCap(SURV.round) : 0; // la Tempête : tous les bots en jeu, tous chez Bravo (comme la Survie, sans rappel)
  // on retire des bots répartis sur les deux camps d'origine (un sur trois, puis les derniers)
  const off = new Set(ffa && cut > 0 ? bots.filter((e, i) => i % 3 === 1).concat(bots.slice().reverse()).filter((e, i, a) => a.indexOf(e) === i).slice(0, cut) : []);
  for (let i = 0; i < bots.length; i++) {
    const e = bots[i];
    e.off = surv ? i >= cap : off.has(e); // la Survie rappelle les bots dans l'ordre : quatre, puis un de plus à chaque manche
    e.team = foe ? 1 : e.team0; // la Survie et la Tempête mettent tous les bots chez Bravo ; sinon, l'équipe d'origine se reconstitue à chaque partie (team0, 07-bots.js)
    if (e.off) { e.alive = false; e.respawnT = Infinity; e.target = null; e.model.rag = null; e.model.root.visible = false; }
    soldierLook(e.model, skinOf(e), skinRel(e));
  }
}
function modeEnd() { domClear(); survClear(); stormClear(); }

/* Mises à jour à chaque image : protection d'apparition, score du match à mort, points de la domination */
function modeUpdate(dt) {
  for (const e of entities) {
    if (e.protT > 0) { e.protT -= dt; if (e.lastShotT > e.spawnAt) e.protT = 0; } // tirer fait perdre la protection
  }
  hudStyle(HUDE.prot, 'opacity', PL.ent.alive && PL.ent.protT > 0 ? '1' : '0');
  if (MATCH.mode === 'ffa') ffaScore();
  else if (MATCH.mode === 'dom') domUpdate(dt);
  else if (MATCH.mode === 'survival') survUpdate(dt);
  else if (MATCH.mode === 'storm') stormUpdate(dt);
}
/* Match à mort : MATCH.score[0] = mes éliminations, MATCH.score[1] = celles du meilleur adversaire */
function ffaScore() {
  let best = 0; for (const e of ffaList()) if (e !== PL.ent && e.kills > best) best = e.kills;
  MATCH.score[0] = PL.ent.kills; MATCH.score[1] = best;
}
/* Participants du match à mort : le joueur et 7 bots (les autres soldats restent hors jeu) */
const FFA_BOTS = 7;
function ffaList() { return entities.filter((e) => !e.off && (!MATCH.online || e.isPlayer || e.isRemote || e.netBot)); } // en ligne : ceux qui participent
function ffaRank() { return ffaList().sort(ffaCmp).indexOf(PL.ent) + 1; }
/* Limite atteinte par un tueur (éliminations) : la partie se joue sur une dernière killcam */
function killLimitReached() {
  if (MATCH.mode === 'ffa') { ffaScore(); return ffaList().some((e) => e.kills >= MATCH.limit); }
  if (MATCH.mode === 'dom' || MATCH.mode === 'survival' || MATCH.mode === 'storm') return false; // en Survie et en Tempête, la mort du joueur seule termine la partie (killEnt) ; la Tempête a en plus sa victoire (stormUpdate)
  return MATCH.score[0] >= MATCH.limit || MATCH.score[1] >= MATCH.limit;
}

/* ==========================================================================
   APPARITIONS
   Trois temps, sur le modèle des grands jeux de tir (Call of Duty, Halo) :
   1. Départ (spawnOpening) : chaque soldat a sa place, une seule par soldat, prise telle quelle. En équipe, les places de sa base, de la
      plus proche du centre de la base à la plus éloignée ; chacun pour soi, des places tirées sur la carte, chacune le plus loin possible
      des précédentes et hors de leur vue (ffaSlots). Le rang de chacun (openRank) est le même chez tous les joueurs d'un salon sans rien
      échanger : les joueurs du camp triés par identifiant, puis les bots de l'hôte. Le départ dure jusqu'au « En avant ! » (cdGo).
   2. Réapparition (chooseSpawn) : les candidats du mode (spawnPool) sont notés (spawnRate), puis écartés s'ils sont dangereux : un
      adversaire à moins de SPAWN.near m ou qui voit l'endroit à moins de SPAWN.sight m (spawnSeen), une grenade, un combat qui s'y joue
      (une mort il y a moins de SPAWN.fightT s), en domination un point contesté ou tenu par l'adversaire. On tire au sort parmi les
      meilleurs endroits sûrs (SPAWN.keep, à SPAWN.spread points du meilleur). Si aucun n'est sûr (l'adversaire campe la base), toute
      la carte s'ouvre, base adverse comprise : c'est la bascule des apparitions. Partout du danger : le moins mauvais endroit.
   3. Protection : 2 s d'invulnérabilité, perdue au premier tir (MODES.prot).
   La note : loin des adversaires, du bon côté du front (spawnFront : du milieu des adversaires en vie vers celui des alliés), près des
   coéquipiers, hors du regard d'un adversaire même sans ligne de vue (il tournerait le coin et verrait l'autre apparaître), loin d'une
   apparition récente (la sienne ou celle d'un autre joueur du salon, spawnNote), d'une mort récente, de sa propre mort, et des endroits
   où son camp vient de se faire tuer à l'apparition (SPAWN_TRAP : évités SPAWN.trapMem s).
   Candidats : tdm la base et les points de passage au sol de sa moitié de carte ; ffa les deux bases et tous les points de passage au
   sol ; dom la base (de l'autre côté si les fronts se sont croisés, domSide) et, dès que le camp tient un point, les points de passage.
   ========================================================================== */
const SPAWN = { near: 12, sight: 70, nade: 8, fightR: 10, fightT: 4, look: 40, trapT: 5, trapR: 14, trapMem: 20, keep: 3, spread: 8 };
const SPAWN_LOG = [], DEATH_LOG = [], SPAWN_TRAP = [];
const OPEN = { on: false, key: '', ffa: [] }; // on : départ de la partie en cours ; places du chacun pour soi de la carte key
function noteDeath(e) {
  e.lastDeath = { x: e.pos.x, z: e.pos.z, t: MATCH.time };
  DEATH_LOG.push(e.lastDeath); if (DEATH_LOG.length > 16) DEATH_LOG.shift();
  if (e.spawnPos && MATCH.time - (e.spawnAt || 0) < SPAWN.trapT) { // tué à peine apparu : l'endroit est piégé pour son camp
    SPAWN_TRAP.push({ x: e.spawnPos.x, z: e.spawnPos.z, t: MATCH.time, team: e.team }); if (SPAWN_TRAP.length > 12) SPAWN_TRAP.shift();
  }
}
/* Une apparition a eu lieu, ici (spawnEntity) ou chez un autre joueur du salon (netApply) : l'endroit est évité quelques secondes */
function spawnNote(e) {
  e.spawnPos = { x: e.pos.x, z: e.pos.z };
  SPAWN_LOG.push({ x: e.pos.x, z: e.pos.z, t: MATCH.time }); if (SPAWN_LOG.length > 24) SPAWN_LOG.shift();
}
/* Points de passage au sol (de plain-pied, sur le relief d'une carte en dunes), sans les postes tenus */
function spawnField() { return POI.filter((p) => p[1] < gy0(p[0], p[2]) + 1 && !p[4]).map((p) => [p[0], p[2]]); }
const spawnMid = (L) => [L.reduce((a, p) => a + p[0], 0) / L.length, L.reduce((a, p) => a + p[1], 0) / L.length];
/* Base d'un camp : la sienne, sauf en domination quand les fronts se sont croisés */
function spawnBase(team) { return MATCH.mode === 'dom' ? domSide(team) : team; }
/* Base de départ d'un camp en domination : la sienne, sauf quand les fronts se sont croisés (l'adversaire tient le point de
   sa base et lui tient celui de l'adversaire) : ses apparitions passent alors de l'autre côté, comme dans Call of Duty */
function domSide(team) {
  const n = DOM.pts.length; if (!n) return team;
  const home = DOM.pts[team === 0 ? 0 : n - 1], away = DOM.pts[team === 0 ? n - 1 : 0];
  return home.owner === 1 - team && away.owner === team ? 1 - team : team;
}

/* ---------- Départ ---------- */
/* Rang de départ d'un soldat dans son groupe (son camp, ou tous chacun pour soi). En solo : le joueur, puis les bots dans l'ordre. En ligne :
   les joueurs du groupe triés par identifiant (chacun calcule le même ordre chez lui, d'après l'état du salon), puis les bots de l'hôte. */
function openRank(e) {
  const mine = (o) => MATCH.mode === 'ffa' || o.team === e.team;
  if (!MATCH.online) return entities.filter((o) => !o.off && !o.isRemote && mine(o)).sort((a, b) => b.isPlayer - a.isPlayer).indexOf(e);
  const hum = [...NET.players.values()].filter((p) => p.ig && (MATCH.mode === 'ffa' || p.t === e.team)).map((p) => p.id).sort();
  if (e.isPlayer) { const i = hum.indexOf(NET.me); return i < 0 ? hum.length : i; }
  return hum.length + entities.filter((o) => o.netBot && mine(o)).indexOf(e);
}
/* Places de départ du groupe d'un soldat. En équipe : celles de sa base, du centre de la base vers ses bords (les deux bases étant en
   miroir, les deux camps ont la même formation) */
function openSlots(e) {
  if (MATCH.mode === 'ffa') { if (OPEN.key !== CURMAP.id) { OPEN.key = CURMAP.id; OPEN.ffa = ffaSlots(); } return OPEN.ffa; }
  const S = SPAWNS[spawnBase(e.team)], [cx, cz] = spawnMid(S);
  return S.map((s, i) => [s, i, hyp(s[0] - cx, s[1] - cz)]).sort((a, b) => a[2] - b[2] || a[1] - b[1]).map((a) => a[0]);
}
/* Places de départ chacun pour soi : la première au centre de la base d'Alpha, chacune des suivantes le plus loin possible des places déjà
   prises et hors de leur vue. Calcul sans hasard : les mêmes places chez tous les joueurs d'un salon. */
function ffaSlots() {
  const head = (p, v) => v.set(p[0], gy0(p[0], p[1]) + 1.6, p[1]);
  const left = SPAWNS[0].concat(SPAWNS[1], spawnField()), [cx, cz] = spawnMid(SPAWNS[0]), out = [];
  let i0 = 0; SPAWNS[0].forEach((s, i) => { if (hyp(s[0] - cx, s[1] - cz) < hyp(SPAWNS[0][i0][0] - cx, SPAWNS[0][i0][1] - cz)) i0 = i; });
  out.push(left.splice(i0, 1)[0]);
  while (out.length < 12 && left.length) {
    const R = left.map((c, i) => [i, Math.min(60, ...out.map((o) => hyp(o[0] - c[0], o[1] - c[1])))]).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    let bi = R[0][0], bs = -1e9;
    for (const [i, md] of R) {
      if (md <= bs) break; // plus loin, aucun ne fera mieux
      const c = left[i], seen = out.some((o) => hyp(o[0] - c[0], o[1] - c[1]) < SPAWN.sight && lineClear(head(c, _v1), head(o, _v2)));
      const s = md - (seen ? 40 : 0); if (s > bs) { bs = s; bi = i; }
    }
    out.push(left.splice(bi, 1)[0]);
  }
  return out;
}
/* Place de départ d'un soldat, sur le nœud de navigation de sa place ; null si son rang dépasse les places ou si la place est prise
   (un joueur qui rejoint la partie en cours) : il réapparaît alors comme après une mort */
function spawnOpening(e) {
  const S = openSlots(e), k = openRank(e);
  if (k < 0 || k >= S.length) return null;
  const [x, z] = S[k], id = navNode(x, gy0(x, z), z), p = id >= 0 ? new V3(NAV.nx[id], NAV.ny[id], NAV.nz[id]) : new V3(x, gy0(x, z), z);
  for (const o of entities) if (o !== e && o.alive && Math.abs(o.pos.y - p.y) < 1.2 && hyp(o.pos.x - p.x, o.pos.z - p.z) < 1.2) return null;
  return p;
}

/* ---------- Réapparition ---------- */
/* Candidats du mode, [x, z] ; wide : rien de sûr dans les candidats habituels, toute la carte s'ouvre (bascule) */
function spawnPool(e, wide) {
  if (MATCH.mode === 'ffa') return SPAWNS[0].concat(SPAWNS[1], spawnField());
  const t = spawnBase(e.team), home = SPAWNS[t];
  if (wide) return home.concat(spawnField(), SPAWNS[1 - t]);
  if (MATCH.mode === 'tdm' || MATCH.mode === 'survival') { const side = Math.sign(spawnMid(home)[1]); return home.concat(spawnField().filter((p) => p[1] * side > 6)); } // sa moitié de carte (la Survie : le joueur aussi, il n'a pas d'alliés à rejoindre)
  return DOM.pts.some((p) => p.owner === e.team) ? home.concat(spawnField()) : home;
}
/* Adversaires et alliés en vie, et le front */
function spawnCtx(e) {
  const foes = [], pals = [];
  for (const o of entities) if (o !== e && o.alive && !o.off) (allied(o, e) ? pals : foes).push(o);
  return { foes, pals, front: MATCH.mode === 'ffa' ? null : spawnFront(e, foes, pals) };
}
/* Le front : la ligne à mi-chemin entre le milieu des adversaires en vie et celui des alliés (à défaut, leur base), normale (dx, dz)
   tournée vers son camp. (x - F.x) * F.dx + (z - F.z) * F.dz > 0 : de son côté. L'adversaire qui avance dans la base fait passer
   le front derrière elle : les apparitions basculent d'elles-mêmes vers le reste de la carte. */
function spawnFront(e, foes, pals) {
  const t = spawnBase(e.team), at = (L) => L.map((o) => [o.pos.x, o.pos.z]);
  const A = spawnMid(pals.length ? at(pals) : SPAWNS[t]), E = spawnMid(foes.length ? at(foes) : SPAWNS[1 - t]);
  let dx = A[0] - E[0], dz = A[1] - E[1], d = hyp(dx, dz);
  if (d < 1) { dx = 0; dz = Math.sign(spawnMid(SPAWNS[t])[1]) || 1; d = 1; }
  return { x: (A[0] + E[0]) / 2, z: (A[1] + E[1]) / 2, dx: dx / d, dz: dz / d };
}
/* Note d'un candidat, et s'il est sûr (hors ligne de vue, vue à part : spawnSeen, plus coûteuse, ne se calcule que pour les mieux notés) */
function spawnRate(e, C, x, z) {
  const now = MATCH.time, ffa = MATCH.mode === 'ffa';
  let md = 999, near = 0, look = 0, crowd = 0, pal = 0, safe = true;
  for (const o of C.foes) {
    const dx = x - o.pos.x, dz = z - o.pos.z, d = hyp(dx, dz);
    md = Math.min(md, d);
    if (d < 2.5) near += d < 1.2 ? 3 : 1;
    if (d < SPAWN.look && d > 0.1 && (-Math.sin(o.yaw) * dx - Math.cos(o.yaw) * dz) / d > 0.7) look++; // l'endroit est dans son regard
    if (ffa && d < 20) crowd++;
  }
  for (const o of C.pals) {
    const d = hyp(x - o.pos.x, z - o.pos.z);
    if (d < 2.5) near += d < 1.2 ? 3 : 1; // une place déjà occupée ne se choisit qu'en dernier recours
    else if (d < 20) pal = 1;
  }
  if (md < SPAWN.near) safe = false;
  for (const n of NADES) if (hyp(n.p.x - x, n.p.z - z) < SPAWN.nade) safe = false;
  let s = Math.min(md, ffa ? 60 : 40) - look * 10 - near * 20 - crowd * 4 + rand(0, 6);
  if (!ffa) {
    const F = C.front, depth = (x - F.x) * F.dx + (z - F.z) * F.dz;
    s += (depth < 0 ? depth * 1.5 : Math.min(depth, 25) * 0.4) + pal * 8; // de son côté du front, près des coéquipiers
  }
  for (const l of SPAWN_LOG) { const age = now - l.t, d = hyp(l.x - x, l.z - z); if (age < 8 && d < 10) s -= (1 - d / 10) * 30 * (1 - age / 8); }
  for (const l of DEATH_LOG) {
    const age = now - l.t, d = hyp(l.x - x, l.z - z);
    if (age < SPAWN.fightT && d < SPAWN.fightR) safe = false; // un combat s'y joue encore
    if (age < 6 && d < 14) s -= (1 - d / 14) * 22 * (1 - age / 6);
  }
  for (const l of SPAWN_TRAP) {
    const age = now - l.t, d = hyp(l.x - x, l.z - z);
    if (age < SPAWN.trapMem && d < SPAWN.trapR && (ffa || l.team === e.team)) s -= (1 - d / SPAWN.trapR) * 30 * (1 - age / SPAWN.trapMem);
  }
  if (e.lastDeath && now - e.lastDeath.t < 15 && hyp(e.lastDeath.x - x, e.lastDeath.z - z) < 12) s -= 14;
  if (MATCH.mode === 'dom') {
    let dOwn = 1e9, dFront = 1e9;
    for (const p of DOM.pts) {
      const d = hyp(p.x - x, p.z - z);
      if (p.owner === e.team) dOwn = Math.min(dOwn, d); else dFront = Math.min(dFront, d);
      if ((p.contest || p.owner === 1 - e.team) && d < DOM.rad + 4) safe = false; // ni dans un point disputé, ni dans celui de l'adversaire
    }
    if (dOwn < 1e9) s += Math.max(0, 24 - dOwn) * 0.7;           // près d'un point tenu
    if (dOwn < 1e9 && md > 16) s += Math.max(0, 60 - dFront) * 0.12; // et du front, quand l'endroit est sûr
  }
  return { x, z, s, safe };
}
/* Un adversaire voit-il l'endroit (tête ou buste d'un soldat qui y apparaîtrait, à moins de SPAWN.sight m) ? */
function spawnSeen(C, x, z, y = gy0(x, z)) {
  for (const o of C.foes) {
    if (hyp(o.pos.x - x, o.pos.z - z) > SPAWN.sight) continue;
    entEye(o, _v2);
    if (lineClear(_v1.set(x, y + 1.6, z), _v2) || lineClear(_v1.set(x, y + 1.0, z), _v2)) return true;
  }
  return false;
}
/* Les mieux notés d'abord ; les SPAWN.keep premiers sûrs et hors de vue, tirage parmi ceux à SPAWN.spread points du meilleur */
function spawnPick(e, C, pool) {
  const R = pool.map(([x, z]) => spawnRate(e, C, x, z)).sort((a, b) => b.s - a.s), ok = [];
  for (const c of R) {
    if (!c.safe || spawnSeen(C, c.x, c.z)) continue;
    ok.push(c); if (ok.length >= SPAWN.keep) break;
  }
  const top = ok.filter((c) => c.s >= ok[0].s - SPAWN.spread);
  return { pick: top.length ? top[Math.floor(Math.random() * top.length)] : null, best: R[0] };
}
function chooseSpawn(e) {
  if (OPEN.on) { const p = spawnOpening(e); if (p) return p; }
  const C = spawnCtx(e), r = spawnPick(e, C, spawnPool(e, false));
  const c = r.pick || (MATCH.mode !== 'ffa' && spawnPick(e, C, spawnPool(e, true)).pick) || r.best;
  return spawnSpot(e, c.x, c.z, C);
}
/* Du point retenu à la place d'apparition : un nœud de navigation tiré au hasard à moins de SPAWN_JIT m du point, au même étage, en vue
   du point, sans soldat vivant à moins de 0,9 m et, à la réapparition (C), hors de la vue des adversaires (sur une carte ouverte, un pas de
   côté suffisait à sortir à découvert) ; sinon le nœud du point. Deux soldats qui tirent le même point en même temps (en ligne,
   chacun choisit chez soi) ne tombent pas l'un dans l'autre ; le reste d'un chevauchement se défait en marchant (spawnPush, 07c-controller.js). */
const SPAWN_JIT = 1.7;
function spawnSpot(e, x, z, C) {
  const id0 = navNode(x, gy0(x, z), z);
  if (id0 < 0) return new V3(x, gy0(x, z), z);
  const y0 = NAV.ny[id0], free = (id) => {
    for (const o of entities) if (o !== e && o.alive && Math.abs(o.pos.y - NAV.ny[id]) < 1.2 && hyp(o.pos.x - NAV.nx[id], o.pos.z - NAV.nz[id]) < 0.9) return false;
    return true;
  };
  for (let k = 0; k < 12; k++) {
    const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * SPAWN_JIT, id = navNode(NAV.nx[id0] + Math.cos(a) * r, y0, NAV.nz[id0] + Math.sin(a) * r);
    if (id < 0 || Math.abs(NAV.ny[id] - y0) > 0.4 || !free(id)) continue;
    if (id !== id0 && !lineClear(_v1.set(NAV.nx[id0], y0 + 1, NAV.nz[id0]), _v2.set(NAV.nx[id], NAV.ny[id] + 1, NAV.nz[id]))) continue;
    if (id !== id0 && C && spawnSeen(C, NAV.nx[id], NAV.nz[id], NAV.ny[id])) continue;
    return new V3(NAV.nx[id], NAV.ny[id], NAV.nz[id]);
  }
  return new V3(NAV.nx[id0], y0, NAV.nz[id0]);
}
/* Cap à l'apparition : vers l'adversaire en équipe (au départ, droit vers la base adverse, toute la formation dans le même sens ; ensuite
   vers le milieu des adversaires en vie), vers le centre de la carte chacun pour soi, vers le point à prendre le plus proche en
   domination ; tourné au besoin pour ne pas regarder un mur (spawnFace) */
function spawnYaw(e, p) {
  let tx = 0, tz = 0;
  if (MATCH.mode === 'tdm') {
    if (OPEN.on) return e.team === 0 ? 0 : Math.PI;
    const foes = entities.filter((o) => o.alive && !o.off && !allied(o, e)).map((o) => [o.pos.x, o.pos.z]);
    [tx, tz] = spawnMid(foes.length ? foes : SPAWNS[1 - e.team]);
  } else if (MATCH.mode === 'dom') {
    let bd = 1e9;
    for (const q of DOM.pts) { const d = hyp(q.x - p.x, q.z - p.z) + (q.owner === e.team ? 40 : 0); if (d < bd) { bd = d; tx = q.x; tz = q.z; } }
  }
  return spawnFace(p, Math.atan2(-(tx - p.x), -(tz - p.z)));
}
/* Un cap qui ne regarde pas un mur à bout portant : le plus proche du cap voulu qui laisse 4 m de vue dégagée */
function spawnFace(p, yaw) {
  _v1.set(p.x, p.y + 1.5, p.z);
  for (const o of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
    const a = yaw + o;
    if (lineClear(_v1, _v2.set(p.x - Math.sin(a) * 4, p.y + 1.5, p.z - Math.cos(a) * 4))) return a;
  }
  return yaw;
}

/* ==========================================================================
   DOMINATION
   Trois points (MAP_DEFS.<id>.dom : [x, z] de A, B, C, symétriques en z comme les bases) : A près de la base d'Alpha, C près de
   celle de Bravo, B au centre. v va de -1 (Bravo) à +1 (Alpha) : un camp seul dans la zone la fait avancer (plus vite à
   plusieurs), les deux camps présents la bloquent. Le point change de main en passant par le neutre : il faut d'abord
   le neutraliser. Sans personne dessus, un point tenu se raffermit et un point à moitié pris retombe au neutre.
   ========================================================================== */
const DOM = { pts: [], rad: 5.5, dy: 2.8, tick: 4, rate: 1 / 6, acc: [0, 0], side: [0, 1], names: ['A', 'B', 'C'], mk: [], tex: null };
const DOM_COL = { ally: [0.56, 0.82, 0.42], enemy: [0.89, 0.28, 0.23], none: [0.82, 0.82, 0.76], hot: [0.96, 0.75, 0.23] };
const _dv = new V3();
function domInit() {
  const defs = CURMAP.def && CURMAP.def.dom;
  if (!defs) return;
  DOM.acc[0] = DOM.acc[1] = 0; DOM.side = [0, 1];
  DOM.pts = defs.map(([x, z], i) => {
    const id = navNode(x, gy0(x, z), z), y = id >= 0 ? NAV.ny[id] : gy0(x, z);
    const p = { i, name: DOM.names[i], x, z, y, owner: -1, v: 0, n: [0, 0], contest: false, mmCol: null, mmFill: '', mmLine: '', mmCv: null }; // mm : mini-carte (domMinimap)
    domBuild(p);
    return p;
  });
  // repères à l'écran : enfants directs de #hud, placés devant la lunette (#scope) : ce sont des objets du monde, sous tout le reste du HUD
  // (messages, gains d'XP) et sous le masque de la lunette
  const hud = $('hud'), at = $('scope');
  for (const p of DOM.pts) {
    const el = document.createElement('div'); el.className = 'dpm'; el.innerHTML = `<b>${p.name}</b><i></i>`;
    hud.insertBefore(el, at); DOM.mk.push(el); p.el = el;
  }
  $('domRow').innerHTML = DOM.pts.map((p) => `<span id="domB${p.i}">${p.name}</span>`).join('');
}
function domClear() {
  for (const p of DOM.pts) {
    if (!p.obj) continue;
    if (p.obj.parent) p.obj.parent.remove(p.obj);
    p.obj.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
  if (DOM.tex) { DOM.tex.ring.dispose(); DOM.tex.veil.dispose(); DOM.tex = null; }
  for (const el of DOM.mk) el.remove();
  DOM.pts = []; DOM.mk = [];
}
/* Balise d'un point, discrète et fondue dans le décor : un disque au sol à bord doux et son liseré (la zone de capture), un voile
   bas qui s'estompe en hauteur (la limite de la zone, vue de loin comme de près), un mât et un fanion qui monte à mesure de la
   prise. Pas de faisceau : de loin, le repère à l'écran (lettre et distance) suffit. Textures partagées par les trois points. */
function domTextures() {
  if (DOM.tex) return DOM.tex;
  // sol : disque à peine teinté, liseré à bord doux près du bord (le dégradé radial remplace tout trait net)
  const ring = canvasTex(256, (g, S) => {
    const r = S / 2, gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.04)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.12)'); gr.addColorStop(0.9, 'rgba(255,255,255,0.3)');
    gr.addColorStop(0.945, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.985, 'rgba(255,255,255,0.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  }, false);
  // voile : opaque au pied, transparent en haut
  const veil = canvasTex(64, (g, S) => {
    const gr = g.createLinearGradient(0, 0, 0, S);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0.7)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  }, false);
  return (DOM.tex = { ring, veil });
}
/* Point de domination factice, compilé avec la carte (mapCompile) puis caché : les vrais points sont créés au départ d'une partie en
   domination, après la compilation, et leurs programmes (anneau et voile, mât, drapeau) se compilaient à la première image puis dans les
   premières secondes de la partie (à-coup de 26 ms relevé par saccades.js en domination sur Kervénec, davantage sous Direct3D) ; mêmes
   matières, mêmes programmes, que three.js garde tant que ce point existe. Libéré avec la carte (mapAdd). */
function domWarm() {
  if (!CURMAP.def || !CURMAP.def.dom) return null;
  const p = { i: 0, name: 'A', x: 0, z: 0, y: -60, owner: -1, v: 0, n: [0, 0], contest: false };
  domBuild(p); p.obj.name = 'domination (compilation)';
  return p.obj;
}
function domBuild(p) {
  const T = domTextures(), g = new THREE.Group(); g.position.set(p.x, p.y, p.z);
  const add = (geo, mat, y, order) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.userData.noAO = true; m.renderOrder = order; m.frustumCulled = false; g.add(m); return m; };
  const soft = (map, order) => { const m = new THREE.MeshBasicMaterial({ map, color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true }); m.polygonOffset = true; m.polygonOffsetFactor = -order; return m; };
  p.ringMat = soft(T.ring, 2); p.ringMat.opacity = 0.9;
  const disc = add(new THREE.CircleGeometry(DOM.rad, 64), p.ringMat, 0.05, 4); disc.rotation.x = -Math.PI / 2;
  p.veilMat = soft(T.veil, 0); p.veilMat.opacity = 0.5;
  add(new THREE.CylinderGeometry(DOM.rad, DOM.rad, 1.5, 64, 1, true), p.veilMat, 0.75, 5);
  add(new THREE.CylinderGeometry(0.04, 0.05, 2.8, 8), new THREE.MeshBasicMaterial({ color: 0x2a2a26 }), 1.4, 1);
  p.flagMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const fg = new THREE.PlaneGeometry(1.0, 0.62); fg.translate(0.5, 0, 0);
  p.flag = add(fg, p.flagMat, 0.5, 2);
  p.obj = g; mapAdd(g);
}
function domColor(p) {
  const me = PL.ent.team;
  if (p.contest) return DOM_COL.hot;
  if (p.owner === -1) return DOM_COL.none;
  return p.owner === me ? DOM_COL.ally : DOM_COL.enemy;
}
function domUpdate(dt) {
  if (!DOM.pts.length) return;
  for (const p of DOM.pts) {
    const n = [0, 0];
    for (const e of entities) {
      if (!e.alive || Math.abs(e.pos.y - p.y) > DOM.dy || hyp(e.pos.x - p.x, e.pos.z - p.z) > DOM.rad) continue;
      n[e.team]++;
    }
    p.n = n; p.contest = n[0] > 0 && n[1] > 0;
    if (domGuest()) continue; // en ligne, l'hôte tient les points : l'invité en reçoit l'état (domNetApply)
    const was = p.owner;
    if (!p.contest && (n[0] || n[1])) {
      const t = n[0] ? 0 : 1, k = Math.min(n[t], 3);
      p.v = clamp(p.v + (t === 0 ? 1 : -1) * dt * DOM.rate * (1 + 0.5 * (k - 1)), -1, 1);
    } else if (!p.contest) {
      const to = p.owner === -1 ? 0 : p.owner === 0 ? 1 : -1;
      p.v += clamp(to - p.v, -dt * 0.1, dt * 0.1);
    }
    if (p.v >= 1) p.owner = 0; else if (p.v <= -1) p.owner = 1;
    else if ((p.owner === 0 && p.v <= 0) || (p.owner === 1 && p.v >= 0)) p.owner = -1;
    if (p.owner !== was) domChanged(p, was);
  }
  for (const t of [0, 1]) {
    const s = domSide(t);
    if (s !== DOM.side[t]) {
      DOM.side[t] = s;
      if (t === PL.ent.team) hudMsg(s === t ? _t('Vos apparitions retrouvent votre base') : _t('Front croisé : vos apparitions passent côté adverse'), s === t ? 'ally' : 'xp', 3);
    }
  }
  if (MATCH.over || domGuest()) return;
  for (const t of [0, 1]) {
    DOM.acc[t] += DOM.pts.filter((p) => p.owner === t).length * dt / DOM.tick;
    while (DOM.acc[t] >= 1) { DOM.acc[t] -= 1; MATCH.score[t]++; }
  }
  if (MATCH.score[0] >= MATCH.limit || MATCH.score[1] >= MATCH.limit) {
    matchFinish(); // annonce du résultat (09l-fin.js), puis tableau des scores : la domination n'a pas de killcam
  }
}
/* Invité d'un salon : il ne calcule ni la prise des points ni le score */
function domGuest() { return MATCH.online && NET.role !== 'host'; }
/* État des points tenu par l'hôte, joint à ses envois : [[v, propriétaire]...] et le score des deux camps */
function domNetState() { return { p: DOM.pts.map((p) => [Math.round(p.v * 1000) / 1000, p.owner]), s: MATCH.score.slice() }; }
function domNetApply(m) {
  if (!domGuest() || !m || !Array.isArray(m.p) || m.p.length !== DOM.pts.length) return;
  m.p.forEach((q, i) => {
    const p = DOM.pts[i], was = p.owner;
    p.v = clamp(+q[0] || 0, -1, 1); p.owner = q[1] === 0 || q[1] === 1 ? q[1] : -1;
    if (p.owner !== was) domChanged(p, was);
  });
  if (Array.isArray(m.s) && !MATCH.fin) MATCH.score = [m.s[0] | 0, m.s[1] | 0];
}
/* Un point change de main : annonce, et points de score à ceux qui l'ont pris */
function domChanged(p, was) {
  squadDirty(); // un point change de main : le plan d'équipe est refait tout de suite (07d-squad.js)
  const me = PL.ent.team, o = p.owner;
  if (o !== -1) {
    for (const e of entities) {
      if (!e.alive || e.team !== o || !p.n[o] || Math.abs(e.pos.y - p.y) > DOM.dy || hyp(e.pos.x - p.x, e.pos.z - p.z) > DOM.rad) continue;
      e.score += 100; e.caps++;
      if (e.isPlayer) { xpPopup('+100', `${_t('Point {0} capturé', p.name)}`); defiAdd('vDom'); }
    }
    hudMsg(o === me ? `${_t('Point {0} capturé', p.name)}` : _t('Point {0} perdu', p.name), o === me ? 'ally' : 'enemy', 2.2);
    sfxAnnounce(o === me ? 'cap' : was === me ? 'lost' : 'ecap', o === me ? 'st_capture' : 'st_lost'); // ecap : pris par l'ennemi sur un point neutre (signal sans voix)
  } else if (was === me) { hudMsg(`${_t('Point {0} neutralisé par l\u0027ennemi', p.name)}`, 'enemy', 2); sfxAnnounce('neutral', 'st_lost'); }
  else if (was !== -1) { hudMsg(`${_t('Point {0} neutralisé', p.name)}`, 'ally', 1.8); sfxUi('confirm'); }
}
/* Bonus d'une élimination à proximité d'un point : on défend le sien ou on attaque celui de l'autre */
function domKillBonus(a, v) {
  if (MATCH.mode !== 'dom' || !a.isPlayer) return;
  for (const p of DOM.pts) {
    if (hyp(v.pos.x - p.x, v.pos.z - p.z) > DOM.rad + 4 || hyp(a.pos.x - p.x, a.pos.z - p.z) > DOM.rad + 8) continue;
    a.score += 50; xpPopup('+50', p.owner === a.team ? `${_t('Défense du point {0}', p.name)}` : `${_t('Attaque du point {0}', p.name)}`, 'small');
    return;
  }
}

/* Image par image : couleurs et fanion des balises, repères à l'écran, barre de capture, pastilles du score */
function domHud(dt) {
  if (!DOM.pts.length) return;
  const me = PL.ent, now = MATCH.time, pulse = 0.65 + 0.35 * Math.sin(now * 6);
  let inside = null;
  for (const p of DOM.pts) {
    const c = domColor(p), k = p.contest ? pulse : 1, m = p.v > 0 ? DOM_COL[me.team === 0 ? 'ally' : 'enemy'] : p.v < 0 ? DOM_COL[me.team === 1 ? 'ally' : 'enemy'] : DOM_COL.none;
    const here = me.alive && p.n[me.team] > 0 && Math.abs(me.pos.y - p.y) <= DOM.dy && hyp(me.pos.x - p.x, me.pos.z - p.z) <= DOM.rad;
    const dim = p.contest ? 1 : p.owner === -1 ? 0.55 : 0.8; // teintes un peu sombres : elles se lisent sur la neige (un point neutre est gris, pas blanc)
    p.ringMat.color.setRGB(c[0] * dim * k, c[1] * dim * k, c[2] * dim * k); p.veilMat.color.setRGB(c[0] * dim, c[1] * dim, c[2] * dim);
    p.veilMat.opacity = damp(p.veilMat.opacity, here ? 0.14 : 0.5, 4, dt); // dans la zone, le voile s'efface pour ne pas gêner la vue
    p.flagMat.color.setRGB(m[0], m[1], m[2]);
    p.flag.position.y = 0.4 + 2.0 * Math.abs(p.v);
    p.flag.rotation.y = Math.sin(now * 2.2 + p.i) * 0.25;
    // repère à l'écran
    _dv.set(p.x, p.y + 3.4, p.z).project(camera);
    const el = p.el, show = _dv.z < 1 && Math.abs(_dv.x) < 1.1 && Math.abs(_dv.y) < 1.1;
    hudStyle(el, 'opacity', show ? '1' : '0');
    if (show) {
      hudStyle(el, 'transform', `translate(${Math.round((_dv.x * 0.5 + 0.5) * VIEW.w)}px, ${Math.round((-_dv.y * 0.5 + 0.5) * VIEW.h)}px) translate(-50%, -50%)`);
      hudText(el.lastChild, `${Math.round(hyp(p.x - camera.position.x, p.z - camera.position.z))} m`);
      const cls = 'dpm ' + (p.contest ? 'hot' : p.owner === -1 ? 'none' : p.owner === me.team ? 'ally' : 'enemy');
      if (el.className !== cls) el.className = cls;
    }
    const b = $('domB' + p.i), bc = p.contest ? 'hot' : p.owner === -1 ? '' : p.owner === me.team ? 'ally' : 'enemy';
    if (b && b.className !== bc) b.className = bc;
    if (here) inside = p;
  }
  // barre de capture (sous les invites du réticule) : teinte par classe (shell.html, jetons), écrite seulement quand elle change
  const bar = HUDE.domCap;
  let cls = '';
  if (inside) {
    const p = inside, mv = Math.abs(p.v), mine = (p.v > 0) === (me.team === 0);
    hudText(HUDE.domCapT, p.contest ? `${_t('Point {0} contesté', p.name)}` : p.owner === me.team && mv >= 1 ? _t('Point {0} tenu', p.name) : p.owner === -1 || !mine ? `${_t('Capture du point {0}', p.name)}` : _t('Point {0} : reprise', p.name));
    hudStyle(HUDE.domCapF, 'transform', `scaleX(${mv.toFixed(3)})`);
    cls = p.contest ? 'show hot' : mine || p.v === 0 ? 'show' : 'show enemy';
  }
  if (bar.className !== cls) bar.className = cls;
}

/* Bots : un endroit praticable dans la zone du point p, entre r0 et r1 mètres de son centre, que le bot peut tenir (le plan d'équipe
   qui choisit le point et le rôle est dans src/07d-squad.js) */
function domSpot(p, r0, r1) {
  for (let k = 0; k < 6; k++) {
    const a = rand(0, TAU), r = rand(r0, r1), x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r, id = navNode(x, p.y, z);
    if (id < 0 || hyp(NAV.nx[id] - p.x, NAV.nz[id] - p.z) > DOM.rad - 1 || Math.abs(NAV.ny[id] - p.y) > 1.5) continue;
    const g = new V3(NAV.nx[id], NAV.ny[id], NAV.nz[id]); g.hold = true; g.dom = p.i; return g;
  }
  const g = new V3(p.x, p.y, p.z); g.hold = true; g.dom = p.i; return g;
}

/* Mini-carte : zone et lettre de chaque point, à la couleur de son état (le contexte est déjà tourné vers le cap du joueur). La lettre est
   dessinée une fois par couleur dans une petite toile (domLetter) : écrite à chaque image (police relue, contour et remplissage), elle
   prenait jusqu'à 2 ms par image (rapport de performances du propriétaire, domination sur Kervénec, 280 images par seconde) */
const DOM_MM = { box: 24, k: 3 }; // toile de la lettre : côté en unités de la mini-carte, pixels par unité
function domMinimap(g, scale, yaw) {
  for (const p of DOM.pts) {
    const col = domColor(p);
    if (p.mmCol !== col) { p.mmCol = col; const c = col.map((x) => Math.round(x * 255)).join(','); p.mmFill = `rgba(${c},0.22)`; p.mmLine = `rgba(${c},0.9)`; domLetter(p, c); if (document.fonts && document.fonts.status === 'loading') p.mmCol = null; } // (police pas encore chargée : la lettre sera refaite)
    g.fillStyle = p.mmFill; g.strokeStyle = p.mmLine; g.lineWidth = 2;
    g.beginPath(); g.arc(p.x * scale, p.z * scale, DOM.rad * scale, 0, TAU); g.fill(); g.stroke();
    g.save(); g.translate(p.x * scale, p.z * scale); g.rotate(-yaw);
    const B = DOM_MM.box; g.drawImage(p.mmCv, -B / 2, -B / 2, B, B); g.restore();
  }
}
/* La lettre d'un point (couleur c : « r,g,b »), au centre de sa toile, avec son contour sombre */
function domLetter(p, c) {
  const B = DOM_MM.box, K = DOM_MM.k, cv = p.mmCv || (p.mmCv = document.createElement('canvas'));
  cv.width = cv.height = B * K;
  const x = cv.getContext('2d'); x.setTransform(K, 0, 0, K, 0, 0);
  x.font = '700 15px "Barlow Condensed", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.strokeStyle = 'rgba(0,0,0,0.7)'; x.lineWidth = 3; x.strokeText(p.name, B / 2, B / 2 + 1);
  x.fillStyle = `rgb(${c})`; x.fillText(p.name, B / 2, B / 2 + 1);
}

/* ==========================================================================
   SURVIE : LA BOUCLE D'EXTRACTION
   Le match démarre en « combat » : le chrono de manche (120 s à la première, +30 s à chaque
   suivante, survStart) s'affiche dans le HUD (updateHud). À zéro, l'extraction s'ouvre
   (survOpen) : une balise jaune surgit quelque part de la carte, elle clignote sur la
   mini-carte (survMinimap), et dix secondes tenues sur place (survUpdate, la barre de capture
   de la domination) font passer à la carte suivante (survExtract) : éliminations et temps
   conservés, un bot de plus en jeu (survBotCap, modeRoster), la carte suivante vient de la
   file battue au départ (survNextMap). La mort, elle, termine la partie comme avant.
   ========================================================================== */
const SURV = { phase: 'combat', round: 1, t: 120, rad: 5, hold: 0, holdMax: 10, minD: 60, x: 0, z: 0, y: 0, obj: null, tex: null, carry: null, queue: null, shown: 0, stripR: 0 }; // shown : le dernier chiffre du compte à rebours de tenue affiché (0 : rien à l'écran) ; stripR : la dernière manche écrite au bandeau (un invité rejoint en cours de partie)
/* Bots en jeu à la manche r : quatre à la première, un de plus à chaque passage, onze au plus
   (les onze soldats d'origine : aucune création, la manche ne fait que les rappeler, modeRoster) */
const survBotCap = (r) => Math.min(11, 3 + r);
/* Début de partie (modeStart) : manche neuve — la file des cartes se bat, le chrono part de 120 s —
   ou celle que transporte un passage d'extraction (SURV.carry, posé par survExtract) : les
   éliminations et le temps repris, la manche suivante, +30 s au chrono (la formule demandée) */
function survStart() {
  const c = SURV.carry; SURV.carry = null;
  SURV.round = c ? c.round : 1;
  if (c) { PL.ent.kills = c.kills; MATCH.timeLeft = c.timeLeft; } // startMatch vient de les remettre à zéro (09-game.js)
  else if (!(MATCH.online && NET.role !== 'host')) SURV.queue = MAPS.filter((m) => m.ok && m.id !== MAPL.id).map((m) => m.id).sort(() => Math.random() - 0.5); // la file des cartes, battue au départ, sans celle en cours (déjà jouée : elle ne reviendra qu'au cycle suivant) ; en ligne, seul l'hôte la tient (survNextMap, survNetMap)
  SURV.phase = 'combat'; SURV.hold = 0; SURV.t = 120 + 30 * (SURV.round - 1);
  if (c) hudMsg(_t('Manche {0}', SURV.round), 'xp', 2.5);
}
/* Chaque image de Survie (modeUpdate) : le chrono de manche, puis la tenue du point d'extraction.
   On ne compte qu'en jeu ('playing') : derrière le menu de pause la partie continue (pauseGame),
   mais le chrono de manche, lui, attend. En ligne, seul l'hôte compte (les invités reçoivent l'état,
   survNetApply) : c'est lui aussi qui décide de la fin — Hardcore à la première mort, Sans fin à la
   dernière (NET.cfg.dm) — et la tenue suit la règle de l'hôte (NET.cfg.xr) : un joueur suffit, ou tous. */
function survUpdate(dt) {
  if (MATCH.state !== 'playing') return;
  if (MATCH.online && NET.role !== 'host') { // invité : rien ne se calcule ici, seul le balisage pulse
    if (SURV.phase === 'extraction') survMarkerTick(dt);
    return;
  }
  let alive = 1;
  if (MATCH.online) {
    alive = PL.ent.alive ? 1 : 0;
    let total = 1;
    for (const r of NET.remotes.values()) if (!r.remoteBot) { total++; if (r.alive || r.pred) alive++; } // pred : mort prédite d'un tir de ce poste, pas confirmée — comptée vivante (Hardcore ne finit pas sur une prédiction)
    if (alive < total && (NET.cfg.dm ? true : alive === 0)) { matchFinishSoon(); return; } // Hardcore : la première mort ; Sans fin : la dernière
  }
  if (SURV.phase === 'combat') {
    SURV.t -= dt;
    if (SURV.t <= 0) survOpen();
    return;
  }
  survMarkerTick(dt); // pulsation du balisage
  let inside;
  if (MATCH.online) {
    let inZone = PL.ent.alive && Math.abs(PL.ent.pos.y - SURV.y) <= 2.2 && hyp(PL.ent.pos.x - SURV.x, PL.ent.pos.z - SURV.z) <= SURV.rad ? 1 : 0;
    for (const r of NET.remotes.values()) if (!r.remoteBot && (r.alive || r.pred) && Math.abs(r.pos.y - SURV.y) <= 2.2 && hyp(r.pos.x - SURV.x, r.pos.z - SURV.z) <= SURV.rad) inZone++; // les morts attendent le passage : seuls les vivants comptent
    inside = NET.cfg.xr ? alive > 0 && inZone >= alive : inZone > 0;
  } else {
    const e = PL.ent;
    inside = e.alive && Math.abs(e.pos.y - SURV.y) <= 2.2 && hyp(e.pos.x - SURV.x, e.pos.z - SURV.z) <= SURV.rad;
  }
  SURV.hold = inside ? SURV.hold + dt : 0; // on sort du point : la tenue repart de zéro
  if (SURV.hold >= SURV.holdMax) survExtract();
}
/* Fin du chrono de combat : le point d'extraction s'ouvre à un endroit praticable, tiré au sort
   (les candidats du chacun pour soi : les deux bases et les points de passage, voir spawnPool), loin
   des joueurs — en ligne, de chacun des vivants chez l'hôte */
function survOpen() {
  SURV.phase = 'extraction'; SURV.hold = 0;
  const base = SPAWNS[0].concat(SPAWNS[1], spawnField());
  let pool = base.filter((p) => hyp(p[0] - PL.ent.pos.x, p[1] - PL.ent.pos.z) >= SURV.minD);
  if (MATCH.online) {
    const all = base.filter((p) => {
      if (hyp(p[0] - PL.ent.pos.x, p[1] - PL.ent.pos.z) < SURV.minD) return false;
      for (const r of NET.remotes.values()) if (!r.remoteBot && r.alive && hyp(p[0] - r.pos.x, p[1] - r.pos.z) < SURV.minD) return false;
      return true;
    });
    if (all.length) pool = all; // loin de tous ; à défaut, loin du seul joueur de ce poste
  }
  const list = pool.length ? pool : base; // joueurs partout : n'importe lequel
  const p = list[(Math.random() * list.length) | 0];
  const id = navNode(p[0], gy0(p[0], p[1]), p[1]); // le sol du point, comme les points de domination (domInit)
  SURV.x = p[0]; SURV.z = p[1]; SURV.y = id >= 0 ? NAV.ny[id] : gy0(p[0], p[1]);
  survBuild();
  hudMsg(_t('Extraction ouverte'), 'xp', 3);
  sfxAnnounce('cap', 'st_capture'); // l'annonce de prise d'un point existe déjà : elle dit « rendez-vous »
}
/* Balise d'extraction : un disque au sol et un voile, en jaune accent, plus haut que ceux de la
   domination (il se voit de loin) ; textures propres à la Survie (domClear libère les siennes sans condition) */
function survTextures() {
  if (SURV.tex) return SURV.tex;
  const ring = canvasTex(256, (g, S) => {
    const r = S / 2, gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.04)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.12)'); gr.addColorStop(0.9, 'rgba(255,255,255,0.3)');
    gr.addColorStop(0.945, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.985, 'rgba(255,255,255,0.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  }, false);
  const veil = canvasTex(64, (g, S) => {
    const gr = g.createLinearGradient(0, 0, 0, S);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0.7)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  }, false);
  return (SURV.tex = { ring, veil });
}
function survBuild() {
  const T = survTextures(), g = new THREE.Group(); g.position.set(SURV.x, SURV.y, SURV.z);
  const add = (geo, mat, y, order) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.userData.noAO = true; m.renderOrder = order; m.frustumCulled = false; g.add(m); return m; };
  SURV.ringMat = new THREE.MeshBasicMaterial({ map: T.ring, color: 0xf6c445, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
  SURV.ringMat.polygonOffset = true; SURV.ringMat.polygonOffsetFactor = -2; // comme la domination : le disque ne se bat pas avec le sol (domBuild)
  SURV.ringMat.opacity = 0.9;
  const disc = add(new THREE.CircleGeometry(SURV.rad, 64), SURV.ringMat, 0.05, 4); disc.rotation.x = -Math.PI / 2;
  SURV.veilMat = new THREE.MeshBasicMaterial({ map: T.veil, color: 0xf6c445, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true }); SURV.veilMat.opacity = 0.5;
  add(new THREE.CylinderGeometry(SURV.rad, SURV.rad, 3, 64, 1, true), SURV.veilMat, 1.5, 5);
  SURV.obj = g; mapAdd(g); // la carte le possède : mapUnload le libère avec elle (02-map.js)
}
/* Pulsation, chaque image, sans allocation (domHud fait de même pour la domination) */
function survMarkerTick(dt) {
  const k = 0.65 + 0.35 * Math.sin(MATCH.time * 6);
  SURV.ringMat.opacity = 0.55 + 0.35 * k; SURV.veilMat.opacity = 0.3 + 0.25 * k;
}
/* Tenue du point : le compte à rebours prend l'habillage du départ de partie (« Extraction dans »),
   le même gros chiffre et les mêmes sons que « La partie commence dans » (cdShow/cdSound, 09y-decompte.js) */
function survHoldShow(n, first) {
  const el = $('cd');
  const num = $('cdNum'); num.textContent = num.dataset.n = String(n);
  $('cdDial').className = 'cd-dial ' + (n % 2 ? 'a' : 'b');
  $('cdKick').textContent = _t('Extraction dans');
  el.className = 'cd show' + (n <= CD_HOT ? ' last' : '') + (first ? ' in' : '');
  cdSound(n); // un tic par seconde, le bip de liaison sur les trois dernières
}
/* Point d'extraction sur la mini-carte : un disque jaune qui clignote (2 Hz), et le cercle de sa zone */
function survMinimap(g, scale) {
  if (((MATCH.time * 2) | 0) % 2) return; // éteint une image sur deux : le clignotement
  g.fillStyle = 'rgba(246,196,69,0.95)'; g.strokeStyle = 'rgba(246,196,69,0.55)'; g.lineWidth = 2;
  g.beginPath(); g.arc(SURV.x * scale, SURV.z * scale, SURV.rad * scale, 0, TAU); g.stroke();
  g.beginPath(); g.arc(SURV.x * scale, SURV.z * scale, 4.5, 0, TAU); g.fill();
}
/* La file des cartes, battue au départ de la partie (survStart) : chaque passage prend la suivante ;
   vide, elle se rebat. Jamais deux fois la même d'affilée quand c'est évitable (le battage de botKs) */
function survNextMap() {
  if (!SURV.queue || !SURV.queue.length) SURV.queue = MAPS.filter((m) => m.ok && m.id !== MAPL.id).map((m) => m.id).sort(() => Math.random() - 0.5); // rebattue sans la carte en cours : celle d'où l'on vient attend le cycle suivant
  let id = SURV.queue.shift();
  if (id === MAPL.id && SURV.queue.length) { SURV.queue.push(id); id = SURV.queue.shift(); }
  return id;
}
/* État de survie tenu par l'hôte, joint à son envoi de présence (domNetState fait de même pour la domination) */
function survNetState() {
  return { ph: SURV.phase === 'extraction' ? 1 : 0, r: SURV.round, t: Math.round(SURV.t * 10) / 10,
    x: Math.round(SURV.x * 10) / 10, y: Math.round(SURV.y * 10) / 10, z: Math.round(SURV.z * 10) / 10, h: Math.round(SURV.hold * 10) / 10 };
}
/* Invité : l'état reçu remplace le sien (jamais calculé ici) ; le balisage suit la phase, le bandeau la manche */
function survNetApply(m) {
  if (!m || typeof m !== 'object' || MATCH.mode !== 'survival' || NET.role === 'host') return;
  const ex = m.ph === 1;
  SURV.phase = ex ? 'extraction' : 'combat';
  SURV.round = clamp(numOr(m.r, 1), 1, 99);
  SURV.t = clamp(numOr(m.t, 0), -3600, 3600);
  SURV.x = numOr(m.x); SURV.y = numOr(m.y); SURV.z = numOr(m.z);
  SURV.hold = clamp(numOr(m.h, 0), 0, SURV.holdMax);
  if (ex && MAPL.root && (!SURV.obj || SURV.obj.position.x !== SURV.x || SURV.obj.position.z !== SURV.z)) survBuild(); // idempotent : reconstruit seulement si le point a bougé (carte en cours de chargement : au prochain envoi)
  if (!ex && SURV.obj) survClear(); // l'état revient au combat : le balisage disparaît
  if (SURV.round !== SURV.stripR) { SURV.stripR = SURV.round; hudText(HUDE.scLim, _t('Manche {0} · {1} ennemis', SURV.round, survBotCap(SURV.round))); } // un invité rejoint à la manche 3 voit la bonne manche
}
/* Dix secondes tenues : passage vers la carte suivante. La partie se fige le temps du chargement
   (frame ne traite aucun état de jeu en 'loading'), l'écran de chargement la couvre (menuLoading,
   sans l'écran de déploiement : la classe en cours repart telle quelle), et la manche suivante
   démarre avec les éliminations et le temps du joueur (SURV.carry, relu par survStart).
   En ligne, l'hôte seul décide du passage : il l'ordonne aux invités ('smap', survNetMap), et la
   carte en cours entre dans les réglages du salon (un retardataire charge la bonne, message 'start'). */
async function survExtract() {
  if (MATCH.state !== 'playing' || MATCH.fin || MATCH.finalPending || UI.busy) return; // la mort a décidé : pas de passage
  if (MATCH.online && NET.role !== 'host') return; // l'hôte seul tient l'état et le passage
  const round = SURV.round + 1, kills = PL.ent.kills, tl = MATCH.timeLeft;
  if (MATCH.online) {
    NET.cfg = netCfg(Object.assign({}, NET.cfg, { map: survNextMap() }));
    netBroadcast({ t: 'smap', map: NET.cfg.map, round, tl: Math.round(tl * 100) / 100 }, true);
    survTransition(NET.cfg.map, { round, kills, timeLeft: tl });
    return;
  }
  survTransition(survNextMap(), { round, kills, timeLeft: tl });
}
/* Le passage lui-même, le même chez l'hôte et chez l'invité (survNetMap) : la manche et le temps
   viennent de l'hôte, les éliminations sont celles du joueur de ce poste. En ligne, startMatch doit
   rester en ligne (sans 'online', il quitterait le salon) et les distants de la carte d'avant sont
   retirés, comme au lancement (netStartOnlineNow, 09c-net.js) */
async function survTransition(mapId, carry) {
  UI.busy = true; MATCH.state = 'loading'; // fige le jeu pendant le chargement (frame, 09-game.js)
  if ($('pause').classList.contains('show')) $('pause').classList.remove('show'); // un invité en pause passe aussi : l'écran de chargement prend le relais
  survClear();
  SURV.carry = carry;
  Settings.map = mapId; saveSettings(); // le menu Solo et « Rejouer » suivent la carte de la manche en cours
  const F = { online: false, map: mapId, deploy: () => {
    if (MATCH.online) {
      for (const e of NET.remotes.values()) netRemoveRemote(e);
      NET.remotes.clear(); NET.seen.clear(); NET.seenT.clear(); NET.ak.clear(); NET.sent.length = 0; NET.held.length = 0;
      NET.shots = 0; NET.lastPub = 0; PL.ent.netQ = { seq: 0, list: [] }; NET.goneK = [0, 0];
    }
    startMatch(MATCH.online ? { online: true } : undefined);
    if (MATCH.online && NET.role === 'host') netRebalanceBots(); // comme au lancement (netStartOnlineNow) : sans lui, la manche suivante démarre sans aucun bot
  } };
  UI.flow = F; // menuLoading s'y réfère pour la progression et l'annulation
  let ok = false;
  try { ok = await menuLoading(F); } catch (e) { ok = false; }
  if (ok && UI.flow === F) F.deploy(); // startMatch : manche suivante, SURV.carry relu par modeStart puis survStart
  $('matchload').classList.add('hidden');
  UI.flow = null; UI.busy = false;
  if (!ok) toMenu(MATCH.online ? undefined : 'solo'); // la carte d'avant est déjà libérée : on rend la main aux menus (la manche est perdue)
}
/* Invité : l'hôte a ordonné le passage (l'état suit chaque envoi de présence, l'ordre part maintenant) */
function survNetMap(m) {
  if (MATCH.mode !== 'survival' || NET.role === 'host' || UI.busy || !NET.on || (MATCH.state !== 'playing' && MATCH.state !== 'paused')) return;
  survTransition(mapById(m.map).id, { round: clamp(numOr(m.round, 2), 2, 99), kills: PL.ent.kills, timeLeft: numOr(m.tl, MATCH.timeLeft) });
}
/* Fin de partie, retour aux menus, ou passage vers la carte suivante : le balisage disparaît (le schéma de domClear) */
function survClear() {
  if (SURV.obj && SURV.obj.parent) SURV.obj.parent.remove(SURV.obj);
  if (SURV.obj) SURV.obj.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  if (SURV.tex) { SURV.tex.ring.dispose(); SURV.tex.veil.dispose(); }
  SURV.obj = null; SURV.tex = null; SURV.phase = 'combat'; SURV.hold = 0; SURV.shown = 0;
  const bar = $('domCap'); if (bar && bar.className) bar.className = '';
  $('cd').className = 'cd'; // le compte à rebours de tenue, s'il était à l'écran
}

/* ==========================================================================
   TEMPÊTE : LA ZONE QUI SE REFERME
   Solo seulement (les bots font tous le camp adverse, comme en Survie). La zone ronde de la carte
   (RING, 02-relief.js), celle qui tue hors du cercle, se referme par étapes : toutes les STORM.tStage
   secondes, le rayon diminue (et la grâce avec lui) ; hors de la zone, la mort est la règle commune
   (ringCheck → zoneDeath, la cause « Désert », créditée au dernier tireur). Aucune réapparition :
   le tableau se vide tout seul. La partie s'arrête à la mort du joueur (killEnt) ou quand le dernier
   bot hostile tombe (stormUpdate). Sur une carte sans anneau (toutes sauf Simoun), un anneau est
   synthétisé au centre de la carte, assez large pour contenir les deux bases.
   ========================================================================== */
const STORM = { r0: 0, rMin: 0, stage: 1, stages: 6, tStage: 45, t: 45, dropMax: 0, loot: [], started: false };
const STORM_LOOT = ['ak47', 'mp5', 'm1014', 'l96', 'scarh', 'ump45']; // armes semées au départ, une famille pour chaque (l'ordre impose la variété)
const STORM_LOOT_N = 6;
const _stV = new V3(), _stQ = new THREE.Quaternion(), _stV2 = new V3();
/* L'anneau de la carte, remis à neuf : celui de la définition (reliefBuild l'a posé une fois, à la construction), ou aucun. Appelé à chaque
   partie : une carte reste chargée entre deux parties (MAPL_KEEP), sans quoi une Tempête suivie d'un Rejouer laisserait l'anneau rétréci. */
function ringReset() {
  const R = CURMAP.def && CURMAP.def.ring;
  RING.on = !!R;
  RING.x = R ? numOr(R.x, 0) : 0; RING.z = R ? numOr(R.z, 0) : 0;
  RING.r = R ? numOr(R.r, 1e9) : 1e9; RING.hard = R ? numOr(R.hard, RING.r + 10) : 1e9; RING.t = R ? numOr(R.t, 10) : 10;
}
/* Rayon et grâce d'une étape : l'étape 1 est l'anneau plein, la dernière (stages) le plus serré. Le rétrécissement accélère un peu vers la fin. */
const stormRadius = () => lerp(STORM.r0, STORM.rMin, Math.pow((STORM.stage - 1) / (STORM.stages - 1), 1.15));
const stormGrace = () => lerp(10, 4, (STORM.stage - 1) / (STORM.stages - 1)); // la zone est de plus en plus mortelle
/* Pose le rayon courant sur la zone ronde, en gardant hard devant r : on peut sortir (voile et compte à rebours) mais pas fuir. */
function stormApply() { RING.r = stormRadius(); RING.hard = RING.r + 10; RING.t = stormGrace(); }
/* Début de Tempête (modeStart, la carte est chargée) : centre et rayon de départ, rayon minimal, anneau forcé, butin semé. */
function stormInit() {
  const R = CURMAP.def && CURMAP.def.ring;
  let x, z, r0;
  if (R && R.r) { x = numOr(R.x, 0); z = numOr(R.z, 0); r0 = R.r; } // carte à anneau (Simoun) : on part du sien
  else { // carte sans anneau : au centre du rectangle, assez large pour les deux bases
    x = (MAP.x0 + MAP.x1) / 2; z = (MAP.z0 + MAP.z1) / 2;
    r0 = Math.max(MAP.x1 - MAP.x0, MAP.z1 - MAP.z0) * 0.5 + 6;
    for (const t of [0, 1]) for (const s of SPAWNS[t]) r0 = Math.max(r0, hyp(s[0] - x, s[1] - z) + 5); // les bases entières tiennent au départ
  }
  STORM.r0 = r0; STORM.rMin = Math.max(9, r0 * 0.18);
  STORM.stage = 1; STORM.stages = 6; STORM.tStage = 45; STORM.t = STORM.tStage; STORM.started = true;
  RING.on = true; RING.x = x; RING.z = z; stormApply();
  if (!STORM.dropMax) STORM.dropMax = DROP.max; // la durée de vie des armes semées passe par d.life, mais il faut aussi de la place (DROP.max)
  DROP.max = Math.max(DROP.max, STORM_LOOT_N + 16); // assez de place pour le butin et les armes des morts
  STORM.loot.length = 0; // une partie précédente sur la même carte (Rejouer) : ses armes ont déjà été retirées par clearDrops
  stormLoot();
}
/* Sème des armes à des points praticables, dans la zone de départ et assez espacés : le joueur les ramasse en marchant dessus (08c-pickups.js),
   exactement comme les armes des soldats tombés. Les bots, eux, ne ramassent pas (limite assumée de la v1). */
function stormLoot() {
  const base = SPAWNS[0].concat(SPAWNS[1], spawnField()), cand = [];
  for (const p of base) if (hyp(p[0] - RING.x, p[1] - RING.z) <= STORM.r0 - 8) cand.push(p);
  for (let i = cand.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0, t = cand[i]; cand[i] = cand[j]; cand[j] = t; } // mélange
  const pick = [];
  for (const p of cand) {
    if (pick.length >= STORM_LOOT_N) break;
    let ok = true;
    for (const q of pick) if (hyp(p[0] - q[0], p[1] - q[1]) < 18) { ok = false; break; }
    if (ok) pick.push(p);
  }
  for (let i = 0; i < pick.length; i++) {
    const p = pick[i], def = WEAPONS[STORM_LOOT[i % STORM_LOOT.length]];
    if (!def) continue;
    _stV.set(p[0], gy0(p[0], p[1]) + 1.4, p[1]); _stQ.setFromAxisAngle(UP, rand(0, TAU)); _stV2.set(rand(-0.4, 0.4), 0.4, rand(-0.4, 0.4));
    const d = dropWeapon(def, def.mag, Math.round(def.reserve * 0.5), _stV, _stQ, _stV2);
    if (d) { d.life = 1e9; STORM.loot.push(d); } // elles restent toute la partie (stepDrop lit la durée propre à un objet, 08c-pickups.js)
  }
}
/* Nombre de bots hostiles en vie (le joueur est seul, tous les autres sont ennemis). */
function stormLive() { let n = 0; for (const e of entities) if (!e.isPlayer && e.alive && !e.off && !allied(e, PL.ent)) n++; return n; }
function stormStrip() { hudText($('scLim'), _t('Tempête {0}/{1}', STORM.stage, STORM.stages)); }
/* Chaque image de Tempête (modeUpdate) : victoire si plus aucun bot hostile, sinon l'horloge des étapes. Comme la Survie, le temps
   n'avance qu'en jeu (derrière le menu de pause, il attend) ; en ligne, le mode n'existe pas (solo seulement). */
function stormUpdate(dt) {
  if (MATCH.state !== 'playing') return;
  if (!stormLive()) { matchFinishSoon(); return; } // le dernier bot tombe : le joueur est vivant, la victoire se calcule seule (09l-fin.js)
  STORM.t -= dt;
  if (STORM.t > 0 || STORM.stage >= STORM.stages) return;
  STORM.stage++; STORM.t = STORM.tStage;
  stormApply();
  hudMsg(_t('La tempête se referme ({0}/{1})', STORM.stage, STORM.stages), 'enemy', 2.5);
  sfxAnnounce('ecap', 'st_lost'); // l'annonce d'une zone reprise : le même signal grave
  stormStrip(); // le bandeau n'est réécrit qu'à l'étape (jamais à chaque image)
}
/* Fin de partie ou retour aux menus : le butin semé disparaît, l'anneau de la carte reprend sa place (la ceinture du modeStart de la partie suivante). */
function stormClear() {
  for (const d of STORM.loot) if (DROP.list.indexOf(d) >= 0) removeDrop(d);
  STORM.loot.length = 0; STORM.started = false; STORM.stage = 1; STORM.t = 0;
  if (STORM.dropMax) { DROP.max = STORM.dropMax; STORM.dropMax = 0; }
  ringReset();
}
