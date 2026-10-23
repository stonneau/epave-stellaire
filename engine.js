"use strict";
// ============================================================================
// Moteur de règles — clone fan de Space Hulk (3e/4e édition), Mission I.
// Pur JS, sans DOM : utilisable dans le navigateur et dans Node (tests).
// L'hôte (ou le jeu local) est seul à muter l'état ; tout passe par
// applyAction(state, kind, payload, side).
// ============================================================================

const FACINGS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N E S W
const FACING_NAMES = ["N", "E", "S", "O"];

// ------------------------------------------------------------------ carte --
// Coordonnées : x = colonne, y = ligne (0 en haut). Reconstitution de la
// carte de la Mission I à partir du livret (proportions approximatives).
const MISSION_1 = {
  id: "m1",
  title: "Mission I — Mission suicide",
  brief:
    "Détruire les commandes de lancement : tirer au lance-flammes sur n'importe quelle case de la salle A. " +
    "Les Xénos gagnent s'ils tuent le porteur du lance-flammes ou s'il tombe à court de munitions avant.",
  width: 29,
  height: 23,
  // [x0, y0, x1, y1, section]  (inclusifs)
  floors: [
    [1, 11, 6, 11, "S0"],
    [7, 10, 9, 12, "R1"],
    [10, 11, 13, 11, "C1"],
    [14, 8, 15, 11, "B"],
    [16, 11, 19, 11, "C2"],
    [20, 10, 22, 12, "J"],
    [21, 9, 21, 9, "J"],
    [23, 11, 26, 11, "C3"],
    [27, 7, 27, 12, "E"],
    [16, 8, 20, 8, "U1"],
    [21, 8, 26, 8, "U2"],
    [21, 3, 21, 7, "V2"],
    [20, 0, 22, 2, "A"],
    [21, 13, 21, 17, "V3"],
    [20, 18, 22, 19, "BOT"],
    [8, 13, 8, 18, "V4"],
    [7, 19, 9, 21, "R2"],
    [10, 20, 10, 20, "P"],
    [11, 19, 11, 21, "P"],
  ],
  rooms: ["R1", "A", "R2", "J", "B", "BOT"],
  doors: [[6, 11], [10, 11], [8, 13], [8, 18], [10, 20], [16, 8], [21, 3]],
  // off = case hors plateau (où attendent les blips), at = case d'entrée
  entries: [
    { id: "e1", name: "Nord-Est", off: [27, 6], at: [27, 7] },
    { id: "e2", name: "Est", off: [27, 13], at: [27, 12] },
    { id: "e3", name: "Sud-O", off: [19, 19], at: [20, 19] },
    { id: "e4", name: "Sud-E", off: [23, 19], at: [22, 19] },
    { id: "e5", name: "Ouest-N", off: [11, 18], at: [11, 19] },
    { id: "e6", name: "Ouest-S", off: [11, 22], at: [11, 21] },
  ],
  smArea: [0, 11],
  startSquares: [[5, 11], [4, 11], [3, 11], [2, 11], [1, 11]], // de l'avant vers l'arrière
  startFacing: 1,
  targetSection: "A",
  startBlips: 2,
  reinforcements: 2,
  squad: [
    { kind: "bolter", name: "Frère Deino", ranged: "bolter", melee: "fist" },
    { kind: "sergeant", name: "Sergent Lorenzo", ranged: "bolter", melee: "sword" },
    { kind: "flamer", name: "Frère Zael", ranged: "flamer", melee: "fist" },
    { kind: "bolter", name: "Frère Goriel", ranged: "bolter", melee: "fist" },
    { kind: "bolter", name: "Frère Noctis", ranged: "bolter", melee: "fist" },
  ],
};

const BLIP_MIX = { 1: 9, 2: 4, 3: 9 }; // colonne « 3rd Edition » des pions blip
const MAX_GS = 22;
const MAX_WAITING = 3; // blips en attente par zone d'entrée

function key(x, y) {
  return x + "," + y;
}

function buildMap(m) {
  const cells = {};
  const sections = {};
  for (const [x0, y0, x1, y1, s] of m.floors) {
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        cells[key(x, y)] = { x, y, section: s, door: false, room: m.rooms.includes(s) };
        (sections[s] = sections[s] || []).push(key(x, y));
      }
  }
  for (const [x, y] of m.doors) cells[key(x, y)].door = true;
  return { cells, sections, mission: m };
}

const MAP = buildMap(MISSION_1);

// ---------------------------------------------------------------- hasard --
// Compteur d'événements aléatoires ou révélant une information cachée :
// on ne peut pas annuler au-delà (sinon on pourrait relancer un dé ou « jeter un œil »).
let BARRIER = 0;
function d6() {
  BARRIER++;
  return 1 + Math.floor(Math.random() * 6);
}
function rollN(n) {
  const r = [];
  for (let i = 0; i < n; i++) r.push(d6());
  return r;
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// -------------------------------------------------------------- création --
function newGame(opts = {}) {
  const m = MAP.mission;
  const stack = [];
  for (const v in BLIP_MIX) for (let i = 0; i < BLIP_MIX[v]; i++) stack.push(+v);
  const s = {
    gameId: Math.random().toString(36).slice(2, 9),
    mission: m.id,
    phase: "setup", // setup | deploy | sm | gs | end
    turn: 0,
    sub: null,
    queue: [],
    units: {},
    nextId: 1,
    doors: {},
    flames: [],
    cp: { value: null, spent: 0, redrawn: false, pool: [1, 2, 3, 4, 5, 6] },
    blipStack: shuffle(stack),
    blipUsed: [],
    flamerAmmo: 6,
    active: { SM: null, GS: null },
    lastActor: null,
    reinforce: null,
    forced: [],
    skipReacts: false,
    timer: { seconds: opts.timerSeconds == null ? 180 : opts.timerSeconds, endsAt: null, remaining: null },
    log: [],
    roll: null,
    winner: null,
    reason: "",
    names: opts.names || { SM: "Escouade", GS: "Xénos" },
  };
  for (const [x, y] of m.doors) s.doors[key(x, y)] = "closed";
  m.squad.forEach((d, i) => {
    const [x, y] = m.startSquares[i];
    const id = "m" + s.nextId++;
    s.units[id] = {
      id, side: "SM", kind: d.kind, name: d.name, ranged: d.ranged, melee: d.melee,
      x, y, f: m.startFacing, off: null,
      ap: 4, act: "none", ow: false, guard: false, jam: false, sus: null, free: false,
    };
  });
  log(s, "Placez l'escouade : cliquez deux Terminators pour les échanger, puis lancez la mission.");
  return s;
}

function log(s, text, side) {
  s.log.push({ text, side: side || null, turn: s.turn });
  if (s.log.length > 200) s.log.shift();
}

// ------------------------------------------------------------- requêtes --
function unitAt(s, x, y) {
  for (const id in s.units) {
    const u = s.units[id];
    if (!u.off && u.x === x && u.y === y) return u;
  }
  return null;
}
function cell(x, y) {
  return MAP.cells[key(x, y)];
}
function isFlamed(s, x, y) {
  const c = cell(x, y);
  return !!c && s.flames.includes(c.section);
}
function doorState(s, x, y) {
  return s.doors[key(x, y)] || null;
}
function wallOrClosed(s, x, y) {
  const c = cell(x, y);
  if (!c) return true;
  return c.door && s.doors[key(x, y)] === "closed";
}
function blocksLOS(s, x, y, ignoreId) {
  if (wallOrClosed(s, x, y)) return true;
  if (isFlamed(s, x, y)) return true;
  const u = unitAt(s, x, y);
  return !!u && u.id !== ignoreId;
}
function cheb(ax, ay, bx, by) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

// Ligne de vue centre à centre (parcours de grille, coins gérés).
function lineClear(s, x0, y0, x1, y1, ignoreId) {
  const dx = x1 - x0, dy = y1 - y0;
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const adx = Math.abs(dx), ady = Math.abs(dy);
  let x = x0, y = y0, ix = 0, iy = 0;
  const blk = (a, b) => !(a === x1 && b === y1) && blocksLOS(s, a, b, ignoreId);
  while (ix < adx || iy < ady) {
    const tx = adx ? (ix + 0.5) / adx : Infinity;
    const ty = ady ? (iy + 0.5) / ady : Infinity;
    if (Math.abs(tx - ty) < 1e-9) {
      if (blk(x + sx, y) && blk(x, y + sy)) return false;
      x += sx; y += sy; ix++; iy++;
    } else if (tx < ty) {
      x += sx; ix++;
    } else {
      y += sy; iy++;
    }
    if (x === x1 && y === y1) return true;
    if (blk(x, y)) return false;
  }
  return true;
}

function inArc(u, x, y) {
  const [fx, fy] = FACINGS[u.f];
  const dx = x - u.x, dy = y - u.y;
  const fwd = dx * fx + dy * fy;
  const lat = Math.abs(dx * fy - dy * fx);
  return fwd > 0 && lat <= fwd;
}

// Un Terminator voit-il la case (x,y) ? ignoreId : unité à ne pas compter comme obstacle.
function marineSees(s, m, x, y, ignoreId) {
  if (m.off || m.side !== "SM") return false;
  if (!inArc(m, x, y)) return false;
  return lineClear(s, m.x, m.y, x, y, ignoreId);
}
function marines(s) {
  return Object.values(s.units).filter((u) => u.side === "SM");
}
function anyMarineSees(s, x, y, ignoreId) {
  return marines(s).some((m) => marineSees(s, m, x, y, ignoreId));
}
function adjacentToMarine(s, x, y) {
  return marines(s).some((m) => cheb(m.x, m.y, x, y) === 1);
}

function controller(s) {
  if (s.winner) return null;
  if (s.sub) return s.sub.type === "place" ? s.sub.chooser : "SM";
  if (s.phase === "setup") return "SM";
  if (s.phase === "deploy") return "GS";
  if (s.phase === "sm") return "SM";
  if (s.phase === "gs") return "GS";
  return null;
}

function cpLeft(s) {
  return s.cp.value == null ? 0 : s.cp.value - s.cp.spent;
}

// Paiement : renvoie {ap, cp} ou null si impossible.
function payPlan(s, u, cost) {
  if (u.side === "SM") {
    const react = s.sub && s.sub.type === "react";
    if (react || s.phase !== "sm" || u.act === "done") return cpLeft(s) >= cost ? { ap: 0, cp: cost } : null;
    const ap = Math.min(u.act === "none" || u.act === "active" ? u.ap : 0, cost);
    const cp = cost - ap;
    return cpLeft(s) >= cp ? { ap, cp } : null;
  }
  if (s.phase !== "gs" || s.sub) return null;
  if (u.act === "done") return null;
  return u.ap >= cost ? { ap: cost, cp: 0 } : null;
}
function pay(s, u, cost) {
  const p = payPlan(s, u, cost);
  const react = s.sub && s.sub.type === "react";
  if (u.side === "GS") activate(s, u);
  else if (!react && s.phase === "sm" && u.act !== "done") activate(s, u);
  u.ap -= p.ap;
  s.cp.spent += p.cp;
}
function activate(s, u) {
  if (u.act !== "none") return;
  const prevId = s.active[u.side];
  const prev = prevId && s.units[prevId];
  if (prev && prev.act === "active") prev.act = "done";
  u.act = "active";
  s.active[u.side] = u.id;
}

// Classe le déplacement relativement à l'orientation.
function moveKind(u, x, y) {
  const dx = x - u.x, dy = y - u.y;
  if (cheb(u.x, u.y, x, y) !== 1) return null;
  if (u.kind === "blip") return "any";
  const [fx, fy] = FACINGS[u.f];
  const fwd = dx * fx + dy * fy;
  if (fwd > 0) return "fwd";
  if (fwd < 0) return "back";
  return "side";
}
function moveCost(u, x, y) {
  const k = moveKind(u, x, y);
  if (!k) return null;
  if (k === "any" || k === "fwd") return 1;
  if (k === "back") return 2;
  return u.side === "SM" ? null : 1; // pas de pas de côté pour les Terminators
}

function canEnterSquare(s, u, x, y) {
  const c = cell(x, y);
  if (!c) return false;
  if (wallOrClosed(s, x, y)) return false;
  if (unitAt(s, x, y)) return false;
  if (isFlamed(s, x, y)) {
    // On peut se déplacer à l'intérieur d'une section en flammes si on y est déjà.
    const here = cell(u.x, u.y);
    if (u.off || !here || here.section !== c.section) return false;
  }
  if (u.kind === "blip") {
    if (anyMarineSees(s, x, y, u.id)) return false;
    if (adjacentToMarine(s, x, y)) return false;
  }
  return true;
}
function diagonalOk(s, u, x, y) {
  const dx = x - u.x, dy = y - u.y;
  if (!dx || !dy) return true;
  const a = wallOrClosed(s, u.x + dx, u.y) || !!unitAt(s, u.x + dx, u.y);
  const b = wallOrClosed(s, u.x, u.y + dy) || !!unitAt(s, u.x, u.y + dy);
  return !(a && b);
}

// --------------------------------------------------------- listes légales --
function legalMoves(s, u) {
  const out = [];
  if (!u || u.off) return out;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const x = u.x + dx, y = u.y + dy;
      const cost = moveCost(u, x, y);
      if (cost == null) continue;
      if (!canEnterSquare(s, u, x, y) || !diagonalOk(s, u, x, y)) continue;
      if (!payPlan(s, u, cost)) continue;
      out.push({ x, y, cost });
    }
  return out;
}
function frontSquare(u) {
  const [fx, fy] = FACINGS[u.f];
  return [u.x + fx, u.y + fy];
}
function doorsInReach(s, u) {
  // Blip : portes orthogonalement adjacentes. Modèle : 3 cases de devant.
  const out = [];
  const cand = [];
  if (u.kind === "blip") {
    for (const [fx, fy] of FACINGS) cand.push([u.x + fx, u.y + fy]);
  } else {
    const [fx, fy] = FACINGS[u.f];
    cand.push([u.x + fx, u.y + fy], [u.x + fx + fy, u.y + fy + fx], [u.x + fx - fy, u.y + fy - fx]);
  }
  for (const [x, y] of cand) {
    const st = doorState(s, x, y);
    if (st === "closed" || (st === "open" && !unitAt(s, x, y) && !isFlamed(s, x, y))) out.push({ x, y, st });
  }
  return out;
}
function shootTargets(s, u) {
  const out = [];
  if (u.side !== "SM" || u.ranged !== "bolter" || u.jam) return out;
  for (const id in s.units) {
    const t = s.units[id];
    if (t.side === "GS" && t.kind === "gs" && !t.off && marineSees(s, u, t.x, t.y)) out.push({ x: t.x, y: t.y, id });
  }
  for (const k in s.doors)
    if (s.doors[k] === "closed") {
      const [x, y] = k.split(",").map(Number);
      if (marineSees(s, u, x, y)) out.push({ x, y, door: k });
    }
  return out;
}
function flameTargets(s, u) {
  const out = [];
  if (u.side !== "SM" || u.ranged !== "flamer" || s.flamerAmmo <= 0) return out;
  for (const k in MAP.cells) {
    const c = MAP.cells[k];
    if (c.door && s.doors[k] === "closed") continue;
    if (cheb(u.x, u.y, c.x, c.y) > 12) continue;
    if (c.x === u.x && c.y === u.y) continue;
    if (marineSees(s, u, c.x, c.y)) out.push({ x: c.x, y: c.y });
  }
  return out;
}

// ------------------------------------------------------------ dispatcher --
function applyAction(s, kind, p, side) {
  p = p || {};
  if (s.winner) return "Partie terminée.";
  const ctl = controller(s);
  if (side && side !== "BOTH" && side !== ctl) return "Ce n'est pas à vous de jouer.";
  if (kind === "undo") return undo(s, ctl);
  const fn = ACTIONS[kind];
  if (!fn) return "Action inconnue.";
  const stack = s.undo || [];
  s.undo = [];
  const snap = JSON.stringify(s);
  const before = { barrier: BARRIER, turn: s.turn, phase: s.phase };
  const err = fn(s, p);
  if (err) {
    s.undo = stack;
    return err;
  }
  postAction(s);
  // Annulation libre dans le tour, sauf au-delà d'un jet de dé, d'une révélation ou d'un changement de tour.
  if (kind === "timeout" || BARRIER !== before.barrier || s.turn !== before.turn || s.phase !== before.phase || s.winner) s.undo = [];
  else s.undo = stack.concat([{ side: ctl, snap }]);
  return null;
}

function undo(s, ctl) {
  const stack = s.undo || [];
  const top = stack[stack.length - 1];
  if (!top) return "Rien à annuler (on ne peut pas revenir avant un jet de dé, une révélation ou le début du tour).";
  if (top.side !== ctl) return "La dernière action n'est pas la vôtre.";
  const timer = s.timer;
  const prev = JSON.parse(top.snap);
  for (const k of Object.keys(s)) delete s[k];
  Object.assign(s, prev);
  s.timer = timer;
  s.undo = stack.slice(0, -1);
  return null;
}

function undoSide(s) {
  const st = s.undo || [];
  return st.length ? st[st.length - 1].side : null;
}

function getUnit(s, id) {
  const u = s.units[id];
  if (!u) throw new Error("unité inconnue");
  return u;
}
function ensureMine(s, u) {
  const ctl = controller(s);
  if (ctl !== u.side) return "Cette unité n'est pas à vous.";
  if (s.sub && s.sub.type === "place") return "Placez d'abord les Xénos révélés.";
  return null;
}

// Effets de bord après n'importe quel acte : révélations, file d'attente, victoire.
function postAction(s) {
  checkReveals(s);
  checkWin(s);
  processQueue(s);
  checkWin(s);
}

function noteActor(s, u) {
  if (s.lastActor !== u.id) {
    for (const m of marines(s)) if (m.id !== u.id) m.sus = null;
  }
  s.lastActor = u.id;
}

const ACTIONS = {
  // ----- préparation
  swap(s, p) {
    if (s.phase !== "setup") return "Trop tard.";
    const a = getUnit(s, p.a), b = getUnit(s, p.b);
    [a.x, b.x] = [b.x, a.x];
    [a.y, b.y] = [b.y, a.y];
    return null;
  },
  start(s, p) {
    if (s.phase !== "setup") return "Déjà commencé.";
    s.phase = "deploy";
    s.reinforce = { count: MAP.mission.startBlips, placed: 0 };
    s.forced = [];
    log(s, `Les Xénos placent ${MAP.mission.startBlips} blips de départ.`, "GS");
    return null;
  },
  // ----- renforts
  placeBlip(s, p) {
    if (!s.reinforce || s.sub) return "Pas de renfort à placer.";
    const e = MAP.mission.entries.find((e) => e.id === p.entry);
    if (!e) return "Entrée inconnue.";
    if (waitingAt(s, e.id).length >= MAX_WAITING) return "Déjà 3 blips en attente ici.";
    const v = drawBlip(s);
    const id = "b" + s.nextId++;
    s.units[id] = { id, side: "GS", kind: "blip", value: v, x: e.off[0], y: e.off[1], f: 0, off: e.id, ap: 6, act: "none", lurk: s.forced.includes(e.id), free: false };
    s.reinforce.placed++;
    log(s, `Blip en attente à l'entrée ${e.name}${s.units[id].lurk ? " (doit attendre ce tour)" : ""}.`, "GS");
    finishReinforce(s);
    return null;
  },
  discardBlip(s) {
    if (!s.reinforce || s.sub) return "Pas de renfort à placer.";
    const free = MAP.mission.entries.some((e) => waitingAt(s, e.id).length < MAX_WAITING);
    if (free) return "Il reste de la place à une entrée.";
    s.reinforce.placed++;
    log(s, "Renfort perdu (toutes les entrées sont pleines).", "GS");
    finishReinforce(s);
    return null;
  },
  // ----- commandement
  redraw(s) {
    if (s.phase !== "sm" || s.sub) return "Pas maintenant.";
    if (s.cp.redrawn) return "Déjà retiré ce tour.";
    if (s.cp.spent > 0) return "Des PC ont déjà été dépensés.";
    if (!marines(s).some((m) => m.kind === "sergeant")) return "Il faut un sergent.";
    s.cp.pool.push(s.cp.value);
    s.cp.value = s.cp.pool.splice(Math.floor(Math.random() * s.cp.pool.length), 1)[0];
    s.cp.redrawn = true;
    BARRIER++;
    log(s, "Le sergent fait retirer les points de commandement.", "SM");
    return null;
  },
  // ----- actions d'unité
  move(s, p) {
    const u = getUnit(s, p.id);
    const e = ensureMine(s, u);
    if (e) return e;
    const lm = legalMoves(s, u).find((m) => m.x === p.x && m.y === p.y);
    if (!lm) return "Déplacement impossible.";
    const wasFlamedSection = isFlamed(s, p.x, p.y);
    pay(s, u, lm.cost);
    noteActor(s, u);
    u.x = p.x; u.y = p.y;
    u.sus = null;
    u.fresh = false;
    u.free = u.side === "SM" ? "shot" : "turn";
    if (u.side === "SM") { u.ow = false; u.guard = false; }
    if (wasFlamedSection) {
      const r = d6();
      s.roll = { text: `${unitLabel(u)} traverse les flammes : ${r}`, dice: [r] };
      if (r >= 2) {
        log(s, `${unitLabel(u)} périt dans les flammes (${r}).`);
        kill(s, u);
        return null;
      }
    }
    afterModelAction(s, u);
    return null;
  },
  enter(s, p) {
    const u = getUnit(s, p.id);
    const e = ensureMine(s, u);
    if (e) return e;
    if (!u.off) return "Déjà sur le plateau.";
    if (u.lurk) return "Doit attendre ce tour (Space Marine à 6 cases ou moins).";
    const en = MAP.mission.entries.find((x) => x.id === u.off);
    const [x, y] = en.at;
    const tmp = { ...u, off: null, x: en.off[0], y: en.off[1] };
    if (!canEnterSquare(s, tmp, x, y)) return "Entrée bloquée.";
    if (!payPlan(s, u, 1)) return "Plus de PA.";
    pay(s, u, 1);
    noteActor(s, u);
    u.off = null; u.x = x; u.y = y;
    const dx = Math.sign(x - en.off[0]), dy = Math.sign(y - en.off[1]);
    u.f = FACINGS.findIndex(([a, b]) => a === dx && b === dy);
    if (u.f < 0) u.f = 0;
    u.free = "turn";
    log(s, `${unitLabel(u)} entre par ${en.name}.`, "GS");
    afterModelAction(s, u);
    return null;
  },
  turn(s, p) {
    const u = getUnit(s, p.id);
    const e = ensureMine(s, u);
    if (e) return e;
    if (u.off || u.kind === "blip") return "Pas d'orientation.";
    const d = p.dir; // 1 = droite, -1 = gauche, 2 = demi-tour
    if (d === 2 && u.side === "SM") return "Les Terminators tournent de 90° à la fois.";
    let cost = 1;
    if (u.side === "GS" && (u.free === "turn" || u.fresh) && d !== 2) cost = 0;
    if (!payPlan(s, u, cost)) return "Pas assez de PA/PC.";
    pay(s, u, cost);
    noteActor(s, u);
    u.f = (u.f + (d === 2 ? 2 : d) + 4) % 4;
    u.sus = null;
    if (u.side === "SM") { u.free = "shot"; u.ow = false; u.guard = false; }
    else u.free = false;
    afterModelAction(s, u);
    return null;
  },
  shoot(s, p) {
    const u = getUnit(s, p.id);
    const e = ensureMine(s, u);
    if (e) return e;
    const t = shootTargets(s, u).find((t) => (p.target && t.id === p.target) || (p.door && t.door === p.door));
    if (!t) return "Cible hors de vue.";
    const free = u.free === "shot";
    const cost = free ? 0 : 1;
    if (!payPlan(s, u, cost)) return "Pas assez de PA/PC.";
    pay(s, u, cost);
    const tid = t.id || t.door;
    const sustained = !free && s.lastActor === u.id && u.sus === tid;
    noteActor(s, u);
    u.free = false; u.ow = false; u.guard = false;
    const need = sustained ? 5 : 6;
    const dice = rollN(2);
    const hit = dice.some((d) => d >= need);
    s.roll = { text: `${unitLabel(u)} tire${sustained ? " (tir soutenu, 5+)" : " (6+)"} : ${dice.join(" ")}`, dice };
    if (hit) {
      if (t.door) {
        s.doors[t.door] = "destroyed";
        log(s, `${unitLabel(u)} détruit une porte (${dice.join(" ")}).`, "SM");
      } else {
        log(s, `${unitLabel(u)} abat un Xéno (${dice.join(" ")}).`, "SM");
        kill(s, s.units[t.id]);
      }
      u.sus = null;
    } else {
      log(s, `${unitLabel(u)} manque (${dice.join(" ")}).`, "SM");
      u.sus = tid;
    }
    return null;
  },
  flame(s, p) {
    const u = getUnit(s, p.id);
    const e = ensureMine(s, u);
    if (e) return e;
    if (!flameTargets(s, u).some((t) => t.x === p.x && t.y === p.y)) return "Case hors de portée ou de vue.";
    if (!payPlan(s, u, 2)) return "Il faut 2 PA/PC.";
    pay(s, u, 2);
    noteActor(s, u);
    u.free = false; u.sus = null; u.ow = false; u.guard = false;
    s.flamerAmmo--;
    const sec = cell(p.x, p.y).section;
    if (!s.flames.includes(sec)) s.flames.push(sec);
    const victims = Object.values(s.units).filter((v) => !v.off && cell(v.x, v.y).section === sec);
    const results = [];
    for (const v of victims) {
      const r = d6();
      results.push(r);
      if (r >= 2) {
        log(s, `Les flammes consument ${unitLabel(v, true)} (${r}).`, "SM");
        kill(s, v);
      } else log(s, `${unitLabel(v, true)} survit aux flammes (${r}).`, "SM");
    }
    s.roll = { text: `Lance-flammes sur la section ${sec}${results.length ? " : " + results.join(" ") : " (vide)"}`, dice: results };
    log(s, `${unitLabel(u)} embrase la section ${sec}. Munitions restantes : ${s.flamerAmmo}.`, "SM");
    if (sec === MAP.mission.targetSection) {
      s.winner = "SM";
      s.reason = "La salle de contrôle des lancements est en flammes : mission accomplie !";
    }
    return null;
  },
  overwatch(s, p) {
    const u = getUnit(s, p.id);
    const e = ensureMine(s, u);
    if (e) return e;
    if (u.ranged !== "bolter") return "Seuls les bolters peuvent passer en overwatch.";
    if (!payPlan(s, u, 2)) return "Il faut 2 PA/PC.";
    pay(s, u, 2);
    noteActor(s, u);
    u.ow = true; u.guard = false; u.free = false; u.sus = null;
    log(s, `${unitLabel(u)} passe en overwatch.`, "SM");
    return null;
  },
  guard(s, p) {
    const u = getUnit(s, p.id);
    const e = ensureMine(s, u);
    if (e) return e;
    if (!payPlan(s, u, 2)) return "Il faut 2 PA/PC.";
    pay(s, u, 2);
    noteActor(s, u);
    u.guard = true; u.ow = false; u.free = false; u.sus = null;
    log(s, `${unitLabel(u)} se met en garde.`, "SM");
    return null;
  },
  unjam(s, p) {
    const u = getUnit(s, p.id);
    const e = ensureMine(s, u);
    if (e) return e;
    if (!u.jam) return "Arme non enrayée.";
    if (!payPlan(s, u, 1)) return "Pas assez de PA/PC.";
    pay(s, u, 1);
    noteActor(s, u);
    u.jam = false; u.free = false;
    log(s, `${unitLabel(u)} désenraye son bolter.`, "SM");
    return null;
  },
  door(s, p) {
    const u = getUnit(s, p.id);
    const e = ensureMine(s, u);
    if (e) return e;
    if (u.off) return "Hors plateau.";
    const d = doorsInReach(s, u).find((d) => d.x === p.x && d.y === p.y);
    if (!d) return "Aucune porte à portée.";
    if (d.st === "closed" && isFlamed(s, d.x, d.y)) return "Porte bloquée par les flammes.";
    if (!payPlan(s, u, 1)) return "Pas assez de PA/PC.";
    pay(s, u, 1);
    noteActor(s, u);
    s.doors[key(d.x, d.y)] = d.st === "closed" ? "open" : "closed";
    u.free = false; u.sus = null;
    if (u.side === "SM") { u.ow = false; u.guard = false; }
    log(s, `${unitLabel(u)} ${d.st === "closed" ? "ouvre" : "ferme"} une porte.`, u.side);
    afterModelAction(s, u);
    return null;
  },
  assault(s, p) {
    const u = getUnit(s, p.id);
    const e = ensureMine(s, u);
    if (e) return e;
    if (u.off || u.kind === "blip") return "Impossible.";
    const [x, y] = frontSquare(u);
    const t = unitAt(s, x, y);
    const door = doorState(s, x, y) === "closed";
    if (!door && !(t && t.side !== u.side && t.kind !== "blip")) return "Rien à attaquer devant.";
    if (!payPlan(s, u, 1)) return "Pas assez de PA/PC.";
    pay(s, u, 1);
    noteActor(s, u);
    u.free = false; u.sus = null;
    if (u.side === "SM") { u.ow = false; }
    if (door) {
      const dice = u.side === "SM" ? [d6()] : rollN(3);
      const ok = dice.includes(6);
      s.roll = { text: `${unitLabel(u)} frappe la porte : ${dice.join(" ")}`, dice };
      if (ok) s.doors[key(x, y)] = "destroyed";
      log(s, `${unitLabel(u)} ${ok ? "défonce" : "frappe en vain"} la porte (${dice.join(" ")}).`, u.side);
      afterModelAction(s, u);
      return null;
    }
    closeAssault(s, u, t);
    if (s.units[u.id]) afterModelAction(s, u);
    return null;
  },
  reveal(s, p) {
    const u = getUnit(s, p.id);
    const e = ensureMine(s, u);
    if (e) return e;
    if (u.kind !== "blip") return "Ce n'est pas un blip.";
    if (u.act !== "none") return "Ce blip a déjà agi.";
    if (s.phase !== "gs") return "Seulement pendant le tour des Xénos.";
    if (u.off) {
      const n = Math.min(u.value, MAX_GS - gsCount(s));
      delete s.units[u.id];
      s.blipUsed.push(u.value);
      for (let i = 0; i < n; i++) {
        const id = "g" + s.nextId++;
        s.units[id] = { id, side: "GS", kind: "gs", x: u.x, y: u.y, f: 0, off: u.off, ap: 6, act: "none", lurk: u.lurk, free: false };
      }
      BARRIER++;
      log(s, `Blip révélé hors plateau : ${n} Xéno${n > 1 ? "s" : ""}.`, "GS");
      return null;
    }
    revealBlip(s, u, "GS", true);
    return null;
  },
  place(s, p) {
    const sub = s.sub;
    if (!sub || sub.type !== "place") return "Rien à placer.";
    const cand = placeCandidates(s, sub);
    if (!cand.some((c) => c.x === p.x && c.y === p.y)) return "Case invalide.";
    const id = "g" + s.nextId++;
    // fresh : orientation gauche/droite gratuite tant que le Xéno n'a pas bougé (survit au changement de tour).
    const g = { id, side: "GS", kind: "gs", x: p.x, y: p.y, f: faceNearestMarine(s, p.x, p.y), off: null, ap: 6, act: sub.acted ? "done" : "none", free: false, fresh: true };
    s.units[id] = g;
    sub.count--;
    sub.placed++;
    s.sub = null;
    if (sub.count > 0 && gsCount(s) < MAX_GS) s.queue.unshift(sub);
    else if (sub.count > 0) log(s, `${sub.count} Xéno(s) perdu(s) : plus de figurines.`, "GS");
    if (!sub.voluntary) s.queue.unshift({ type: "react", id, placement: true });
    return null;
  },
  placeNone(s) {
    const sub = s.sub;
    if (!sub || sub.type !== "place") return "Rien à placer.";
    if (placeCandidates(s, sub).length) return "Il reste des cases valides.";
    log(s, `${sub.count} Xéno(s) ne peuvent être placés et sont perdus.`, "GS");
    s.sub = null;
    return null;
  },
  endReact(s) {
    if (!s.sub || s.sub.type !== "react") return "Pas de réaction en cours.";
    const id = s.sub.id;
    s.sub = null;
    resolveOverwatch(s, id);
    return null;
  },
  skipReacts(s) {
    if (!s.sub || s.sub.type !== "react") return "Pas de réaction en cours.";
    s.skipReacts = true;
    return ACTIONS.endReact(s);
  },
  endTurn(s) {
    if (s.sub) return "Terminez d'abord l'action en cours.";
    if (s.phase === "sm") {
      endSMTurn(s, false);
      return null;
    }
    if (s.phase === "gs") {
      if (s.reinforce) return "Placez d'abord les renforts.";
      missionStatus(s);
      return null;
    }
    return "Pas maintenant.";
  },
  timeout(s) {
    if (s.phase !== "sm" || s.sub) return "Pas maintenant.";
    endSMTurn(s, true);
    return null;
  },
};

// ----------------------------------------------------------- mécanismes --
function unitLabel(u, generic) {
  if (u.side === "SM") return u.name;
  if (u.kind === "blip") return "un blip";
  return generic ? "un Xéno" : "Le Xéno";
}
function gsCount(s) {
  return Object.values(s.units).filter((u) => u.kind === "gs").length;
}
function waitingAt(s, entryId) {
  return Object.values(s.units).filter((u) => u.off === entryId);
}
function drawBlip(s) {
  if (!s.blipStack.length) {
    s.blipStack = shuffle(s.blipUsed);
    s.blipUsed = [];
    log(s, "Pile de blips épuisée : les blips utilisés sont remélangés.");
  }
  return s.blipStack.pop();
}
function finishReinforce(s) {
  if (s.reinforce.placed < s.reinforce.count) return;
  s.reinforce = null;
  if (s.phase === "deploy") startSMTurn(s);
}

function kill(s, u) {
  if (!s.units[u.id]) return;
  delete s.units[u.id];
  if (u.kind === "blip") s.blipUsed.push(u.value);
  if (s.active[u.side] === u.id) s.active[u.side] = null;
  if (u.side === "SM") log(s, `${u.name} est tombé.`, "GS");
}

function faceNearestMarine(s, x, y) {
  let best = null, bd = 1e9;
  for (const m of marines(s)) {
    const d = Math.abs(m.x - x) + Math.abs(m.y - y);
    if (d < bd) { bd = d; best = m; }
  }
  if (!best) return 0;
  const dx = best.x - x, dy = best.y - y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 1 : 3;
  return dy > 0 ? 2 : 0;
}

function revealBlip(s, b, chooser, voluntary) {
  BARRIER++;
  const acted = b.act !== "none";
  delete s.units[b.id];
  s.blipUsed.push(b.value);
  if (s.active.GS === b.id) s.active.GS = null;
  log(s, `${voluntary ? "Les Xénos révèlent" : "Contact ! Un blip est révélé"} : ${b.value} Xéno${b.value > 1 ? "s" : ""}.`, "GS");
  s.queue.unshift({ type: "place", chooser, voluntary, count: Math.min(b.value, MAX_GS - gsCount(s)), placed: 0, x: b.x, y: b.y, acted });
}

function placeCandidates(s, sub) {
  if (sub.placed === 0) {
    if (!unitAt(s, sub.x, sub.y)) return [{ x: sub.x, y: sub.y }];
  }
  const out = [];
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const x = sub.x + dx, y = sub.y + dy;
      if (!cell(x, y) || wallOrClosed(s, x, y) || unitAt(s, x, y) || isFlamed(s, x, y)) continue;
      if (sub.voluntary && anyMarineSees(s, x, y)) continue;
      out.push({ x, y });
    }
  return out;
}

function checkReveals(s) {
  for (const id in s.units) {
    const b = s.units[id];
    if (b.kind !== "blip" || b.off) continue;
    if (anyMarineSees(s, b.x, b.y)) revealBlip(s, b, "GS", false);
  }
}

// Après une action d'un modèle Xéno : fenêtre de réaction PC + overwatch.
function afterModelAction(s, u) {
  if (u.side !== "GS" || u.kind !== "gs") return;
  s.queue.push({ type: "react", id: u.id });
}

function processQueue(s) {
  while (!s.sub && s.queue.length && !s.winner) {
    const q = s.queue.shift();
    if (q.type === "place") {
      if (q.count <= 0) continue;
      s.sub = q;
      return;
    }
    if (q.type === "react") {
      const g = s.units[q.id];
      if (!g || g.off) continue;
      const seen = marines(s).some((m) => marineSees(s, m, g.x, g.y));
      if (s.phase === "gs" && seen && cpLeft(s) > 0 && !s.skipReacts) {
        s.sub = { type: "react", id: g.id };
        return;
      }
      resolveOverwatch(s, g.id);
    }
  }
}

function resolveOverwatch(s, gid) {
  for (const m of marines(s)) {
    const g = s.units[gid];
    if (!g || g.off) {
      // Toutes les figurines en overwatch à portée tirent quand même : on garde la règle simple.
      break;
    }
    if (!m.ow || m.jam || m.ranged !== "bolter") continue;
    if (cheb(m.x, m.y, g.x, g.y) > 12 || !marineSees(s, m, g.x, g.y)) continue;
    const sustained = m.owSus === gid;
    const need = sustained ? 5 : 6;
    const dice = rollN(2);
    const hit = dice.some((d) => d >= need);
    const jam = dice[0] === dice[1];
    s.roll = { text: `Overwatch de ${m.name}${sustained ? " (soutenu 5+)" : ""} : ${dice.join(" ")}${jam ? " — enrayé !" : ""}`, dice };
    log(s, `Overwatch : ${m.name} ${hit ? "abat" : "manque"} un Xéno (${dice.join(" ")})${jam ? ", son bolter s'enraye" : ""}.`, "SM");
    if (jam) m.jam = true;
    if (hit) {
      kill(s, g);
      m.owSus = null;
    } else m.owSus = gid;
  }
}

function closeAssault(s, att, def) {
  const sm = att.side === "SM" ? att : def;
  const gs = att.side === "SM" ? def : att;
  let gsDice = rollN(3);
  let smDie = d6();
  const smBonus = sm.kind === "sergeant" ? 1 : 0;
  const notes = [];
  const score = () => smDie + smBonus;
  const gsMax = () => Math.max(...gsDice);
  // Épée énergétique : parade — le Xéno relance son meilleur dé.
  if (sm.melee === "sword" && gsMax() >= score()) {
    const i = gsDice.indexOf(gsMax());
    const old = gsDice[i];
    gsDice[i] = d6();
    notes.push(`parade (${old}→${gsDice[i]})`);
  }
  // Garde : relance du dé du Terminator s'il perd.
  if (sm.guard && score() < gsMax()) {
    const old = smDie;
    smDie = d6();
    notes.push(`garde (${old}→${smDie})`);
  }
  const smS = score(), gsS = gsMax();
  s.roll = {
    text: `Corps à corps — ${sm.name} : ${smDie}${smBonus ? "+1" : ""} contre Xéno : ${gsDice.join(" ")}${notes.length ? " · " + notes.join(", ") : ""}`,
    dice: [smDie, ...gsDice],
  };
  const attS = att === sm ? smS : gsS;
  const defS = att === sm ? gsS : smS;
  const defFacing = (() => {
    const [fx, fy] = FACINGS[def.f];
    return def.x + fx === att.x && def.y + fy === att.y;
  })();
  if (attS > defS) {
    log(s, `Corps à corps : ${att === sm ? sm.name + " tue le Xéno" : "le Xéno tue " + sm.name} (${smS} contre ${gsS}).`, att.side);
    kill(s, def);
  } else if (defS > attS && defFacing) {
    log(s, `Corps à corps : ${def === sm ? sm.name + " tue le Xéno" : "le Xéno tue " + sm.name} en riposte (${smS} contre ${gsS}).`, def.side);
    kill(s, att);
  } else {
    if (!defFacing) {
      def.f = FACINGS.findIndex(([a, b]) => def.x + a === att.x && def.y + b === att.y);
      log(s, `Corps à corps sans vainqueur (${smS} contre ${gsS}) ; le défenseur se retourne.`);
    } else log(s, `Corps à corps : égalité (${smS} contre ${gsS}).`);
  }
}

function startSMTurn(s) {
  s.turn++;
  s.phase = "sm";
  s.skipReacts = false;
  s.active = { SM: null, GS: null };
  s.lastActor = null;
  for (const m of marines(s)) {
    m.ap = 4; m.act = "none"; m.free = false; m.sus = null;
  }
  if (s.cp.value != null) s.cp.pool.push(s.cp.value);
  s.cp.value = s.cp.pool.splice(Math.floor(Math.random() * s.cp.pool.length), 1)[0];
  s.cp.spent = 0;
  s.cp.redrawn = false;
  s.timer.endsAt = s.timer.seconds > 0 ? Date.now() + s.timer.seconds * 1000 : null;
  log(s, `— Tour ${s.turn} : l'escouade tire ses points de commandement.`, "SM");
}

function endSMTurn(s, timeout) {
  if (timeout) log(s, "Le sablier est écoulé !", "SM");
  for (const m of marines(s)) if (m.act === "active") m.act = "done";
  s.phase = "gs";
  s.timer.endsAt = null;
  s.active = { SM: null, GS: null };
  s.lastActor = null;
  for (const u of Object.values(s.units))
    if (u.side === "GS") { u.ap = 6; u.act = "none"; u.free = false; }
  s.forced = MAP.mission.entries
    .filter((e) => marines(s).some((m) => cheb(m.x, m.y, e.at[0], e.at[1]) <= 6))
    .map((e) => e.id);
  s.reinforce = { count: MAP.mission.reinforcements, placed: 0 };
  log(s, `— Tour ${s.turn} : aux Xénos (${MAP.mission.reinforcements} blips de renfort).`, "GS");
}

function missionStatus(s) {
  log(s, `Fin du tour ${s.turn}. Points de commandement de l'escouade ce tour : ${s.cp.value}.`);
  for (const m of marines(s)) { m.ow = false; m.guard = false; m.jam = false; m.owSus = null; }
  for (const u of Object.values(s.units)) if (u.side === "GS") u.lurk = false;
  s.flames = [];
  checkWin(s);
  if (!s.winner) startSMTurn(s);
}

function checkWin(s) {
  if (s.winner) {
    s.phase = "end";
    s.sub = null;
    s.queue = [];
    return;
  }
  const ms = marines(s);
  if (!ms.length) { s.winner = "GS"; s.reason = "L'escouade a été anéantie."; }
  else if (!ms.some((m) => m.ranged === "flamer")) { s.winner = "GS"; s.reason = "Le porteur du lance-flammes est mort."; }
  else if (s.flamerAmmo <= 0) { s.winner = "GS"; s.reason = "Le lance-flammes est à court de munitions."; }
  if (s.winner) { s.phase = "end"; s.sub = null; s.queue = []; log(s, s.reason); }
}

// Vue filtrée selon le camp (informations cachées).
function viewFor(s, side) {
  const v = JSON.parse(JSON.stringify({ ...s, undo: [] }));
  v.undoSide = undoSide(s);
  v.blipStackCount = s.blipStack.length;
  v.blipStack = [];
  v.blipUsed = [];
  v.cp.pool = [];
  if (side === "SM") for (const id in v.units) if (v.units[id].kind === "blip") v.units[id].value = null;
  if (side === "GS") v.cp.value = v.cp.value == null ? null : -1;
  v.timer.remaining = s.timer.endsAt ? Math.max(0, s.timer.endsAt - Date.now()) : null;
  return v;
}

const Engine = {
  MAP, FACINGS, FACING_NAMES, key, cell, newGame, applyAction, controller, legalMoves, shootTargets, flameTargets,
  doorsInReach, frontSquare, unitAt, marineSees, anyMarineSees, payPlan, cpLeft, placeCandidates, waitingAt,
  viewFor, isFlamed, MAX_WAITING, gsCount, undoSide,
};
if (typeof module !== "undefined") module.exports = Engine;
