"use strict";
/* ============================================================
   Conta de usuário + sincronização com o Supabase
   - Login com e-mail e senha (as senhas ficam no Supabase, nunca no app)
   - Cartas e configurações vão para o banco; áudios gravados vão para o Storage
   - O app continua funcionando offline e sincroniza quando a internet volta
   ============================================================ */
(() => {
  const configured = !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY && window.supabase);
  const S = {
    synced: load("anki.synced", {}),       // id da carta → "updated" já enviado/recebido
    uploaded: load("anki.uploaded", {}),   // ids cujo áudio já está no Storage
    lastPull: localStorage.getItem("anki.lastPull") || "",
    cfgSynced: +localStorage.getItem("anki.cfgSynced") || 0,
  };
  const persist = () => {
    localStorage.setItem("anki.synced", JSON.stringify(S.synced));
    localStorage.setItem("anki.uploaded", JSON.stringify(S.uploaded));
    localStorage.setItem("anki.lastPull", S.lastPull);
    localStorage.setItem("anki.cfgSynced", S.cfgSynced);
  };
  const status = t => $("#syncStatus").textContent = t;
  const pending = () => cards.some(c => S.synced[c.id] !== c.updated) || tombs.length > 0;
  let sb = null, user = null, syncing = false, again = false, timer = null;

  if (!configured) { $("#accNoCfg").classList.remove("hidden"); $("#accLogin").disabled = true; $("#authScreen").classList.add("hidden"); return; }
  sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

  /* ---------- Tela de login ---------- */
  let mode = "login";
  const showAuth = on => $("#authScreen").classList.toggle("hidden", !on);
  function setMode(m) {
    mode = m;
    $("#authTitle").textContent = { login: "Acesse seus flashcards", signup: "Crie sua conta grátis", forgot: "Recupere sua senha" }[m];
    $("#authGo").textContent = { login: "Entrar", signup: "Criar conta grátis", forgot: "Enviar link de recuperação" }[m];
    $("#authNameRow").classList.toggle("hidden", m !== "signup");
    $("#authPassRow").classList.toggle("hidden", m === "forgot");
    $("#authToggle").textContent = m === "login" ? "Não tem conta? Criar conta" : "Já tem conta? Entrar";
    $("#authPass").autocomplete = m === "signup" ? "new-password" : "current-password";
    msg("#authMsg", "");
  }
  const ptErr = m => ({
    "Invalid login credentials": "E-mail ou senha incorretos.",
    "Email not confirmed": "Confirme seu e-mail primeiro (veja a caixa de entrada e o spam).",
    "User already registered": "Já existe uma conta com esse e-mail.",
  })[m] || (/rate limit/i.test(m) ? "Muitas tentativas. Espere alguns minutos e tente de novo." : m);
  const here = location.origin + location.pathname;

  $("#authToggle").onclick = e => { e.preventDefault(); setMode(mode === "login" ? "signup" : "login"); };
  $("#authForgot").onclick = e => { e.preventDefault(); setMode("forgot"); };
  // Botões "Criar conta grátis" da página inicial: abrem o formulário já no modo cadastro
  document.querySelectorAll("[data-auth]").forEach(a => a.onclick = e => {
    e.preventDefault(); setMode(a.dataset.auth);
    $("#entrar").scrollIntoView({ behavior: "smooth", block: "center" }); $("#authName").focus({ preventScroll: true });
  });
  $("#authGuest").onclick = e => { e.preventDefault(); localStorage.setItem("anki.guest", "1"); showAuth(false); };
  $("#accLogin").onclick = () => { setMode("login"); showAuth(true); };
  $("#authScreen").onkeydown = e => { if (e.key === "Enter") $("#authGo").click(); };
  $("#authGo").onclick = async () => {
    const email = $("#authEmail").value.trim(), password = $("#authPass").value, btn = $("#authGo");
    if (!email) return msg("#authMsg", "Digite o e-mail.");
    if (mode !== "forgot" && password.length < 6) return msg("#authMsg", "A senha precisa ter pelo menos 6 caracteres.");
    btn.disabled = true; msg("#authMsg", "Aguarde...");
    try {
      if (mode === "login") {
        const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error;
      } else if (mode === "signup") {
        const { data, error } = await sb.auth.signUp({ email, password,
          options: { data: { name: $("#authName").value.trim() }, emailRedirectTo: here } });
        if (error) throw error;
        if (!data.session) { setMode("login"); msg("#authMsg", "✅ Conta criada! Abra o e-mail de confirmação, clique no link e depois entre aqui."); }
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: here }); if (error) throw error;
        msg("#authMsg", "✅ Se esse e-mail tiver conta, enviamos um link para criar uma nova senha.");
      }
    } catch (e) { msg("#authMsg", "❌ " + ptErr(e.message)); }
    btn.disabled = false;
  };

  /* ---------- Conta ---------- */
  function renderAccount() {
    $("#accIn").classList.toggle("hidden", !user); $("#accOut").classList.toggle("hidden", !!user);
    const name = user?.user_metadata?.name || user?.email?.split("@")[0] || "";
    $("#navConta").textContent = user ? "👤 " + name : "👤 Conta";
    if (!user) return status("");
    $("#accName").textContent = name; $("#accEmail").textContent = user.email;
    const t = +localStorage.getItem("anki.lastSyncAt");
    $("#accSync").textContent = t ? `Última sincronização: ${new Date(t).toLocaleString("pt-BR")}` : "Ainda não sincronizado.";
  }
  $("#accSyncNow").onclick = () => sync();
  $("#accPass").onclick = async () => {
    const p = prompt("Nova senha (mínimo 6 caracteres):"); if (!p) return;
    const { error } = await sb.auth.updateUser({ password: p });
    alert(error ? "❌ " + ptErr(error.message) : "✅ Senha alterada.");
  };
  $("#accLogout").onclick = async () => {
    await sync();
    if (pending() && !confirm("Há alterações que ainda não foram enviadas (sem internet?). Se sair agora, elas se perdem. Sair mesmo assim?")) return;
    await sb.auth.signOut();
  };

  // Apaga os dados locais (ao sair ou ao entrar com outra conta neste navegador)
  async function wipeLocal() {
    cards = []; hashes = {}; tombs = [];
    localStorage.setItem("anki.cards", "[]"); persistMeta();
    for (const k of await idb.all()) await idb.del(k);
    S.synced = {}; S.uploaded = {}; S.lastPull = ""; S.cfgSynced = 0; persist();
    localStorage.removeItem("anki.lastSyncAt");
    current = null; nextCard();
  }
  // Primeiro login neste navegador: as cartas que já estavam aqui são enviadas para a conta
  async function adopt(u) {
    const owner = localStorage.getItem("anki.owner");
    if (owner === u.id) return;
    if (owner) await wipeLocal();
    else { S.synced = {}; S.uploaded = {}; S.lastPull = ""; S.cfgSynced = 0; persist(); }
    localStorage.setItem("anki.owner", u.id); localStorage.removeItem("anki.guest");
  }

  sb.auth.onAuthStateChange((event, session) => setTimeout(async () => {   // setTimeout: recomendação do Supabase
    if (event === "PASSWORD_RECOVERY") {
      showAuth(false);
      const p = prompt("Digite sua nova senha (mínimo 6 caracteres):");
      if (p) { const { error } = await sb.auth.updateUser({ password: p }); alert(error ? "❌ " + ptErr(error.message) : "✅ Senha alterada!"); }
    }
    const u = session?.user || null;
    if (u) {
      if (user?.id === u.id) return;              // só renovou o token
      user = u; await adopt(u); showAuth(false); renderAccount(); sync();
    } else {
      const wasIn = !!user; user = null;
      if (wasIn || event === "SIGNED_OUT") { await wipeLocal(); localStorage.removeItem("anki.owner"); }
      renderAccount();
      if (!localStorage.getItem("anki.guest")) { setMode("login"); showAuth(true); }
    }
  }));

  /* ---------- Sincronização ---------- */
  async function sync() {
    if (!user) return;
    if (syncing) { again = true; return; }
    syncing = true; status("⏳ sincronizando...");
    try {
      await pull(); await push(); await syncCfg();
      localStorage.setItem("anki.lastSyncAt", Date.now());
      status("☁️ sincronizado"); renderAccount();
    } catch (e) {
      console.error("sync:", e);
      status(navigator.onLine ? "⚠️ erro ao sincronizar" : "📴 offline (sincroniza depois)");
    }
    syncing = false;
    if (again) { again = false; sync(); }
  }

  // Baixa o que mudou no servidor desde a última vez
  async function pull() {
    const since = S.lastPull, byId = new Map(cards.map(c => [c.id, c]));
    let from = 0, changed = false;
    for (;;) {
      let q = sb.from("cards").select("id,data,deleted,updated_at").order("updated_at").order("id").range(from, from + 999);
      if (since) q = q.gt("updated_at", since);
      const { data, error } = await q; if (error) throw error;
      for (const r of data) {
        const local = byId.get(r.id);
        if (r.deleted) {
          if (local) { cards = cards.filter(c => c !== local); byId.delete(r.id); changed = true; }
          delete hashes[r.id]; delete S.synced[r.id]; delete S.uploaded[r.id]; idb.del(r.id);
          continue;
        }
        if (local && (local.updated || 0) > (r.data.updated || 0)) continue;   // a versão local é mais nova: vai subir no push
        let c = local;
        if (c) Object.assign(c, r.data); else { c = r.data; cards.push(c); byId.set(c.id, c); }
        hashes[c.id] = cardHash(c); S.synced[c.id] = c.updated; changed = true;
      }
      if (data.length) S.lastPull = data[data.length - 1].updated_at;
      if (data.length < 1000) break;
      from += 1000;
    }
    if (changed) {
      localStorage.setItem("anki.cards", JSON.stringify(cards)); persistMeta();
      if ($("#cartas").classList.contains("active")) renderTable();
      if (!current || !cards.includes(current)) nextCard();
    }
    persist();
  }

  // Envia cartas novas/alteradas, apagadas e áudios
  async function push() {
    const dirty = cards.filter(c => S.synced[c.id] !== c.updated);
    for (let i = 0; i < dirty.length; i += 200) {
      const part = dirty.slice(i, i + 200);
      const { error } = await sb.from("cards").upsert(part.map(c => ({ user_id: user.id, id: c.id, data: c, deleted: false })), { onConflict: "user_id,id" });
      if (error) throw error;
      part.forEach(c => S.synced[c.id] = c.updated); persist();
    }
    for (const c of cards) {
      if (!c.rec || S.uploaded[c.id]) continue;
      const blob = await idb.get(c.id); if (!blob) continue;
      const { error } = await sb.storage.from("audio").upload(`${user.id}/${c.id}`, blob, { upsert: true, contentType: blob.type || "audio/webm" });
      if (error) throw error;
      S.uploaded[c.id] = 1; persist();
    }
    if (tombs.length) {
      const ids = [...new Set(tombs)];
      const { error } = await sb.from("cards").upsert(ids.map(id => ({ user_id: user.id, id, data: {}, deleted: true })), { onConflict: "user_id,id" });
      if (error) throw error;
      await sb.storage.from("audio").remove(ids.map(id => `${user.id}/${id}`));
      ids.forEach(id => { delete S.synced[id]; delete S.uploaded[id]; });
      tombs.length = 0; persistMeta(); persist();
    }
  }

  // Configurações: vale a mais recente (a voz escolhida fica por aparelho)
  async function syncCfg() {
    const { data, error } = await sb.from("settings").select("data").maybeSingle(); if (error) throw error;
    if (data && (data.data.updated || 0) > (cfg.updated || 0)) {
      Object.assign(cfg, data.data, { voice: cfg.voice }); saveCfg(true); initCfg();
      if ("speechSynthesis" in window) loadVoices();
    } else if ((cfg.updated || 0) !== S.cfgSynced) {
      const { voice, ...d } = cfg;
      const { error: e2 } = await sb.from("settings").upsert({ user_id: user.id, data: d }); if (e2) throw e2;
    }
    S.cfgSynced = cfg.updated || 0; persist();
  }

  // Áudio de carta criada em outro aparelho: baixa na hora de tocar e guarda no navegador
  window.fetchAudio = async id => {
    if (!user) return null;
    const { data, error } = await sb.storage.from("audio").download(`${user.id}/${id}`);
    if (error) return null;
    await idb.set(id, data); S.uploaded[id] = 1; persist();
    return data;
  };
  window.onLocalChange = () => { if (!user) return; status("⏳ alterações pendentes"); clearTimeout(timer); timer = setTimeout(sync, 3000); };
  addEventListener("online", () => sync());
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && sync());
  setInterval(() => sync(), 120e3);
})();
