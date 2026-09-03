/*
 * The Pencil — Ellie's alternative pencil as software.  v1
 *
 * Method rules (CLfA ch.9 + her literacy specialist's flip-book protocol — do not "improve"):
 *  - HER words, exactly as she spells them. No autocorrect, no spellcheck marks,
 *    no machine fixes, ever. Invented spelling is data and voice, not error.
 *  - The flip book she knows: letter GROUP pages -> letters -> back to groups.
 *  - THE RING layout (dad, 7/31): the alphabet wraps the page edges; abcd holds the
 *    left seat (back replaces it on letter pages); letters own the whole bottom edge;
 *    the black center block is her rest spot AND the gaze park (/app/park, transient).
 *  - Word prediction is the one endorsed support (phonetic-tolerant, personal
 *    lexicon first). Selecting a prediction is HER choice, never automatic.
 *  - TTS echoes what she writes (letter -> word -> text) — self-monitoring,
 *    not correction: "Does that sound like what I meant to write?"
 *  - Publishing is the point: writing goes to an audience that writes back.
 *  - Wait time sacred; nothing times out; rest spot always safe; door always there.
 */
"use strict";
// lib/contract.js values via the index.html shim — the whitelist, not copies.
const EC = window.EllieContract.CONTRACT;

// ---------- state ----------
const S = {
  words: [],            // committed words (exactly as she wrote them)
  partial: "",          // current word in progress
  page: "groups",       // groups | letters:<idx>
  session: "s" + Date.now(),
  tts: true, paused: false,
  sendReady: true, mailChecked: false,   // Send is live until the hub says there's no email (dad 9/2)
  lastActionAt: Date.now(), nudges: 0
};

// Vowel-anchored pages, matching her literacy specialist's flip-book protocol (one vowel
// landmark per page). CONFIRM against her physical book with the specialist before school use.
const GROUPS = [           // her flip book's actual pages (dad, Jul 2026)
  ["a","b","c","d"],
  ["e","f","g","h"],
  ["i","j","k","l","m","n"],
  ["o","p","q","r","s","t"],
  ["u","v","w","x","y","z"]
];
const VOWELS = "aeiou";
const $ = id => document.getElementById(id);

// ---------- lexicon: personal words first, then common words (child-relevant) ----------
// PERSONAL mirrors ../../personal-lexicon.json (the server /predict copy) — this
// embedded copy is the OFFLINE fallback; update both together.
// personal words come from the family profile via /settings (personalWords);
let PERSONAL = ["mom", "dad"];  // neutral fallback until settings load
const COMMON = ("the and a to said in he I of it was you they on she is for at his but that with all we can " +
  "are up had my her what there out this have went be like some so not then were go little as no one " +
  "them do me down dad big when it's see looked very look don't come will into back from children him get " +
  "just now came oh about got their people your put could house old too by day made time I'm if help " +
  "found here off asked saw make an play let good want us away eat our home who new can't again cat " +
  "long things new after wanted ran know bear did man going where would or took think dog than around " +
  "other food fox through way been stop must red door right sea these began boy animals never next first " +
  "work lots need that's baby fish gave mouse something bed may still found live say soon night " +
  "small car couldn't three head king town I've around every garden fast only many laughed let's much " +
  "suddenly told another great why cried keep room last jumped because even am before clothes tell " +
  "key fun place mother sat boat window sleep feet morning queen each book its green different let girl " +
  "which inside run any under hat snow air trees bad tea top eyes fell friends box dark there's " +
  "looking end than best better hot sun across gone hard really wind wish eggs once please thing " +
  "stopped ever miss most cold park lived birds duck horse rabbit white coming he's river liked giant " +
  "looks use along plants dragon pulled we're fly grow water bag ball bat cap hand sand band land camp " +
  "lamp jam nap map tap rat hat sat fat mat pan fan man tan ran sing ring king wing swing thing spring " +
  "stand hands think thanks jump jumping wish wishing shop shopping smart start star chart card yard").split(/\s+/);

const LEX = [];
function rebuildLex() {   // PERSONAL can arrive/refresh from /settings (profile)
  LEX.length = 0;
  const seen = new Set();
  PERSONAL.forEach((w, i) => { const k = w.toLowerCase(); if (!seen.has(k)) { seen.add(k); LEX.push({ w, rank: i, personal: true }); } });
  COMMON.forEach((w, i) => { const k = w.toLowerCase(); if (!seen.has(k)) { seen.add(k); LEX.push({ w, rank: 1000 + i, personal: false }); } });
}
rebuildLex();
// ---- phonetic tolerance for invented spelling (rules, not hardcoded words) ----
// Children spell by SOUND: "frend"->friend, "bfday"->birthday. A standard phonetic
// algorithm (metaphone) models adult misspellings; this key models child phonology:
// digraph collapse, th->f fronting, soft-c, vowel omission — then SUBSEQUENCE match
// (kids drop letters: unstressed vowels, post-vocalic r) against the lexicon keys.
function kidKey(s) {
  let k = s.toLowerCase()
    .replace(/ph/g, "f").replace(/wh/g, "w").replace(/ck/g, "k").replace(/qu/g, "kw")
    .replace(/th/g, "f")                     // fronting: birthday ~ birfday
    .replace(/c(?=[eiy])/g, "s").replace(/c/g, "k")
    .replace(/x/g, "ks").replace(/z/g, "s").replace(/q/g, "k")
    .replace(/(.)\1+/g, "$1");              // collapse doubles
  // drop vowels except a leading one (kids keep the sounds they hear: consonant skeleton)
  k = k[0] + k.slice(1).replace(/[aeiouy]/g, "");
  return k;
}
function isSubseq(small, big) {
  let i = 0;
  for (const ch of big) if (ch === small[i]) i++;
  return i >= small.length;
}
function predictions(partial) {
  if (!partial) return [];
  const p = partial.toLowerCase();
  const pk = kidKey(p);
  // tiers: literal prefix > kid-key prefix > kid-key subsequence (needs >=3 chars)
  const t1 = [], t2 = [], t3 = [];
  for (const x of LEX) {
    const wl = x.w.toLowerCase();
    if (wl.startsWith(p)) { t1.push(x); continue; }
    const wk = kidKey(wl);
    if (wk.startsWith(pk)) { t2.push(x); continue; }
    if (p.length >= 3 && isSubseq(pk, wk)) t3.push(x);
  }
  // MATCH QUALITY OUTRANKS OWNERSHIP (7/31 fix): a literal-prefix hit always
  // beats a phonetic guess — "be" must offer be/bear, not Luna/boots. Personal
  // words still win ties WITHIN a tier.
  const tag = (arr, t) => arr.map(x => ({ ...x, t }));
  const hits = tag(t1, 0).concat(tag(t2, 1), tag(t3, 2))
    .sort((a, b) => a.t - b.t || (a.personal === b.personal ? a.rank - b.rank : a.personal ? -1 : 1));
  const out = [], seen = new Set();
  for (const h of hits) {
    const k = h.w.toLowerCase(); if (seen.has(k)) continue; seen.add(k);
    out.push(h.w); if (out.length >= 3) break;
  }
  return out;
}

// ---------- server-assisted prediction (n-gram on the family server) ----------
// The server layers HER OWN WRITING > her lexicon > a children's-classics
// bigram model, and adds true NEXT-WORD prediction ("I like ___") that the
// local engine can't do. The local engine above stays: it is the offline
// fallback AND the invented-spelling layer (kidKey) the server doesn't have.
// SINGLE-PAINT LAW: slots render rested instantly, then fill exactly once
// (<=250ms) — prediction text never swaps under a dwell already in progress.
let predSeq = 0;
function fetchServerPreds(left, prefix) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), EC.prediction.singlePaintMs);
  return fetch("/predict?left=" + encodeURIComponent(left) +
               "&prefix=" + encodeURIComponent(prefix) + "&n=3", { signal: ctl.signal })
    .then(r => r.ok ? r.json() : null)
    .then(j => (j && Array.isArray(j.words)) ? j.words : null)
    .catch(() => null)
    .finally(() => clearTimeout(t));
}

// ---------- logging ----------
function log(event, detail) {
  fetch("/log", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ t: Date.now(), session: S.session, app: "pencil", event, ...detail }) }).catch(() => {});
}

// ---------- speech (shared layer) ----------
function say(text, opts) {
  if (!S.tts || !window.Speech) return Promise.resolve();
  return Speech.say(text, (opts && opts.kind) || "long");
}
const LETTER_NAMES = { a:"ay", b:"bee", c:"see", d:"dee", e:"ee", f:"eff", g:"jee",
  h:"aitch", i:"eye", j:"jay", k:"kay", l:"ell", m:"em", n:"en", o:"oh", p:"pee",
  q:"cue", r:"are", s:"ess", t:"tee", u:"you", v:"vee", w:"double you", x:"ex",
  y:"why", z:"zee" };
const LETTER_SOUNDS = { a:"ah", b:"buh", c:"kuh", d:"duh", e:"eh", f:"fff", g:"guh",
  h:"huh", i:"ih", j:"juh", k:"kuh", l:"lll", m:"mmm", n:"nnn", o:"oh", p:"puh",
  q:"kwuh", r:"rrr", s:"sss", t:"tuh", u:"uh", v:"vvv", w:"wuh", x:"ks", y:"yuh", z:"zzz" };
function sayLetter(L) {
  if (!S.tts || !window.Speech) return Promise.resolve();
  const k = L.toLowerCase();
  // her pairing: name then sound ("C, cuh")
  return Speech.say((LETTER_NAMES[k] || L) + ", " + (LETTER_SOUNDS[k] || ""), "letter");
}
function soundOutPartial(w) { return w.toLowerCase().split("").map(c => LETTER_SOUNDS[c] || c).join(", "); }

// ---------- rendering ----------
function renderText() {
  const t = $("text");
  t.innerHTML = "";
  for (const w of S.words) {
    const s = document.createElement("span"); s.className = "word"; s.textContent = w;
    t.appendChild(s);
  }
  if (S.partial) {
    const s = document.createElement("span"); s.className = "word partial"; s.textContent = S.partial;
    t.appendChild(s);
  }
  const c = document.createElement("span"); c.id = "caret"; t.appendChild(c);
  $("paper").scrollTop = $("paper").scrollHeight;
  renderPredictions();
  saveDraft();
}
function paintPredictions(words) {
  const box = $("predict"); box.innerHTML = "";
  for (let i = 0; i < 3; i++) {
    const d = document.createElement("div");
    if (words[i]) {
      // 2000ms: inserting a whole word is a bigger commitment than deleting a letter;
      // reading a prediction must not become selecting it (review P1-1)
      d.className = "pword dwell"; d.setAttribute("data-dwell-ms", String(EC.prediction.holdMs));
      const w = words[i];
      d.textContent = w;
      d.addEventListener("click", () => pickPrediction(w));
    } else d.className = "pword rested";
    box.appendChild(d);
  }
}
function renderPredictions() {
  // predictions live only on the groups page (she returns there after every letter);
  // slots are ALWAYS three — filled or rested — so nothing ever shifts under her gaze
  if (S.page !== "groups") { paintPredictions([]); return; }
  const local = predictions(S.partial);
  const my = ++predSeq;
  paintPredictions([]);                      // rested while we ask (single paint below)
  const left = S.words.slice(-2).join(" ");
  fetchServerPreds(left, S.partial).then(server => {
    if (my !== predSeq) return;              // she already acted — stale answer, drop it
    if (!server) { paintPredictions(local); return; }   // offline: local engine carries it
    // interleave, dedupe. MID-WORD the local engine leads: its phonetic tolerance
    // is the method's invented-spelling support ("kat" must offer cat — a literal
    // server would drown it in kate/katie). For NEXT-WORD the server leads: only
    // it has sentence context.
    const pairs = S.partial ? [local, server] : [server, local];
    const out = [], seen = new Set();
    for (let i = 0; i < 3; i++) for (const src of pairs) {
      const w = src[i];
      if (!w || seen.has(w.toLowerCase()) || out.length >= 3) continue;
      seen.add(w.toLowerCase()); out.push(w);
    }
    paintPredictions(out);
  });
}

// One line for 4-letter groups; 6-letter groups stack two lines so every letter
// keeps >=84px (the 74px floor rules out a single squeezed line — contract #20).
function groupLabel(g) {
  const sp = L => VOWELS.includes(L) ? `<span class="v">${L}</span>` : L;
  if (g.length <= 4) return `<span>${g.map(sp).join(" ")}</span>`;
  const half = Math.ceil(g.length / 2);
  return `<span>${g.slice(0, half).map(sp).join(" ")}<br>${g.slice(half).map(sp).join(" ")}</span>`;
}
// Bottom-row group widths mirror the ring columns above them (left col / center / right col)
const GROUP_WIDTHS = ["24%", "28.1%", "28.1%", "19.8%"];
function renderGroups() {
  S.page = "groups";
  const seat = $("seatA");                       // abcd holds the left seat
  seat.classList.remove("back");
  seat.removeAttribute("data-dwell-ms");   // content default — partner tuning applies
  seat.innerHTML = groupLabel(GROUPS[0]);
  const b = $("rowBottom"); b.innerHTML = "";
  GROUPS.slice(1).forEach((g, ix) => {
    const d = document.createElement("div");
    d.className = "cell dwell gcell" + (g.length <= 4 ? " one" : "");
    d.style.flex = "0 0 " + GROUP_WIDTHS[ix];
    d.innerHTML = groupLabel(g);
    d.addEventListener("click", () => openGroup(ix + 1));
    b.appendChild(d);
  });
  renderPredictions();
}
function openGroup(i) {
  S.page = "letters:" + i;
  log("group", { group: GROUPS[i].join("") });
  const seat = $("seatA");                       // back takes the abcd seat
  seat.classList.add("back");
  seat.setAttribute("data-dwell-ms", String(EC.holds.navMin));
  seat.innerHTML = "<span>↩ back</span>";
  const b = $("rowBottom"); b.innerHTML = "";
  for (const L of GROUPS[i]) {
    const d = document.createElement("div");
    d.className = "cell dwell lcell" + (VOWELS.includes(L) ? " vowel" : "");
    d.style.flex = "1";                          // letters own the whole bottom edge
    d.textContent = L;
    d.addEventListener("click", () => pickLetter(L));
    b.appendChild(d);
  }
  renderPredictions();
  say(GROUPS[i].join(", "));
}
// The seat is one persistent element so its position is motor-planned forever:
// on the groups page it opens abcd; on a letter page it steps back out.
function seatAction() {
  if (S.page === "groups") openGroup(0);
  else { if (window.Speech) Speech.stop(); log("back", {}); renderGroups(); }
}

// ---------- writing actions ----------
async function pickLetter(L) {
  if (S.paused) return;
  if (window.Speech) Speech.stop();   // barge-in: her action wins over our audio
  S.partial += L;
  S.lastActionAt = Date.now();
  log("letter", { letter: L, partial: S.partial });
  renderText();
  renderGroups();               // flip back to groups after each letter (her flip-book rhythm)
  await sayLetter(L);
  if (S.partial.length > 1) Speech.say("So far you have: " + soundOutPartial(S.partial) + ".", "long");
}
async function endWord() {
  if (S.paused) return;
  if (window.Speech) Speech.stop();   // barge-in: her action wins over our audio
  if (!S.partial) return;       // no-op stays silent (review P2-7)
  const w = S.partial;
  S.words.push(w); S.partial = "";
  S.lastActionAt = Date.now();
  log("word", { word: w, predicted: false });
  renderText();
  await say(w);                 // her word, exactly as she wrote it
}
async function pickPrediction(w) {
  if (S.paused) return;
  if (window.Speech) Speech.stop();   // barge-in: her action wins over our audio
  const was = S.partial;
  S.words.push(w); S.partial = "";
  S.lastActionAt = Date.now();
  log("word", { word: w, predicted: true, from: was });
  renderText();
  await say(w);
}
async function backspace() {
  if (S.paused) return;
  if (window.Speech) Speech.stop();   // barge-in: her action wins over our audio
  S.lastActionAt = Date.now();
  if (S.partial) { S.partial = S.partial.slice(0, -1); log("backspace", { level: "letter" }); }
  else if (S.words.length) {
    const popped = S.words.pop();
    if (popped.includes(" ")) { log("backspace", { level: "word", atomic: popped }); }  // multiword lexicon entries delete whole
    else { S.partial = popped.slice(0, -1); log("backspace", { level: "word" }); }
  }
  renderText();
  // quiet echo of where she now is — the one action that had no voice (review P2-3)
  if (S.partial) sayLetter(S.partial[S.partial.length - 1]); else say("took one away");
}
async function readAll() {
  if (S.paused) return;
  if (window.Speech) Speech.stop();   // barge-in: her action wins over our audio
  const t = (S.words.join(" ") + " " + S.partial).trim();
  log("read", { length: t.length });
  await say(t ? t : "Nothing yet. Your page is ready for you.");
}
// Two-stage send (review P1-3): send -> confirm screen -> deliver.
// State is cleared SYNCHRONOUSLY before any screen/speech (review P0-1), and
// delivery is confirmed or the message is queued — never lost (review P0-2).
async function publish() {
  if (S.paused) return;
  const text = (S.words.join(" ") + " " + S.partial).trim();
  if (!text) { await say("Write something first — anything you like!"); return; }
  log("send_confirm_shown", { text });
  $("confirmSub").textContent = "“" + text + "”";
  showScreen("sConfirm");
  await say(`You wrote: ${text}. Send it to your family?`);
}
async function confirmSend() {
  const text = (S.words.join(" ") + " " + S.partial).trim();
  if (!text) { showScreen("page"); return; }
  // --- synchronous state boundary: nothing after this can double-send or resurrect ---
  S.words = []; S.partial = "";
  localStorage.removeItem("pencil_draft");
  renderText();
  log("publish", { text });
  const msg = { t: Date.now(), session: S.session, text };
  // The hub answers with the truth (audit 9/2): {mailed:true} means a real
  // email was accepted; "not configured" means no family email is set up yet
  // and her words wait in Settings; "failed" means the hub keeps retrying.
  // Before this, every family heard "Sent!" whether or not anything was.
  let delivered = false, mailed = false, reason = "";
  try {
    const res = await fetch("/publish", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(msg) });
    delivered = res.ok;
    if (res.ok && res.status !== 204) {
      try { const j = await res.json(); mailed = !!j.mailed; reason = j.reason || ""; } catch {}
    } else mailed = res.ok;
  } catch { delivered = false; }
  if (!delivered) {
    // keep it safe, tell her honestly (never her fault), retry on next boot
    try {
      const box = JSON.parse(localStorage.getItem("pencil_outbox") || "[]");
      box.push(msg); localStorage.setItem("pencil_outbox", JSON.stringify(box));
    } catch {}
    $("ttsWarn").textContent = "⚠ Message saved but NOT sent yet (no connection). It will send automatically.";
    $("ttsWarn").classList.add("show");
    log("publish_queued", { text });
    $("doneTitle").textContent = "Saved! 💾";
    $("doneSub").textContent = "“" + text + "” — I'm keeping your words safe and will send them soon.";
    showScreen("sDone");
    await say("I'm keeping your words safe, and I'll send them to your family as soon as I can.");
    return;
  }
  if (!mailed && reason === "not configured") {
    log("publish_saved", { text, reason });
    $("doneTitle").textContent = "Saved for your family! 📖";
    $("doneSub").textContent = "“" + text + "” — they can read it in Settings.";
    showScreen("sDone");
    confetti(20);
    await say("Saved! Your family can read your words. " + text);
    return;
  }
  if (!mailed) {
    log("publish_saved", { text, reason });
    $("doneTitle").textContent = "Saved! 💾";
    $("doneSub").textContent = "“" + text + "” — I'm keeping your words safe and will send them soon.";
    showScreen("sDone");
    await say("I'm keeping your words safe, and I'll send them to your family as soon as I can.");
    return;
  }
  $("doneTitle").textContent = "Sent! ✉";
  $("doneSub").textContent = "“" + text + "”";
  showScreen("sDone");
  confetti(20);
  await say("Sent! Your words are on their way to your family. " + text);
}
// ---------- Send needs an email on file (dad 9/2) ----------
// "Send should be grayed out if there is not an email on file." Until Settings
// holds BOTH the family address and a working key, the Send tile is greyed and
// inert (data-dwell-disabled — the dwell engine's own skip; gaze, tap and
// keyboard all pass it by), so the tile never promises a send it can't make.
// Re-asked every 30s so it lights up the moment the family finishes setup,
// with no relaunch (the reader's 9/2 "never notices" bug). If the hub can't
// answer at all, Send stays ON: confirmSend's outbox is the honest path there.
const MAIL_POLL_MS = 30000;
function setSendReady(on) {
  S.sendReady = on;
  const b = $("btnSend");
  b.classList.toggle("is-disabled", !on);
  b.setAttribute("aria-disabled", on ? "false" : "true");
  if (on) b.removeAttribute("data-dwell-disabled");
  else b.setAttribute("data-dwell-disabled", "");
}
async function syncSendGate() {
  try {
    const m = await (await fetch("/mail-config")).json();
    setSendReady(!!(m.email && m.hasKey));
  } catch { setSendReady(true); }     // hub unreachable — the outbox keeps her words safe
  S.mailChecked = true;
}
// test hook (the reader's window.Reader pattern) — the send gate is the only
// state a suite needs to see from outside.
window.Pencil = { state: () => ({ sendReady: S.sendReady, mailChecked: S.mailChecked }), syncSendGate };
async function flushOutbox() {
  let box = [];
  try { box = JSON.parse(localStorage.getItem("pencil_outbox") || "[]"); } catch {}
  if (!box.length) return;
  const still = [];
  for (const msg of box) {
    try {
      const res = await fetch("/publish", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(msg) });
      if (!res.ok) still.push(msg); else log("outbox_flushed", { text: msg.text });
    } catch { still.push(msg); }
  }
  localStorage.setItem("pencil_outbox", JSON.stringify(still));
}

// ---------- drafts (crash-proof) ----------
function saveDraft() {
  try {
    if (!S.words.length && !S.partial) { localStorage.removeItem("pencil_draft"); return; }
    localStorage.setItem("pencil_draft", JSON.stringify({ words: S.words, partial: S.partial }));
  } catch {}
}
function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem("pencil_draft") || "null");
    if (d && (d.words.length || d.partial)) { S.words = d.words; S.partial = d.partial; return true; }
  } catch {}
  return false;
}

// ---------- screens ----------
function showScreen(id) {
  $("sDone").classList.remove("show");
  $("sConfirm").classList.remove("show"); $("sClearConfirm").classList.remove("show");
  $("page").style.display = "none";
  if (id === "page") $("page").style.display = "flex";
  else $(id).classList.add("show");
  // ring chrome (door/clear/delete/...) lives inside #page — hidden pages are inert
}

// ---------- gentle nudges (writing is hers; we barely whisper) ----------
setInterval(() => {
  if (S.paused || $("page").style.display === "none") return;
  // writing pauses are THINKING: 120s, once, and never while a dwell is in progress
  if (window.Dwell && Dwell.state().target) return;
  const idle = Date.now() - S.lastActionAt;
  if (idle > 120000 && S.nudges === 0) { S.nudges = 1; S.lastActionAt = Date.now(); log("nudge", { n: 1 });
    say("I'm here. Write anything you like — or just rest."); }
}, 7000);

// ---------- partner strip ----------
$("partnerTab").addEventListener("click", () => $("partner").classList.toggle("show"));
$("pClose").addEventListener("click", () => $("partner").classList.remove("show"));
$("pVoice").addEventListener("click", async () => { log("partner", { action: "voice" }); await Speech.cycleVoice(); });
$("pPause").addEventListener("click", () => {
  S.paused = !S.paused; window.Dwell && (S.paused ? Dwell.disable() : Dwell.enable());
  $("pPause").textContent = S.paused ? "▶ resume" : "⏸ pause";
  log("partner", { action: S.paused ? "pause" : "resume" });
});
$("pRead").addEventListener("click", readAll);
$("pUndoWord").addEventListener("click", () => { if (S.words.length) { S.words.pop(); renderText(); log("partner", { action: "undo_word" }); } });
$("pEasier").addEventListener("click", () => tuneDwell(+200));
$("pFaster").addEventListener("click", () => tuneDwell(-200));
function tuneDwell(d) {
  const ms = Math.max(EC.holds.floor, Math.min(EC.holds.tuneMax, (window.Dwell ? Dwell.config.ms : EC.holds.content) + d));
  if (window.Dwell) Dwell.setMs(ms);
  log("partner", { action: "dwell", ms });
}
$("pPublish").addEventListener("click", publish);
$("pClear").addEventListener("click", () => {
  S.words = []; S.partial = ""; renderText(); log("partner", { action: "new_page" });
});

// ---------- door (ring door + start-screen door share it) ----------
async function exitDoor() {
  log("door", {});
  await say("Okay — pencil down. Your writing is saved. Bye bye!");
  // EXIT DOOR (phase 4.1): the hub decides where the door goes (Settings,
  // dad 9/3: TD Snap or New ERA) and clears the /app/park override either
  // way — the corner park returns. "closed" = ERAgaze took the screen and
  // this kiosk is closing; anything else = the hub's home in this window
  // (draft persists in localStorage).
  let action = "home";
  try { action = (await (await fetch("/kiosk/exit", { method: "POST" })).json()).action; } catch {}
  if (action === "closed") return;
  location.href = "/home/";
}
$("door").addEventListener("click", exitDoor);

// ---------- park: the black rest block is the gaze park spot ----------
// Transient override in the engine (memory only, cleared by /app/exit), so
// Making Words / AsTeRICS keep their corner park untouched.
function tellPark() {
  try {
    const r = $("restBlock").getBoundingClientRect();
    if (!r.width) return;                       // page not visible yet
    const x = +((r.left + r.width / 2) / innerWidth).toFixed(3);
    const y = +((r.top + r.height / 2) / innerHeight).toFixed(3);
    fetch("http://127.0.0.1:49155/app/park", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x, y }) }).catch(() => {});
  } catch {}
}
addEventListener("resize", tellPark);

// ---------- confetti (lib/celebrate.js via the shim — one module for the suite) ----------
function confetti(n) { try { window.EllieCelebrate.confetti(n); } catch {} }

// ---------- boot ----------
// Direct entry (D48, dad 8/5): TD Snap → the paper, no start gate. The page paints
// FIRST (she can write immediately); settings + speech follow async — the kiosk's
// --autoplay-policy flag covers speech init without a user gesture.
async function bootSession() {
  const resumed = loadDraft();
  showScreen("page");
  renderGroups(); renderText();
  tellPark();                                   // rest block becomes the park spot
  syncSendGate();                               // grey Send out if no email is on file (dad 9/2)
  setInterval(syncSendGate, MAIL_POLL_MS);      // …and light it up when setup finishes, no relaunch
  try { const st = await (await fetch("/settings")).json(); if (st.dwellMs && window.Dwell) Dwell.setMs(st.dwellMs);
    if (st.childName) window.ERA_CHILD_NAME = st.childName;
    if (Array.isArray(st.personalWords) && st.personalWords.length) { PERSONAL = st.personalWords; rebuildLex(); } } catch {}
  const mode = await Speech.init("Time to write!");
  S.tts = mode !== "off";
  if (!S.tts) { $("ttsWarn").classList.add("show"); log("tts_failed", {}); }
  Speech.preload(Object.values(LETTER_NAMES).concat(["took one away"]));   // letter echoes: instant after first session
  log("session_start", { tts: S.tts, resumed });
  await say(resumed ? "Welcome back! Your writing is right where you left it."
                    : "What would you like to say today? Anything at all.");   // init already said hello
}
bootSession();
$("btnAgain").addEventListener("click", async () => {
  showScreen("page"); renderGroups(); renderText();
  await say("A fresh page! What next?");
});
$("btnConfirm").addEventListener("click", confirmSend);
$("seatA").addEventListener("click", seatAction);
$("btnSpace").addEventListener("click", endWord);
$("btnDel").addEventListener("click", backspace);
$("btnRead").addEventListener("click", readAll);
$("btnSend").addEventListener("click", () => {
  // greyed out with no email on file (dad 9/2): a tap, a gaze fire or a
  // keyboard activation all do nothing rather than promise a send. The partner
  // strip's ✉ publish still works — an adult choosing the Settings fallback
  // knows where her words go.
  if (!S.sendReady) { log("send_blocked", { reason: "no email on file" }); return; }
  publish();
});
$("clearAll").addEventListener("click", async () => {
  if (!S.words.length && !S.partial) { await say("Nothing to clear yet."); return; }
  log("clear_confirm_shown", {});
  showScreen("sClearConfirm");
  await say("Do you want to clear everything you wrote? This can't be undone.");
});
$("btnClearNo").addEventListener("click", async () => {
  log("clear", { choice: "keep" }); showScreen("page"); await say("Okay — keeping your writing!");
});
$("btnClearYes").addEventListener("click", async () => {
  S.words = []; S.partial = ""; saveDraft(); renderText();
  log("clear", { choice: "cleared" });
  showScreen("page");
  await say("All clear! A fresh page for you.");
});
$("btnKeep").addEventListener("click", async () => {
  log("send_confirm", { choice: "keep_writing" });
  showScreen("page");
  await say("Okay — keep writing!");
});
flushOutbox();
log("boot", {});
