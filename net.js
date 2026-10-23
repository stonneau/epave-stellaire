"use strict";
// Menus et jeu en ligne. Même principe que Deep Sea Adventure : WebRTC via le
// broker public de PeerJS, l'hôte fait foi. L'invité envoie des demandes
// d'action ; l'hôte les valide, applique, et renvoie à chacun SA vue
// (contenu des blips caché à l'escouade, PC cachés aux Xénos).

const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const PEER_ID_PREFIX = "hulk-fan-";

let session = freshSession();
function freshSession(err) {
  return {
    screen: err ? "online-choice" : "menu",
    mode: null, // local | online
    isHost: false,
    mySide: null, // SM | GS (en ligne)
    peer: null,
    hostConn: null,
    guestConn: null,
    hostName: "",
    guestName: "",
    roomCode: null,
    view: null,
    timerDeadline: null,
    timerSeconds: 180,
    error: err || null,
    lastBeepKey: null,
  };
}

const ONLINE_OK = !window.HULK_NO_ONLINE && typeof RTCPeerConnection !== "undefined";

let audioCtx = null;
function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch (e) { /* pas d'audio */ }
}
function beep() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime, o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.frequency.value = 660;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
  o.connect(g).connect(audioCtx.destination);
  o.start(now); o.stop(now + 0.32);
}
function notifyMyTurn(v) {
  if (session.mode !== "online" || !v || v.winner) return;
  if (E.controller(v) !== session.mySide) { session.lastBeepKey = null; return; }
  const k = `${v.gameId}:${v.turn}:${v.phase}:${v.sub ? v.sub.type : ""}`;
  if (session.lastBeepKey === k) return;
  session.lastBeepKey = k;
  beep();
}

function render() {
  switch (session.screen) {
    case "menu": return renderMenu();
    case "local-setup": return renderLocalSetup();
    case "online-choice": return renderOnlineChoice();
    case "host-lobby": return renderHostLobby();
    case "guest-join": return renderGuestJoin();
    case "guest-lobby": return renderGuestLobby();
    case "game": {
      const v = view();
      if (!v) { session.screen = "menu"; return renderMenu(); }
      renderGame();
      notifyMyTurn(v);
      return;
    }
  }
}

function shell(sub, body) {
  document.getElementById("app").innerHTML = `
    <div class="top-row"><h1>Épave stellaire</h1><span class="tag">Prototype fan · règles Space Hulk 3e/4e éd.</span></div>
    <p class="subtitle">${sub}</p>${body}`;
}

function timerSelect(id) {
  const opts = [[120, "2 min"], [180, "3 min (règle)"], [240, "4 min"], [0, "Sans sablier"]];
  return `<label for="${id}">Sablier du tour de l'escouade</label><select id="${id}">${opts.map(([s, l]) => `<option value="${s}" ${s === session.timerSeconds ? "selected" : ""}>${l}</option>`).join("")}</select>`;
}

function renderMenu() {
  shell("Cinq Terminators doivent atteindre la salle de contrôle des lancements et l'incendier au lance-flammes, à travers les coursives infestées d'une épave dérivante.", `
    <div class="card">
      <button id="bLocal">Jouer à deux sur cet écran</button>
      ${ONLINE_OK ? `<button id="bOnline" class="secondary">Jouer en ligne avec un ami</button>` : `<p class="small-note">Le jeu en ligne passe par WebRTC, que cette page ne permet pas ici : ouvrez la version hébergée du projet (GitHub Pages) pour jouer à distance.</p>`}
    </div>`);
  document.getElementById("bLocal").onclick = () => { session.screen = "local-setup"; render(); };
  if (ONLINE_OK) document.getElementById("bOnline").onclick = () => { session.screen = "online-choice"; session.error = null; render(); };
}

function renderLocalSetup() {
  shell("Partie à deux sur le même écran : passez-vous la main à chaque changement de camp.", `
    <div class="card">
      ${timerSelect("timerSel")}
      <p class="small-note">Le joueur Xéno peut afficher le contenu des blips depuis le panneau de légende ; l'escouade détourne les yeux.</p>
      <button id="bGo">Commencer</button>
      <button id="bBack" class="secondary">Retour</button>
    </div>`);
  document.getElementById("bGo").onclick = () => {
    session.timerSeconds = +document.getElementById("timerSel").value;
    session.mode = "local";
    state = E.newGame({ timerSeconds: session.timerSeconds });
    session.screen = "game";
    render();
  };
  document.getElementById("bBack").onclick = () => { session.screen = "menu"; render(); };
}

function renderOnlineChoice() {
  shell("Une partie en ligne relie deux navigateurs directement ; l'hôte doit rester connecté.", `
    <div class="card">
      ${session.error ? `<p class="small-note err">${esc(session.error)}</p>` : ""}
      <label for="nameIn">Votre nom</label><input type="text" id="nameIn" placeholder="Votre nom" value="${esc(session.hostName || "")}">
      <button id="bHost">Créer une partie</button>
      <button id="bJoin" class="secondary">Rejoindre une partie</button>
      <button id="bBack" class="secondary">Retour</button>
    </div>`);
  document.getElementById("bHost").onclick = () => {
    unlockAudio();
    session.hostName = document.getElementById("nameIn").value.trim() || "Hôte";
    startHosting();
  };
  document.getElementById("bJoin").onclick = () => {
    session.guestName = document.getElementById("nameIn").value.trim() || "Invité";
    session.screen = "guest-join"; render();
  };
  document.getElementById("bBack").onclick = () => { session.screen = "menu"; render(); };
}

function makeRoomCode() {
  let c = "";
  for (let i = 0; i < 5; i++) c += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  return c;
}

// --------------------------------------------------------------------- hôte --
function startHosting() {
  session.isHost = true;
  session.mode = "online";
  session.mySide = session.mySide || "SM";
  session.roomCode = makeRoomCode();
  session.screen = "host-lobby";
  session.error = null;
  render();
  openPeer(PEER_ID_PREFIX + session.roomCode, (peer) => {
    peer.on("connection", (conn) => {
      conn.on("open", () => {
        if (session.guestConn) { conn.close(); return; }
        session.guestConn = conn;
        conn.on("data", (msg) => onHostMessage(msg));
        conn.on("close", () => {
          session.guestConn = null;
          session.guestName = "";
          if (session.screen === "game") showToast("L'adversaire s'est déconnecté. Il peut rejoindre à nouveau avec le même code.");
          else render();
        });
      });
    });
    render();
  });
}

function onHostMessage(msg) {
  if (msg.type === "join") {
    session.guestName = msg.name || "Invité";
    if (state && session.screen === "game") {
      // reconnexion en cours de partie
      session.guestConn.send({ type: "welcome", side: otherSide() });
      broadcastState();
    } else render();
  } else if (msg.type === "action") {
    if (!state) return;
    const err = E.applyAction(state, msg.kind, msg.payload, otherSide());
    if (err) session.guestConn && session.guestConn.send({ type: "error", text: err });
    broadcastState();
  }
}
function otherSide() {
  return session.mySide === "SM" ? "GS" : "SM";
}

function broadcastState() {
  if (session.guestConn && state) session.guestConn.send({ type: "state", view: E.viewFor(state, otherSide()) });
  render();
}

function renderHostLobby() {
  const ready = !!session.guestConn;
  shell("Donnez ce code à votre adversaire.", `
    <div class="card">
      <p>Code de la partie : <strong style="font-family:var(--font-data);font-size:1.4rem;letter-spacing:0.1em">${session.peer && session.peer.open ? session.roomCode : "…"}</strong></p>
      <label>Vous commandez</label>
      <div class="choice-row">
        <label><input type="radio" name="side" value="SM" ${session.mySide === "SM" ? "checked" : ""}> l'escouade</label>
        <label><input type="radio" name="side" value="GS" ${session.mySide === "GS" ? "checked" : ""}> les Xénos</label>
      </div>
      ${timerSelect("timerSel")}
      <p class="small-note">${ready ? `${esc(session.guestName)} est connecté et jouera ${otherSide() === "SM" ? "l'escouade" : "les Xénos"}.` : "En attente de l'adversaire…"}</p>
      <button id="bStart" ${ready ? "" : "disabled"}>Lancer la partie</button>
      <button id="bCancel" class="secondary">Annuler</button>
    </div>`);
  document.querySelectorAll('input[name=side]').forEach((r) => r.onchange = (e) => { session.mySide = e.target.value; render(); });
  document.getElementById("timerSel").onchange = (e) => { session.timerSeconds = +e.target.value; };
  document.getElementById("bStart").onclick = () => {
    state = E.newGame({ timerSeconds: session.timerSeconds });
    session.screen = "game";
    session.guestConn.send({ type: "welcome", side: otherSide() });
    broadcastState();
  };
  document.getElementById("bCancel").onclick = () => resetToMenu();
}

// ------------------------------------------------------------------- invité --
function renderGuestJoin() {
  shell("Entrez le code donné par l'hôte.", `
    <div class="card">
      ${session.error ? `<p class="small-note err">${esc(session.error)}</p>` : ""}
      <label for="codeIn">Code de la partie</label><input type="text" id="codeIn" placeholder="ex. K7Q2M" autocomplete="off">
      <button id="bGo">Rejoindre</button>
      <button id="bBack" class="secondary">Retour</button>
    </div>`);
  document.getElementById("bGo").onclick = () => {
    unlockAudio();
    const code = document.getElementById("codeIn").value.trim().toUpperCase();
    if (code) joinRoom(code);
  };
  document.getElementById("bBack").onclick = () => { session.screen = "online-choice"; render(); };
}

function joinRoom(code) {
  session.isHost = false;
  session.mode = "online";
  session.error = null;
  openPeer(null, (peer) => {
    const conn = peer.connect(PEER_ID_PREFIX + code, { reliable: true });
    session.hostConn = conn;
    conn.on("open", () => {
      conn.send({ type: "join", name: session.guestName });
      session.screen = "guest-lobby";
      render();
    });
    conn.on("data", onGuestMessage);
    conn.on("close", () => resetToMenu("La connexion avec l'hôte a été perdue."));
    conn.on("error", () => { session.error = "Impossible de rejoindre cette partie."; session.screen = "guest-join"; render(); });
  });
}

function onGuestMessage(msg) {
  if (msg.type === "welcome") session.mySide = msg.side;
  else if (msg.type === "state") {
    session.view = msg.view;
    session.timerDeadline = msg.view.timer.remaining != null ? Date.now() + msg.view.timer.remaining : null;
    session.screen = "game";
    render();
  } else if (msg.type === "error") showToast(msg.text);
}

function renderGuestLobby() {
  shell("Connecté. L'hôte choisit les camps et lance la partie.", `<div class="card"><p class="small-note">En attente du lancement…</p><button id="bCancel" class="secondary">Quitter</button></div>`);
  document.getElementById("bCancel").onclick = () => resetToMenu();
}

// ---------------------------------------------------------------- plomberie --
function openPeer(id, onReady) {
  if (typeof Peer === "undefined") {
    session.error = "La bibliothèque réseau n'a pas pu être chargée.";
    session.screen = "online-choice";
    return render();
  }
  const peer = id ? new Peer(id) : new Peer();
  session.peer = peer;
  peer.on("open", () => onReady(peer));
  peer.on("error", (err) => {
    if (err.type === "unavailable-id" && id) {
      session.roomCode = makeRoomCode();
      peer.destroy();
      return openPeer(PEER_ID_PREFIX + session.roomCode, onReady);
    }
    if (err.type === "peer-unavailable") session.error = "Aucune partie avec ce code.";
    else session.error = "Erreur réseau : " + err.type;
    session.screen = session.isHost ? "online-choice" : "guest-join";
    render();
  });
}

function resetToMenu(err) {
  if (session.peer) try { session.peer.destroy(); } catch (e) { /* rien */ }
  const keepTimer = session.timerSeconds;
  state = null;
  session = freshSession(err);
  session.timerSeconds = keepTimer;
  ui.sel = null; ui.mode = "move";
  render();
}

render();
