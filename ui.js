"use strict";
// Rendu du plateau et du panneau d'ordres. L'état faisant foi est `state`
// (en local ou chez l'hôte) ; un invité ne voit que la vue que l'hôte lui envoie.

const E = Engine;
const CELL = 30;
let state = null;
const ui = { sel: null, mode: "move", showBlips: false, toast: null, toastTimer: null, lastCtl: null };

const SIDE_NAME = { SM: "Escouade", GS: "Xénos" };

function view() {
  if (session.mode === "online" && !session.isHost) return session.view;
  if (session.mode === "online") return E.viewFor(state, session.mySide);
  return state;
}
function canAct(v) {
  const ctl = E.controller(v);
  if (!ctl) return false;
  if (session.mode !== "online") return true;
  return ctl === session.mySide;
}
function blipsVisible() {
  if (session.mode === "online") return session.mySide === "GS";
  return ui.showBlips;
}

function dispatch(kind, payload) {
  if (session.mode === "online" && !session.isHost) {
    if (session.hostConn) session.hostConn.send({ type: "action", kind, payload });
    return;
  }
  const side = session.mode === "online" ? session.mySide : "BOTH";
  const err = E.applyAction(state, kind, payload, side);
  if (err) showToast(err);
  afterLocalChange();
}
function afterLocalChange() {
  if (session.mode === "online" && session.isHost) broadcastState();
  else render();
}
function showToast(msg) {
  ui.toast = msg;
  clearTimeout(ui.toastTimer);
  ui.toastTimer = setTimeout(() => { ui.toast = null; const t = document.getElementById("toast"); if (t) t.remove(); }, 2600);
  render();
}

// ------------------------------------------------------------------ plateau --
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function boardSvg(v) {
  const m = E.MAP.mission;
  const W = m.width * CELL, H = m.height * CELL;
  const sel = ui.sel && v.units[ui.sel];
  const parts = [];
  parts.push(`<svg id="board" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Plateau de jeu">`);
  parts.push(`<defs><pattern id="grid" width="${CELL}" height="${CELL}" patternUnits="userSpaceOnUse"><path d="M ${CELL} 0 L 0 0 0 ${CELL}" fill="none" stroke="#1d2228" stroke-width="1"/></pattern>
    <pattern id="hazard" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="8" fill="#ff7a2f" opacity="0.55"/></pattern></defs>`);
  parts.push(`<rect width="${W}" height="${H}" fill="url(#grid)"/>`);

  // cases
  for (const k in E.MAP.cells) {
    const c = E.MAP.cells[k];
    const fill = c.room ? "var(--plate-room)" : "var(--plate)";
    parts.push(`<rect x="${c.x * CELL + 1}" y="${c.y * CELL + 1}" width="${CELL - 2}" height="${CELL - 2}" rx="2" fill="${fill}"/>`);
  }
  // salle objectif
  const a = E.MAP.sections[m.targetSection].map((k) => E.MAP.cells[k]);
  const ax0 = Math.min(...a.map((c) => c.x)), ay0 = Math.min(...a.map((c) => c.y));
  const ax1 = Math.max(...a.map((c) => c.x)), ay1 = Math.max(...a.map((c) => c.y));
  parts.push(`<rect x="${ax0 * CELL - 3}" y="${ay0 * CELL - 3}" width="${(ax1 - ax0 + 1) * CELL + 6}" height="${(ay1 - ay0 + 1) * CELL + 6}" fill="none" stroke="var(--brass)" stroke-width="2" stroke-dasharray="6 4"/>`);
  parts.push(`<text x="${ax0 * CELL - 6}" y="${ay0 * CELL + 14}" text-anchor="end" fill="var(--brass)" font-family="var(--font-display)" font-size="18" font-weight="700">A</text>`);
  // cases de départ
  for (const [x, y] of m.startSquares) parts.push(`<path d="M ${x * CELL + 8} ${y * CELL + 8} L ${x * CELL + 15} ${y * CELL + 15} L ${x * CELL + 8} ${y * CELL + 22}" fill="none" stroke="var(--marine)" stroke-width="2" opacity="0.5"/>`);
  const [sx, sy] = m.smArea;
  parts.push(`<path d="M ${sx * CELL + 24} ${sy * CELL + 4} L ${sx * CELL + 6} ${sy * CELL + 15} L ${sx * CELL + 24} ${sy * CELL + 26} Z" fill="none" stroke="var(--marine)" stroke-width="2"/>`);
  // flammes
  for (const sec of v.flames) for (const k of E.MAP.sections[sec]) {
    const c = E.MAP.cells[k];
    parts.push(`<rect x="${c.x * CELL + 1}" y="${c.y * CELL + 1}" width="${CELL - 2}" height="${CELL - 2}" fill="url(#hazard)"/>`);
  }
  // portes
  for (const k in v.doors) {
    const [x, y] = k.split(",").map(Number);
    const horiz = !!(E.cell(x - 1, y) || E.cell(x + 1, y)); // passage est-ouest → battant vertical
    const st = v.doors[k];
    const cx = x * CELL + CELL / 2, cy = y * CELL + CELL / 2;
    if (st === "closed") {
      parts.push(horiz
        ? `<rect x="${cx - 4}" y="${y * CELL + 2}" width="8" height="${CELL - 4}" rx="2" fill="var(--door)"/>`
        : `<rect x="${x * CELL + 2}" y="${cy - 4}" width="${CELL - 4}" height="8" rx="2" fill="var(--door)"/>`);
    } else if (st === "open") {
      parts.push(horiz
        ? `<rect x="${cx - 3}" y="${y * CELL + 1}" width="6" height="5" fill="var(--door)"/><rect x="${cx - 3}" y="${y * CELL + CELL - 6}" width="6" height="5" fill="var(--door)"/>`
        : `<rect x="${x * CELL + 1}" y="${cy - 3}" width="5" height="6" fill="var(--door)"/><rect x="${x * CELL + CELL - 6}" y="${cy - 3}" width="5" height="6" fill="var(--door)"/>`);
    } else {
      parts.push(`<path d="M ${x * CELL + 6} ${y * CELL + 6} L ${x * CELL + CELL - 6} ${y * CELL + CELL - 6} M ${x * CELL + CELL - 6} ${y * CELL + 6} L ${x * CELL + 6} ${y * CELL + CELL - 6}" stroke="var(--door)" stroke-width="1.5" opacity="0.6"/>`);
    }
  }
  // zones d'entrée
  for (const e of m.entries) {
    const [ox, oy] = e.off, [tx, ty] = e.at;
    const dx = tx - ox, dy = ty - oy;
    const cx = ox * CELL + CELL / 2, cy = oy * CELL + CELL / 2;
    const tip = [cx + dx * 11, cy + dy * 11], b1 = [cx - dx * 6 - dy * 9, cy - dy * 6 - dx * 9], b2 = [cx - dx * 6 + dy * 9, cy - dy * 6 + dx * 9];
    const waiting = E.waitingAt(v, e.id);
    const forced = v.forced && v.forced.includes(e.id) && v.phase === "gs";
    parts.push(`<polygon points="${tip} ${b1} ${b2}" fill="var(--xeno)" opacity="${forced ? 0.35 : 0.85}"/>`);
    if (waiting.length) {
      const blips = waiting.filter((u) => u.kind === "blip").length, gs = waiting.length - blips;
      const label = (blips ? blips + "◉" : "") + (gs ? (blips ? " " : "") + gs + "✕" : "");
      parts.push(`<text x="${cx + dy * 20 - (dx ? 0 : 0)}" y="${cy + dx * -0 + (dy ? 0 : 0) - 14}" text-anchor="middle" fill="var(--auspex)" font-family="var(--font-data)" font-size="11" font-weight="700">${label}</text>`);
    }
  }

  // surbrillances
  const hl = highlights(v, sel);
  for (const h of hl) {
    const x = h.x * CELL, y = h.y * CELL;
    if (h.kind === "move") {
      parts.push(`<rect x="${x + 3}" y="${y + 3}" width="${CELL - 6}" height="${CELL - 6}" rx="3" fill="var(--brass)" opacity="0.18" stroke="var(--brass)" stroke-opacity="0.7"/>`);
      parts.push(`<text x="${x + CELL / 2}" y="${y + CELL / 2 + 4}" text-anchor="middle" fill="var(--brass)" font-family="var(--font-data)" font-size="11">${h.label}</text>`);
    } else if (h.kind === "target") {
      parts.push(`<circle cx="${x + CELL / 2}" cy="${y + CELL / 2}" r="13" fill="none" stroke="var(--danger)" stroke-width="2" class="pulse"/>`);
    } else if (h.kind === "flame") {
      parts.push(`<rect x="${x + 4}" y="${y + 4}" width="${CELL - 8}" height="${CELL - 8}" rx="3" fill="var(--fire)" opacity="0.28"/>`);
    } else if (h.kind === "place") {
      parts.push(`<rect x="${x + 3}" y="${y + 3}" width="${CELL - 6}" height="${CELL - 6}" rx="3" fill="none" stroke="var(--xeno)" stroke-width="2" class="pulse"/>`);
    } else if (h.kind === "entry") {
      parts.push(`<rect x="${x + 1}" y="${y + 1}" width="${CELL - 2}" height="${CELL - 2}" rx="4" fill="none" stroke="var(--xeno)" stroke-width="2" class="pulse"/>`);
    }
  }

  // unités
  for (const u of Object.values(v.units)) {
    if (u.off) continue;
    parts.push(unitSvg(v, u, ui.sel === u.id));
  }
  parts.push(`</svg>`);
  return parts.join("");
}

function unitSvg(v, u, selected) {
  const cx = u.x * CELL + CELL / 2, cy = u.y * CELL + CELL / 2;
  const out = [];
  const dim = u.act === "done" ? 0.55 : 1;
  if (selected) out.push(`<rect x="${u.x * CELL}" y="${u.y * CELL}" width="${CELL}" height="${CELL}" rx="4" fill="none" stroke="var(--ink)" stroke-width="2"/>`);
  if (u.kind === "blip") {
    const show = blipsVisible() && u.value != null;
    out.push(`<g opacity="${dim}"><circle cx="${cx}" cy="${cy}" r="11" fill="#0f2a24" stroke="var(--auspex)" stroke-width="2"/><circle cx="${cx}" cy="${cy}" r="5" fill="none" stroke="var(--auspex)" stroke-opacity="0.5"/>`);
    out.push(`<text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="var(--auspex)" font-family="var(--font-data)" font-size="12" font-weight="700">${show ? u.value : "?"}</text></g>`);
    return out.join("");
  }
  const [fx, fy] = E.FACINGS[u.f];
  const color = u.side === "SM" ? "var(--marine)" : "var(--xeno)";
  // pointe d'orientation
  const tip = [cx + fx * 14, cy + fy * 14], l = [cx + fx * 7 - fy * 7, cy + fy * 7 - fx * 7], r = [cx + fx * 7 + fy * 7, cy + fy * 7 + fx * 7];
  out.push(`<g opacity="${dim}">`);
  if (u.ow) out.push(`<circle cx="${cx}" cy="${cy}" r="14" fill="none" stroke="var(--brass)" stroke-width="2" stroke-dasharray="3 3"/>`);
  if (u.guard) out.push(`<rect x="${cx - 13}" y="${cy - 13}" width="26" height="26" rx="6" fill="none" stroke="var(--door)" stroke-width="2"/>`);
  out.push(`<polygon points="${tip} ${l} ${r}" fill="${color}"/>`);
  if (u.side === "SM") {
    out.push(`<circle cx="${cx}" cy="${cy}" r="10" fill="${color}" stroke="#2a0d0e" stroke-width="1.5"/>`);
    const letter = u.kind === "sergeant" ? "S" : u.kind === "flamer" ? "F" : "B";
    out.push(`<text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="#fff4ee" font-family="var(--font-display)" font-size="13" font-weight="700">${letter}</text>`);
    if (u.jam) out.push(`<text x="${cx + 10}" y="${cy - 7}" fill="var(--danger)" font-family="var(--font-data)" font-size="11" font-weight="700">!</text>`);
  } else {
    out.push(`<path d="M ${cx - 9} ${cy} Q ${cx} ${cy - 13} ${cx + 9} ${cy} Q ${cx} ${cy + 13} ${cx - 9} ${cy} Z" fill="${color}" stroke="#241536" stroke-width="1.5" transform="rotate(${u.f * 90 + 90} ${cx} ${cy})"/>`);
    out.push(`<circle cx="${cx}" cy="${cy}" r="2.5" fill="#241536"/>`);
  }
  out.push(`</g>`);
  return out.join("");
}

function highlights(v, sel) {
  const out = [];
  if (!canAct(v)) return out;
  const ctl = E.controller(v);
  if (v.sub && v.sub.type === "place") {
    for (const c of E.placeCandidates(v, v.sub)) out.push({ ...c, kind: "place" });
    return out;
  }
  if (v.reinforce && ctl === "GS") {
    for (const e of E.MAP.mission.entries) if (E.waitingAt(v, e.id).length < E.MAX_WAITING) out.push({ x: e.off[0], y: e.off[1], kind: "entry" });
    return out;
  }
  if (!sel || sel.side !== ctl || sel.off) return out;
  if (ui.mode === "shoot") for (const t of E.shootTargets(v, sel)) out.push({ ...t, kind: "target" });
  else if (ui.mode === "flame") for (const t of E.flameTargets(v, sel)) out.push({ ...t, kind: "flame" });
  else if (v.phase !== "setup") for (const m of E.legalMoves(v, sel)) out.push({ x: m.x, y: m.y, kind: "move", label: costText(v, sel, m.cost, true) });
  return out;
}

function costText(v, u, cost, short) {
  if (cost === 0) return short ? "0" : "gratuit";
  const p = E.payPlan(v, u, cost);
  if (!p) return "—";
  if (short) return p.cp ? (p.ap ? `${p.ap}+${p.cp}PC` : `${p.cp}PC`) : String(cost);
  if (!p.cp) return `${cost} PA`;
  if (!p.ap) return `${p.cp} PC`;
  return `${p.ap} PA + ${p.cp} PC`;
}

function onBoardClick(evt) {
  const svg = document.getElementById("board");
  const r = svg.getBoundingClientRect();
  const m = E.MAP.mission;
  const x = Math.floor(((evt.clientX - r.left) / r.width) * m.width);
  const y = Math.floor(((evt.clientY - r.top) / r.height) * m.height);
  const v = view();
  if (!canAct(v)) return;
  const ctl = E.controller(v);
  const u = E.unitAt(v, x, y);

  if (v.phase === "setup") {
    if (u && u.side === "SM") {
      if (ui.sel && ui.sel !== u.id) { const a = ui.sel; ui.sel = null; return dispatch("swap", { a, b: u.id }); }
      ui.sel = ui.sel === u.id ? null : u.id;
    }
    return render();
  }
  if (v.sub && v.sub.type === "place") return dispatch("place", { x, y });
  const entry = m.entries.find((e) => e.off[0] === x && e.off[1] === y);
  if (v.reinforce && ctl === "GS") {
    if (entry) return dispatch("placeBlip", { entry: entry.id });
    return;
  }
  if (entry && ctl === "GS") {
    const w = E.waitingAt(v, entry.id).find((w) => w.act !== "done");
    if (w) { ui.sel = w.id; ui.mode = "move"; return render(); }
  }
  const sel = ui.sel && v.units[ui.sel];
  if (sel && ui.mode === "shoot") {
    const t = E.shootTargets(v, sel).find((t) => t.x === x && t.y === y);
    ui.mode = "move";
    if (t) return dispatch("shoot", { id: sel.id, target: t.id, door: t.door });
    return render();
  }
  if (sel && ui.mode === "flame") {
    const ok = E.flameTargets(v, sel).some((t) => t.x === x && t.y === y);
    ui.mode = "move";
    if (ok) return dispatch("flame", { id: sel.id, x, y });
    return render();
  }
  if (u && u.side === ctl) {
    ui.sel = u.id; ui.mode = "move";
    return render();
  }
  if (sel && sel.side === ctl && !sel.off) {
    if (E.legalMoves(v, sel).some((mv) => mv.x === x && mv.y === y)) return dispatch("move", { id: sel.id, x, y });
  }
}

// ------------------------------------------------------------------ panneau --
function renderGame() {
  const v = view();
  const app = document.getElementById("app");
  const ctl = E.controller(v);
  if (ui.sel && !v.units[ui.sel]) ui.sel = null;
  if (ui.sel && v.units[ui.sel] && v.units[ui.sel].side !== ctl && v.phase !== "setup") { ui.sel = null; ui.mode = "move"; }

  app.innerHTML = `
    <div class="top-row"><h1>Épave stellaire</h1><span class="tag">${esc(E.MAP.mission.title)}${session.mode === "online" ? " · en ligne — vous jouez " + SIDE_NAME[session.mySide] : " · même écran"}</span></div>
    ${statusBar(v)}
    <div class="game">
      <div class="board-wrap" id="boardWrap">${boardSvg(v)}</div>
      <div class="panel">${panelHtml(v)}</div>
    </div>
    ${ui.toast ? `<div class="toast" id="toast" role="alert">${esc(ui.toast)}</div>` : ""}
  `;
  document.getElementById("board").addEventListener("click", onBoardClick);
  app.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", onPanelClick));
  const sb = document.getElementById("showBlips");
  if (sb) sb.addEventListener("change", (e) => { ui.showBlips = e.target.checked; render(); });
  updateTimer();
}

function statusBar(v) {
  const ctl = E.controller(v);
  const who = v.winner ? "Fin" : v.sub && v.sub.type === "react" ? "Escouade (réaction)" : ctl ? SIDE_NAME[ctl] : "—";
  let cp = "—";
  if (v.cp.value === -1) cp = `? · ${v.cp.spent} dépensé${v.cp.spent > 1 ? "s" : ""}`;
  else if (v.cp.value != null) cp = `${v.cp.value - v.cp.spent} / ${v.cp.value}`;
  const blipLeft = v.blipStackCount != null ? v.blipStackCount : v.blipStack.length;
  return `<div class="status">
    <div class="stat"><span class="k">Tour</span><span class="v">${v.turn || "—"}</span></div>
    <div class="stat ${ctl === "SM" ? "turn-sm" : ctl === "GS" ? "turn-gs" : ""}"><span class="k">À jouer</span><span class="v">${who}</span></div>
    <div class="stat"><span class="k">Points de commandement</span><span class="v">${cp}</span></div>
    <div class="stat timer"><span class="k">Sablier</span><span class="v" id="timer">—</span></div>
    <div class="stat"><span class="k">Lance-flammes</span><span class="v">${v.flamerAmmo} / 6</span></div>
    <div class="stat"><span class="k">Pile de blips</span><span class="v">${blipLeft}</span></div>
    <div class="stat"><span class="k">Xénos en jeu</span><span class="v">${E.gsCount(v)}</span></div>
  </div>`;
}

function btn(act, label, opts = {}) {
  const data = Object.entries(opts.data || {}).map(([k, val]) => `data-${k}="${esc(val)}"`).join(" ");
  return `<button data-act="${act}" ${data} class="${opts.secondary ? "secondary" : ""}" ${opts.disabled ? "disabled" : ""}>${label}${opts.cost != null ? `<span class="cost">${opts.cost}</span>` : ""}</button>`;
}

function panelHtml(v) {
  const ctl = E.controller(v);
  const mine = canAct(v);
  const out = [];
  if (v.winner) {
    out.push(`<div class="box end ${v.winner}"><h2>${v.winner === "SM" ? "Victoire de l'escouade" : "Victoire des Xénos"}</h2><p>${esc(v.reason)}</p>
      <div class="btns">${session.mode === "online" ? btn("menu", "Retour au menu") : btn("again", "Rejouer") + btn("menu", "Menu", { secondary: true })}</div></div>`);
  } else out.push(promptBox(v, ctl, mine));

  if (!v.winner && mine) {
    const sel = ui.sel && v.units[ui.sel];
    if (sel && v.phase !== "setup" && !(v.sub && v.sub.type === "place") && !v.reinforce) out.push(unitBox(v, sel));
    if (ctl === "GS" && v.phase === "gs" && !v.sub && !v.reinforce) out.push(waitingBox(v));
  }
  if (v.roll) {
    out.push(`<div class="box"><h2>Dernier jet</h2><p class="roll">${esc(v.roll.text)}</p><div class="dice">${(v.roll.dice || []).map((d) => `<span class="die">${d}</span>`).join("")}</div></div>`);
  }
  out.push(`<div class="box"><h2>Journal</h2><div class="log">${v.log.slice().reverse().slice(0, 60).map((l) => `<div class="${l.side || ""}">${esc(l.text)}</div>`).join("")}</div></div>`);
  out.push(`<div class="box"><h2>Légende</h2><div class="legend">
    <span style="--c:var(--marine)">Terminator (S sergent, F lance-flammes, B bolter)</span>
    <span style="--c:var(--xeno)">Xéno</span><span style="--c:var(--auspex)">Blip</span>
    <span style="--c:var(--door)">Porte</span><span style="--c:var(--brass)">Overwatch · salle A</span><span style="--c:var(--fire)">Flammes</span></div>
    ${session.mode !== "online" ? `<div class="choice-row"><label for="showBlips"><input type="checkbox" id="showBlips" ${ui.showBlips ? "checked" : ""}> Montrer le contenu des blips (joueur Xéno)</label></div>` : ""}</div>`);
  out.push(`<div class="box"><h2>Mission</h2><p class="small-note">${esc(E.MAP.mission.brief)}</p></div>`);
  return out.join("");
}

function undoBtn(v) {
  const side = v.undoSide !== undefined ? v.undoSide : E.undoSide(v);
  const ok = side && side === E.controller(v);
  return btn("undo", "↶ Annuler", { secondary: true, disabled: !ok });
}

function promptBox(v, ctl, mine) {
  const cls = ctl === "SM" ? "sm" : "gs";
  const wait = (txt) => `<div class="box prompt ${cls}"><p>${txt}</p></div>`;
  if (!mine) {
    if (v.sub && v.sub.type === "react") return wait("L'escouade décide si elle réagit…");
    if (v.sub && v.sub.type === "place") return wait(`${SIDE_NAME[v.sub.chooser]} place les Xénos révélés…`);
    return wait(`En attente : ${SIDE_NAME[ctl]} joue.`);
  }
  if (v.phase === "setup")
    return `<div class="box prompt sm"><h2>Déploiement</h2><p>Cliquez deux Terminators pour échanger leurs places. Le lance-flammes (F) doit survivre jusqu'à la salle A.</p><div class="btns">${undoBtn(v)}${btn("start", "Lancer la mission")}</div></div>`;
  if (v.sub && v.sub.type === "place") {
    const none = E.placeCandidates(v, v.sub).length === 0;
    return `<div class="box prompt gs"><h2>Blip révélé</h2><p>${SIDE_NAME[v.sub.chooser]} : placez ${v.sub.count} Xéno${v.sub.count > 1 ? "s" : ""} sur les cases qui clignotent${v.sub.voluntary ? " (hors de vue de l'escouade)" : ""}.</p>${none ? `<div class="btns">${btn("placeNone", "Aucune case libre")}</div>` : ""}</div>`;
  }
  if (v.sub && v.sub.type === "react")
    return `<div class="box prompt sm"><h2>Réaction</h2><p>Un Xéno vient d'agir sous vos yeux. Dépensez des PC (${E.cpLeft(v)} restants) avec n'importe quel Terminator, ou continuez.</p><div class="btns">${undoBtn(v)}${btn("endReact", "Continuer")}${btn("skipReacts", "Ne plus proposer ce tour", { secondary: true })}</div></div>`;
  if (v.reinforce) {
    const full = E.MAP.mission.entries.every((e) => E.waitingAt(v, e.id).length >= E.MAX_WAITING);
    return `<div class="box prompt gs"><h2>${v.phase === "deploy" ? "Blips de départ" : "Renforts"}</h2><p>Cliquez une zone d'entrée (flèche violette) pour y placer un blip — ${v.reinforce.count - v.reinforce.placed} restant${v.reinforce.count - v.reinforce.placed > 1 ? "s" : ""}. Trois blips au plus par entrée${v.phase === "gs" ? " ; les entrées pâles sont à 6 cases ou moins d'un Terminator : un blip qui y arrive attend ce tour" : ""}.</p><div class="btns">${undoBtn(v)}${full ? btn("discardBlip", "Défausser (entrées pleines)") : ""}</div></div>`;
  }
  if (v.phase === "sm") {
    const sgt = Object.values(v.units).some((u) => u.kind === "sergeant");
    const canRedraw = sgt && !v.cp.redrawn && v.cp.spent === 0;
    return `<div class="box prompt sm"><h2>Tour de l'escouade</h2><p>Sélectionnez un Terminator : 4 PA chacun, l'un après l'autre. Les PC complètent les PA de n'importe quel Terminator. Cases dorées : déplacements possibles et leur coût.</p>
      <div class="btns">${undoBtn(v)}${canRedraw ? btn("redraw", "Retirer les PC (sergent)", { secondary: true }) : ""}${btn("endTurn", "Fin du tour")}</div></div>`;
  }
  if (v.phase === "gs")
    return `<div class="box prompt gs"><h2>Tour des Xénos</h2><p>6 PA par blip ou Xéno, un à la fois. Les blips ne peuvent ni entrer dans le champ de vision d'un Terminator ni s'en approcher au contact. Cliquez une flèche d'entrée pour choisir une unité en attente.</p><div class="btns">${undoBtn(v)}${btn("endTurn", "Fin du tour")}</div></div>`;
  return "";
}

function unitBox(v, u) {
  const out = [];
  const title = u.side === "SM" ? u.name : u.kind === "blip" ? "Blip" : "Xéno";
  const chips = [];
  if (u.act === "active") chips.push(`<span class="chip">activé</span>`);
  if (u.act === "done") chips.push(`<span class="chip done">a agi</span>`);
  if (u.ow) chips.push(`<span class="chip ow">overwatch</span>`);
  if (u.guard) chips.push(`<span class="chip guard">garde</span>`);
  if (u.jam) chips.push(`<span class="chip jam">enrayé</span>`);
  if (u.lurk) chips.push(`<span class="chip">doit attendre</span>`);
  if (u.kind === "blip" && blipsVisible() && u.value != null) chips.push(`<span class="chip">${u.value} Xéno${u.value > 1 ? "s" : ""}</span>`);
  const apTxt = u.side === "SM" && (u.act === "done" || v.phase !== "sm" || (v.sub && v.sub.type === "react")) ? "PC seulement" : `${u.ap} PA`;
  out.push(`<div class="box"><div class="unit-head"><strong>${esc(title)}</strong><span class="tag">${apTxt}</span></div>`);
  if (u.side === "SM") out.push(`<p class="small-note">${u.ranged === "flamer" ? "Lance-flammes lourd" : "Bolter d'assaut"} · ${u.melee === "sword" ? "épée énergétique (+1, parade)" : "gantelet énergétique"}</p>`);
  if (chips.length) out.push(`<div class="chips">${chips.join("")}</div>`);
  const b = [];
  const c = (cost) => costText(v, u, cost);
  const can = (cost) => cost === 0 || !!E.payPlan(v, u, cost);
  if (u.off) {
    b.push(btn("enter", "Entrer", { data: { id: u.id }, cost: c(1), disabled: !can(1) || u.lurk }));
    if (u.kind === "blip") b.push(btn("reveal", "Révéler", { data: { id: u.id }, disabled: u.act !== "none", secondary: true }));
  } else if (u.kind === "blip") {
    b.push(btn("reveal", "Révéler", { data: { id: u.id }, disabled: u.act !== "none", secondary: true }));
  } else {
    const freeTurn = u.side === "GS" && u.free === "turn";
    b.push(btn("turn", "↺ Gauche", { data: { id: u.id, dir: -1 }, cost: c(freeTurn ? 0 : 1), disabled: !can(freeTurn ? 0 : 1) }));
    b.push(btn("turn", "↻ Droite", { data: { id: u.id, dir: 1 }, cost: c(freeTurn ? 0 : 1), disabled: !can(freeTurn ? 0 : 1) }));
    if (u.side === "GS") b.push(btn("turn", "Demi-tour", { data: { id: u.id, dir: 2 }, cost: c(1), disabled: !can(1) }));
    if (u.side === "SM" && u.ranged === "bolter") {
      const freeShot = u.free === "shot";
      const n = E.shootTargets(v, u).length;
      b.push(btn("modeShoot", ui.mode === "shoot" ? "Annuler le tir" : "Tirer", { data: { id: u.id }, cost: c(freeShot ? 0 : 1), disabled: u.jam || !n || !can(freeShot ? 0 : 1) }));
      b.push(btn("overwatch", "Overwatch", { data: { id: u.id }, cost: c(2), disabled: !can(2) || u.jam }));
      if (u.jam) b.push(btn("unjam", "Désenrayer", { data: { id: u.id }, cost: c(1), disabled: !can(1) }));
    }
    if (u.side === "SM" && u.ranged === "flamer")
      b.push(btn("modeFlame", ui.mode === "flame" ? "Annuler" : "Lance-flammes", { data: { id: u.id }, cost: c(2), disabled: !can(2) || !E.flameTargets(v, u).length }));
    if (u.side === "SM") b.push(btn("guard", "Garde", { data: { id: u.id }, cost: c(2), disabled: !can(2) }));
    const [fx, fy] = E.frontSquare(u);
    const front = E.unitAt(v, fx, fy);
    const doorFront = v.doors[E.key(fx, fy)] === "closed";
    if ((front && front.side !== u.side && front.kind !== "blip") || doorFront)
      b.push(btn("assault", front ? "Corps à corps" : "Frapper la porte", { data: { id: u.id }, cost: c(1), disabled: !can(1) }));
  }
  if (!u.off) for (const d of E.doorsInReach(v, u))
    b.push(btn("door", d.st === "closed" ? "Ouvrir la porte" : "Fermer la porte", { data: { id: u.id, x: d.x, y: d.y }, cost: c(1), disabled: !can(1), secondary: true }));
  out.push(`<div class="btns">${b.join("")}</div>`);
  if (ui.mode === "shoot") out.push(`<p class="small-note">Cliquez une cible entourée de rouge.</p>`);
  if (ui.mode === "flame") out.push(`<p class="small-note">Cliquez une case orange : toute sa section brûle (chaque figurine meurt sur 2+), y compris les Terminators.</p>`);
  out.push(`</div>`);
  return out.join("");
}

function waitingBox(v) {
  const rows = [];
  for (const e of E.MAP.mission.entries) {
    for (const u of E.waitingAt(v, e.id)) {
      const label = u.kind === "blip" ? `Blip${blipsVisible() && u.value != null ? " (" + u.value + ")" : ""}` : "Xéno";
      rows.push(`<div class="waiting-row"><span>${label} · ${esc(e.name)}${u.lurk ? " · attend" : ""}${u.act === "done" ? " · a agi" : ""}</span><span class="btns">
        ${btn("enter", "Entrer", { data: { id: u.id }, disabled: u.lurk || u.act === "done" || !E.payPlan(v, u, 1) })}
        ${u.kind === "blip" ? btn("reveal", "Révéler", { data: { id: u.id }, secondary: true, disabled: u.act !== "none" }) : ""}</span></div>`);
    }
  }
  if (!rows.length) return "";
  return `<div class="box"><h2>En attente aux entrées</h2><div class="waiting">${rows.join("")}</div></div>`;
}

function onPanelClick(e) {
  const b = e.currentTarget;
  const act = b.dataset.act;
  const id = b.dataset.id;
  switch (act) {
    case "modeShoot": ui.sel = id; ui.mode = ui.mode === "shoot" ? "move" : "shoot"; return render();
    case "modeFlame": ui.sel = id; ui.mode = ui.mode === "flame" ? "move" : "flame"; return render();
    case "again": state = E.newGame({ timerSeconds: state.timer.seconds }); ui.sel = null; return render();
    case "menu": return resetToMenu();
    case "turn": ui.mode = "move"; return dispatch("turn", { id, dir: +b.dataset.dir });
    case "door": return dispatch("door", { id, x: +b.dataset.x, y: +b.dataset.y });
    case "enter": ui.sel = id; return dispatch("enter", { id });
    case "start": ui.sel = null; return dispatch("start", {});
    case "endTurn": ui.sel = null; ui.mode = "move"; return dispatch("endTurn", {});
    default:
      ui.mode = "move";
      return dispatch(act, id ? { id } : {});
  }
}

document.addEventListener("keydown", (e) => {
  if (session.screen !== "game" || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
  const v = view();
  if (!v || !canAct(v)) return;
  e.preventDefault();
  ui.mode = "move";
  dispatch("undo", {});
});

// ------------------------------------------------------------------ sablier --
function timerDeadline(v) {
  if (!v || v.phase !== "sm" || v.winner) return null;
  if (session.mode === "online" && !session.isHost) return session.timerDeadline;
  return state.timer.endsAt;
}
function updateTimer() {
  const el = document.getElementById("timer");
  if (!el) return;
  const v = view();
  const d = timerDeadline(v);
  if (!v || !v.timer.seconds) { el.textContent = "désactivé"; return; }
  if (!d) { el.textContent = "—"; el.classList.remove("low"); return; }
  const ms = Math.max(0, d - Date.now());
  const s = Math.ceil(ms / 1000);
  el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  el.classList.toggle("low", s <= 30);
}
setInterval(() => {
  if (session.screen !== "game" || !state && !(session.view)) return;
  updateTimer();
  const authoritative = session.mode === "local" || (session.mode === "online" && session.isHost);
  if (authoritative && state && state.phase === "sm" && state.timer.endsAt && Date.now() > state.timer.endsAt && !state.sub && !state.winner) {
    E.applyAction(state, "timeout", {}, null);
    ui.sel = null;
    afterLocalChange();
  }
}, 300);
