"use strict";
/* ===================== Armazenamento ===================== */
const LS_CARDS = "anki.cards", LS_CFG = "anki.cfg";
const MIN = 60e3, DAY = 864e5;

let cards = load(LS_CARDS, []);
let cfg = Object.assign(
  { lang: "en-US", native: "pt-BR", voice: "", rate: 0.9, autoplay: true, reverse: false, newPerDay: 20, newDay: "", newCount: 0 },
  load(LS_CFG, {})
);
function load(k, def) { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } }

// Rastreio de alterações (usado pela sincronização com a conta): cada carta guarda "updated";
// "hashes" detecta o que mudou desde o último save e "tombs" guarda os ids apagados.
let hashes = load("anki.hashes", null), tombs = load("anki.tombs", []);
function cardHash(c) {
  const s = JSON.stringify(Object.keys(c).filter(k => k !== "updated").sort().map(k => [k, c[k]]));
  let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) | 0; return h;
}
function persistMeta() { localStorage.setItem("anki.hashes", JSON.stringify(hashes)); localStorage.setItem("anki.tombs", JSON.stringify(tombs)); }
if (!hashes) { hashes = {}; cards.forEach(c => { c.updated ??= c.created || Date.now(); hashes[c.id] = cardHash(c); }); persistMeta(); }
function saveCards() {
  const now = Date.now(), ids = new Set();
  for (const c of cards) { ids.add(c.id); const h = cardHash(c); if (hashes[c.id] !== h) { hashes[c.id] = h; c.updated = now; } }
  for (const id of Object.keys(hashes)) if (!ids.has(id)) { delete hashes[id]; tombs.push(id); }
  localStorage.setItem(LS_CARDS, JSON.stringify(cards)); persistMeta();
  window.onLocalChange?.();
}
function saveCfg(silent) { if (!silent) cfg.updated = Date.now(); localStorage.setItem(LS_CFG, JSON.stringify(cfg)); if (!silent) window.onLocalChange?.(); }

// Áudios gravados ficam no IndexedDB (cabe muito mais que o localStorage)
const idb = (() => {
  let dbp;
  const db = () => dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open("anki-audio", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("audio");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => {
    const t = d.transaction("audio", mode), req = fn(t.objectStore("audio"));
    t.oncomplete = () => res(req?.result); t.onerror = () => rej(t.error);
  }); };
  return {
    get: k => tx("readonly", s => s.get(k)),
    set: (k, v) => tx("readwrite", s => s.put(v, k)),
    del: k => tx("readwrite", s => s.delete(k)),
    all: () => tx("readonly", s => s.getAllKeys()),
  };
})();

const $ = s => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const today = () => new Date().toISOString().slice(0, 10);

/* ===================== Abas ===================== */
document.querySelectorAll("nav button").forEach(b => b.onclick = () => showTab(b.dataset.tab));
function showTab(id) {
  document.querySelectorAll("nav button").forEach(b => b.classList.toggle("active", b.dataset.tab === id));
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.id === id));
  if (id === "estudar") nextCard();
  if (id === "cartas") renderTable();
}

/* ===================== Áudio / voz ===================== */
let voices = [];
function loadVoices() {
  voices = speechSynthesis.getVoices();
  const pre = cfg.lang.slice(0, 2);
  const list = voices.filter(v => v.lang.replace("_", "-").startsWith(pre));
  const auto = useGoogle() ? "Google (online)" : pickVoice()?.name;
  $("#cfgVoice").innerHTML = `<option value="">Automática → ${esc(auto)}</option>` +
    `<option value="${GOOGLE}" ${cfg.voice === GOOGLE ? "selected" : ""}>Google (online)</option>` +
    list.map(v => `<option value="${esc(v.name)}" ${v.name === cfg.voice ? "selected" : ""}>${esc(v.name)} (${v.lang})</option>`).join("");
}

// Escolhe a melhor voz do idioma estudado (nunca cai na voz padrão em português)
function pickVoice() {
  if (!voices.length) voices = speechSynthesis.getVoices();
  const chosen = voices.find(v => v.name === cfg.voice);
  if (chosen) return chosen;
  const norm = l => l.replace("_", "-").toLowerCase();
  const exact = voices.filter(v => norm(v.lang) === cfg.lang.toLowerCase());
  const same = voices.filter(v => norm(v.lang).startsWith(cfg.lang.slice(0, 2).toLowerCase()));
  const pool = exact.length ? exact : same;
  const score = v => (/natural|neural/i.test(v.name) ? 4 : 0) + (/online|google/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
  return pool.sort((a, b) => score(b) - score(a))[0] || null;
}
const GOOGLE = "__google";
// Automático: voz "Natural"/"Online"/"Google" do navegador se houver; senão a voz online do Google (sempre no idioma certo)
function useGoogle() {
  if (cfg.voice === GOOGLE) return true;
  if (cfg.voice) return false;
  const v = pickVoice();
  return !v || !/natural|neural|online|google/i.test(v.name);
}
// Voz do Google Tradutor (grátis, sem chave). Textos longos são divididos em pedaços de até ~180 caracteres.
function googleChunks(text) {
  const parts = text.match(/[^.!?;,]+[.!?;,]*\s*/g) || [text], out = [];
  for (const p of parts) {
    const last = out.length - 1;
    if (last >= 0 && (out[last] + p).length <= 180) out[last] += p;
    else for (let i = 0; i < p.length; i += 180) out.push(p.slice(i, i + 180));
  }
  return out.map(s => s.trim()).filter(Boolean);
}
async function speakGoogle(text) {
  for (const chunk of googleChunks(text)) {
    player.src = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${cfg.lang.slice(0, 2)}&q=${encodeURIComponent(chunk)}`;
    player.playbackRate = cfg.rate;
    await player.play();
    await new Promise(res => { player.onended = res; player.onpause = res; player.onerror = res; });
    if (player.error) throw player.error;
  }
}
function speak(text) {
  if (!("speechSynthesis" in window)) return speakGoogle(text);
  speechSynthesis.cancel(); player.pause();
  // sem internet → voz local (NotAllowedError = navegador bloqueou autoplay antes do 1º clique; ignora)
  if (useGoogle()) return speakGoogle(text).catch(e => e?.name !== "NotAllowedError" && speakLocal(text));
  speakLocal(text);
}
function speakLocal(text) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = cfg.lang; u.rate = cfg.rate;
  const v = pickVoice();
  if (!v) return msgOnce(`Sem internet e nenhuma voz de ${cfg.lang} instalada no Windows (Configurações → Hora e idioma → Fala → Adicionar vozes).`);
  u.voice = v; speechSynthesis.speak(u);
}
let warned = false;
function msgOnce(t) { if (!warned) { warned = true; alert(t); } }
let player = new Audio();
async function playCard(c) {
  player.pause(); speechSynthesis?.cancel(); player.playbackRate = 1;
  if (c.rec) {
    let blob = await idb.get(c.id);
    if (!blob && window.fetchAudio) blob = await window.fetchAudio(c.id);  // baixa da conta se veio de outro aparelho
    if (blob) { player.src = URL.createObjectURL(blob); return player.play(); }
  }
  if (c.audioUrl) { player.src = c.audioUrl; return player.play().catch(() => speak(c.front)); }
  speak(c.front);
}

/* ===================== APIs grátis ===================== */
// Tradução: MyMemory (grátis, ~5.000 caracteres/dia sem cadastro)
async function translate(text, from = cfg.lang, to = cfg.native) {
  try { return await translateOnce(text, from, to); }
  catch { await new Promise(r => setTimeout(r, 1500)); return translateOnce(text, from, to); }  // tenta de novo uma vez
}
async function translateOnce(text, from, to) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from.slice(0, 2)}|${to}`;
  const r = await fetch(url); const j = await r.json();
  if (j.responseStatus !== 200 && j.responseStatus !== "200") throw new Error(j.responseDetails || "erro na tradução");
  return j.responseData.translatedText;
}
// Dicionário de inglês: áudio de pronúncia (voz humana) + exemplos
async function dictLookup(word) {
  const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
  if (!r.ok) return null;
  const j = await r.json(), e = j[0];
  const audio = e.phonetics?.map(p => p.audio).find(a => a?.includes("-us")) || e.phonetics?.map(p => p.audio).find(Boolean) || "";
  const defs = e.meanings.flatMap(m => m.definitions.map(d => ({ pos: m.partOfSpeech, def: d.definition, ex: d.example })));
  return { audio, defs, phonetic: e.phonetic || "" };
}
const isSingleEnglishWord = t => cfg.lang.startsWith("en") && /^[a-zA-Z'-]+$/.test(t.trim());

/* ===================== Repetição espaçada (SM-2 simplificado) ===================== */
function newCard(front, back, extra = {}) {
  return { id: uid(), front: front.trim(), back: (back || "").trim(), tags: "", created: Date.now(),
    due: Date.now(), interval: 0, ease: 2.5, reps: 0, lapses: 0, seen: false, ...extra };
}
function schedule(c, g, preview = false) {
  let { interval: iv, ease, reps, lapses } = c, due;
  if (g === 0) { lapses += reps > 0 ? 1 : 0; reps = 0; iv = 0; ease = Math.max(1.3, ease - 0.2); due = Date.now() + MIN; }
  else if (g === 1) {
    ease = Math.max(1.3, ease - 0.15);
    if (reps === 0) { iv = 0; due = Date.now() + 6 * MIN; }
    else { iv = Math.max(1, Math.round(iv * 1.2)); reps++; due = Date.now() + iv * DAY; }
  } else if (g === 2) {
    iv = reps === 0 ? 1 : reps === 1 ? 3 : Math.round(iv * ease); reps++; due = Date.now() + iv * DAY;
  } else {
    ease += 0.15; iv = reps === 0 ? 4 : Math.round(Math.max(iv, 1) * ease * 1.3); reps++; due = Date.now() + iv * DAY;
  }
  if (preview) return due - Date.now();
  Object.assign(c, { interval: iv, ease, reps, lapses, due, seen: true });
}
const fmt = ms => ms < 60 * MIN ? Math.round(ms / MIN) + " min" : ms < DAY ? Math.round(ms / 36e5) + " h" :
  ms < 30 * DAY ? Math.round(ms / DAY) + " d" : ms < 365 * DAY ? (ms / (30 * DAY)).toFixed(1) + " m" : (ms / (365 * DAY)).toFixed(1) + " a";

/* ===================== Estudar ===================== */
let current = null;
function resetDaily() { if (cfg.newDay !== today()) { cfg.newDay = today(); cfg.newCount = 0; saveCfg(); } }
function queue() {
  resetDaily();
  const now = Date.now();
  const review = cards.filter(c => c.seen && c.due <= now).sort((a, b) => a.due - b.due);
  const newLeft = Math.max(0, cfg.newPerDay - cfg.newCount);
  const fresh = cards.filter(c => !c.seen).sort((a, b) => a.created - b.created).slice(0, newLeft);
  // cartas em aprendizado que vencem nos próximos 20 min (pra não acabar a sessão no meio)
  const soon = cards.filter(c => c.seen && c.due > now && c.due < now + 20 * MIN && c.interval === 0).sort((a, b) => a.due - b.due);
  return { review, fresh, soon };
}
function nextCard() {
  const { review, fresh, soon } = queue();
  $("#stats").textContent = `Revisar: ${review.length} · Novas: ${fresh.length} · Total: ${cards.length} cartas`;
  current = review[0] || fresh[0] || soon[0] || null;
  $("#studyBox").classList.toggle("hidden", !current);
  $("#doneBox").classList.toggle("hidden", !!current);
  if (!current) return;
  const q = cfg.reverse ? current.back || "(sem tradução)" : current.front;
  $("#front").textContent = q;
  $("#back").classList.add("hidden"); $("#gradeRow").classList.add("hidden"); $("#showRow").classList.remove("hidden");
  $("#back").innerHTML = cfg.reverse
    ? `<div class="main">${esc(current.front)}</div>`
    : `<div class="main">${esc(current.back) || "<i>(sem tradução)</i>"}</div>`;
  if (current.tags) $("#back").innerHTML += `<p class="muted">🏷 ${esc(current.tags)}</p>`;
  [0, 1, 2, 3].forEach(g => $("#iv" + g).textContent = fmt(schedule(current, g, true)));
  if (cfg.autoplay && !cfg.reverse) playCard(current);
}
function reveal() {
  if (!current) return;
  $("#back").classList.remove("hidden"); $("#gradeRow").classList.remove("hidden"); $("#showRow").classList.add("hidden");
  if (cfg.autoplay && cfg.reverse) playCard(current);
}
function grade(g) {
  if (!current) return;
  if (!current.seen) { resetDaily(); cfg.newCount++; saveCfg(); }
  schedule(current, g); saveCards(); nextCard();
}
$("#showBtn").onclick = reveal;
$("#playBtn").onclick = () => current && playCard(current);
$("#gradeRow").onclick = e => { const b = e.target.closest("button"); if (b) grade(+b.dataset.g); };
document.addEventListener("keydown", e => {
  if (!$("#estudar").classList.contains("active") || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const answered = !$("#gradeRow").classList.contains("hidden");
  if (e.code === "Space") { e.preventDefault(); answered ? grade(2) : reveal(); }
  else if (e.key === "p" || e.key === "P") current && playCard(current);
  else if (answered && "1234".includes(e.key)) grade(+e.key - 1);
});

/* ===================== Adicionar ===================== */
let recBlob = null, recorder = null;
document.querySelectorAll("input[name=audioMode]").forEach(r => r.onchange = () =>
  $("#recBox").classList.toggle("hidden", r.value !== "rec" || !r.checked));
$("#btnSpeak").onclick = () => $("#inFront").value.trim() && speak($("#inFront").value);
$("#btnTranslate").onclick = async () => {
  const t = $("#inFront").value.trim(); if (!t) return;
  msg("#addMsg", "Traduzindo...");
  try { $("#inBack").value = await translate(t); msg("#addMsg", ""); } catch (e) { msg("#addMsg", "❌ " + e.message); }
};
$("#btnExample").onclick = async () => {
  const w = $("#inFront").value.trim();
  if (!isSingleEnglishWord(w)) return msg("#addMsg", "Digite UMA palavra em inglês para buscar exemplo.");
  msg("#addMsg", "Buscando...");
  try {
    const d = await dictLookup(w);
    if (!d) return msg("#addMsg", "Palavra não encontrada no dicionário.");
    const withEx = d.defs.find(x => x.ex);
    if (withEx) {
      $("#inFront").value = withEx.ex;
      $("#inBack").value = `${w} ${d.phonetic} (${withEx.pos}): ${withEx.def}`;
      try { $("#inBack").value = (await translate(withEx.ex)) + "\n— " + $("#inBack").value; } catch {}
      msg("#addMsg", "✅ Exemplo encontrado.");
    } else {
      $("#inBack").value = `${d.phonetic} (${d.defs[0].pos}): ${d.defs[0].def}`;
      msg("#addMsg", "Sem frase de exemplo; coloquei a definição.");
    }
  } catch (e) { msg("#addMsg", "❌ " + e.message); }
};
$("#btnRec").onclick = async () => {
  if (recorder?.state === "recording") return recorder.stop();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = []; recorder = new MediaRecorder(stream);
    recorder.ondataavailable = e => chunks.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      setRecBlob(new Blob(chunks, { type: recorder.mimeType })); $("#btnRec").textContent = "⏺ Gravar de novo";
    };
    recorder.start(); $("#btnRec").textContent = "⏹ Parar";
  } catch { alert("Não consegui acessar o microfone."); }
};
$("#audioFile").onchange = e => e.target.files[0] && setRecBlob(e.target.files[0]);
function setRecBlob(b) { recBlob = b; const p = $("#recPreview"); p.src = URL.createObjectURL(b); p.classList.remove("hidden"); }

$("#btnAdd").onclick = async () => {
  const front = $("#inFront").value.trim(); if (!front) return msg("#addMsg", "Escreva a frase.");
  let back = $("#inBack").value.trim();
  const mode = document.querySelector("input[name=audioMode]:checked").value;
  msg("#addMsg", "Salvando...");
  if (!back) { try { back = await translate(front); } catch {} }   // tradução automática se vazio
  const c = newCard(front, back, { tags: $("#inTags").value.trim() });
  if (mode === "rec" && recBlob) { await idb.set(c.id, recBlob); c.rec = true; }
  else if (isSingleEnglishWord(front)) { try { c.audioUrl = (await dictLookup(front))?.audio || ""; } catch {} }
  cards.push(c); saveCards();
  $("#inFront").value = $("#inBack").value = ""; recBlob = null; $("#recPreview").classList.add("hidden");
  $("#inFront").focus();
  msg("#addMsg", `✅ Adicionada! (${cards.length} cartas)`);
};
function msg(sel, t) { $(sel).textContent = t; }

/* ===================== Em lote ===================== */
$("#btnBulk").onclick = async () => {
  const lines = $("#bulkIn").value.split("\n").map(l => l.trim()).filter(Boolean);
  if (!lines.length) return;
  const btn = $("#btnBulk"); btn.disabled = true;
  let ok = 0, fail = 0;
  for (const [i, line] of lines.entries()) {
    let [front, back = ""] = line.split(/\t|;/).map(s => s.trim());
    if (!back && $("#bulkTranslate").checked) {
      msg("#bulkMsg", `Traduzindo ${i + 1}/${lines.length}...`);
      try { back = await translate(front); } catch { fail++; }
    }
    cards.push(newCard(front, back)); ok++;
  }
  saveCards(); btn.disabled = false; $("#bulkIn").value = "";
  msg("#bulkMsg", `✅ ${ok} cartas adicionadas` + (fail ? ` (${fail} sem tradução — limite diário da API?)` : ""));
};

/* ===================== Do áudio (transcrição com Whisper no navegador) ===================== */
let trBuf = null, trFile = null, trSegs = [], worker = null;
$("#trFile").onchange = e => {
  trFile = e.target.files[0]; if (!trFile) return;
  const p = $("#trPreview"); p.src = URL.createObjectURL(trFile); p.classList.remove("hidden");
  $("#trResult").classList.add("hidden"); msg("#trMsg", "");
};
async function decodeFile(file) {
  const ctx = new AudioContext();
  try { return await ctx.decodeAudioData(await file.arrayBuffer()); } finally { ctx.close(); }
}
// Whisper precisa de áudio mono a 16 kHz
async function to16kMono(buf) {
  const off = new OfflineAudioContext(1, Math.ceil(buf.duration * 16000), 16000);
  const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
  return (await off.startRendering()).getChannelData(0);
}
// Recorta um trecho e gera um arquivo WAV mono
function clipWav(buf, start, end) {
  const sr = buf.sampleRate, a = Math.max(0, Math.floor(start * sr)), b = Math.min(buf.length, Math.ceil(end * sr));
  const n = Math.max(0, b - a), chs = [...Array(buf.numberOfChannels).keys()].map(i => buf.getChannelData(i));
  const view = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); view.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sr, true); view.setUint32(28, sr * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, "data"); view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    let s = 0; for (const ch of chs) s += ch[a + i]; s = Math.max(-1, Math.min(1, s / chs.length));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view], { type: "audio/wav" });
}
function transcribe(audio) {
  worker ??= new Worker("whisper-worker.js", { type: "module" });
  return new Promise((res, rej) => {
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") msg("#trMsg", data.text);
      else if (data.type === "result") res(data); else rej(new Error(data.text));
    };
    worker.onerror = e => rej(new Error(e.message || "falha ao carregar o transcritor"));
    worker.postMessage({ audio, model: $("#trModel").value, lang: cfg.lang.slice(0, 2) }, [audio.buffer]);
  });
}
// O Whisper às vezes junta várias frases num trecho: divide pela pontuação e reparte o tempo pelo tamanho do texto
function splitSentences(text, start, end) {
  const parts = text.split(/(?<=[.!?。！？])\s+/).map(s => s.trim()).filter(Boolean);
  const total = parts.reduce((n, p) => n + p.length, 0) || 1;
  let t = start;
  return parts.map(p => { const d = (end - start) * p.length / total, seg = { text: p, start: t, end: t + d }; t += d; return seg; });
}
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
$("#btnTranscribe").onclick = async () => {
  if (!trFile) return msg("#trMsg", "Escolha um arquivo primeiro.");
  const btn = $("#btnTranscribe"); btn.disabled = true;
  try {
    msg("#trMsg", "Lendo o áudio...");
    trBuf = await decodeFile(trFile);
    const t0 = Date.now();
    const r = await transcribe(await to16kMono(trBuf));
    trSegs = $("#trSplit").checked && r.chunks.length
      ? r.chunks.flatMap(c => splitSentences(c.text.trim(), c.timestamp[0] ?? 0, c.timestamp[1] ?? trBuf.duration))
      : [{ text: r.text.trim(), start: 0, end: trBuf.duration, whole: true }];
    renderSegs();
    msg("#trMsg", `✅ ${trSegs.length} trecho(s) em ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  } catch (e) { msg("#trMsg", "❌ " + e.message); }
  btn.disabled = false;
};
function renderSegs() {
  $("#trResult").classList.remove("hidden");
  $("#trList").innerHTML = trSegs.map((s, i) => `<div class="seg" data-i="${i}">
    <input type="checkbox" checked>
    <div style="flex:1"><textarea rows="2">${esc(s.text)}</textarea><span class="time">${mmss(s.start)} – ${mmss(s.end)}</span></div>
    <button data-a="play" title="Ouvir trecho">▶</button></div>`).join("");
}
const segClip = s => s.whole ? trFile : clipWav(trBuf, s.start - 0.15, s.end + 0.25);
$("#trList").onclick = e => {
  const b = e.target.closest("button[data-a=play]"); if (!b) return;
  player.pause(); speechSynthesis?.cancel(); player.playbackRate = 1;
  player.src = URL.createObjectURL(segClip(trSegs[+b.closest(".seg").dataset.i])); player.play();
};
$("#btnTrCreate").onclick = async () => {
  const rows = [...document.querySelectorAll("#trList .seg")].filter(r => r.querySelector("input").checked);
  if (!rows.length) return;
  const btn = $("#btnTrCreate"); btn.disabled = true;
  let n = 0, fail = 0;
  for (const row of rows) {
    const s = trSegs[+row.dataset.i], front = row.querySelector("textarea").value.trim();
    if (!front) continue;
    msg("#trCreateMsg", `Criando ${++n}/${rows.length}...`);
    let back = ""; try { back = await translate(front.slice(0, 480)); } catch { fail++; }
    const c = newCard(front, back, { tags: $("#trTags").value.trim(), rec: true });
    await idb.set(c.id, segClip(s));
    cards.push(c);
  }
  saveCards(); btn.disabled = false;
  msg("#trCreateMsg", `✅ ${n} cartas criadas com o áudio original!` + (fail ? ` (${fail} sem tradução — edite na aba Cartas)` : ""));
  $("#trList").innerHTML = ""; trSegs = [];
};

/* ===================== Lista de cartas ===================== */
$("#search").oninput = renderTable;
function renderTable() {
  const q = $("#search").value.toLowerCase();
  const list = cards.filter(c => (c.front + c.back + c.tags).toLowerCase().includes(q)).sort((a, b) => b.created - a.created);
  $("#countMsg").textContent = `${list.length} de ${cards.length}`;
  $("#cardTable tbody").innerHTML = list.map(c => `<tr data-id="${c.id}">
    <td>${esc(c.front)}</td><td>${esc(c.back)}</td>
    <td>${c.seen ? (c.due <= Date.now() ? "agora" : fmt(c.due - Date.now())) : "nova"}</td>
    <td style="white-space:nowrap"><button data-a="play">🔊</button> <button data-a="edit">✏️</button> <button data-a="del">🗑</button></td></tr>`).join("");
}
$("#cardTable").onclick = async e => {
  const b = e.target.closest("button"); if (!b) return;
  const c = cards.find(x => x.id === b.closest("tr").dataset.id);
  if (b.dataset.a === "play") playCard(c);
  if (b.dataset.a === "edit") {
    const f = prompt("Frase:", c.front); if (f === null) return;
    const t = prompt("Tradução:", c.back); if (t === null) return;
    c.front = f.trim(); c.back = t.trim(); saveCards(); renderTable();
  }
  if (b.dataset.a === "del" && confirm("Apagar esta carta?")) {
    cards = cards.filter(x => x !== c); saveCards(); if (c.rec) idb.del(c.id); renderTable();
  }
};

/* ===================== Config ===================== */
function initCfg() {
  $("#cfgLang").value = cfg.lang; $("#cfgRate").value = cfg.rate; $("#rateVal").textContent = cfg.rate + "x";
  $("#cfgAutoplay").checked = cfg.autoplay; $("#cfgReverse").checked = cfg.reverse; $("#cfgNew").value = cfg.newPerDay;
}
$("#cfgLang").onchange = e => { cfg.lang = e.target.value; cfg.voice = ""; saveCfg(); loadVoices(); };
$("#cfgVoice").onchange = e => { cfg.voice = e.target.value; saveCfg(); };
$("#cfgRate").oninput = e => { cfg.rate = +e.target.value; $("#rateVal").textContent = cfg.rate + "x"; saveCfg(); };
$("#cfgAutoplay").onchange = e => { cfg.autoplay = e.target.checked; saveCfg(); };
$("#cfgReverse").onchange = e => { cfg.reverse = e.target.checked; saveCfg(); };
$("#cfgNew").onchange = e => { cfg.newPerDay = Math.max(1, +e.target.value || 20); saveCfg(); };
$("#btnTestVoice").onclick = () => speak({ en: "Hello! This is how I sound.", es: "¡Hola! Así sueno yo.", fr: "Bonjour ! Voici ma voix.",
  de: "Hallo! So klinge ich.", it: "Ciao! Questa è la mia voce.", ja: "こんにちは！", ko: "안녕하세요!", zh: "你好！", ru: "Привет!" }[cfg.lang.slice(0, 2)]);

const blobToDataUrl = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
$("#btnExport").onclick = async () => {
  const audio = {};
  for (const k of await idb.all()) audio[k] = await blobToDataUrl(await idb.get(k));
  const blob = new Blob([JSON.stringify({ version: 1, cards, cfg, audio })], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `anki-backup-${today()}.json`; a.click();
};
$("#importFile").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.cards)) throw new Error("arquivo inválido");
    if (!confirm(`Importar ${data.cards.length} cartas? (cartas com o mesmo id serão substituídas)`)) return;
    const ids = new Set(data.cards.map(c => c.id));
    cards = cards.filter(c => !ids.has(c.id)).concat(data.cards); saveCards();
    for (const [k, url] of Object.entries(data.audio || {})) await idb.set(k, await (await fetch(url)).blob());
    alert("Importado!"); showTab("estudar");
  } catch (err) { alert("Erro: " + err.message); }
  e.target.value = "";
};

initCfg();
if ("speechSynthesis" in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
nextCard();
