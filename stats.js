"use strict";
/* ============================================================
   Análise: descobre onde o usuário erra e sugere o que fazer
   Usa o histórico de respostas de cada carta (c.log, gravado em app.js)
   ============================================================ */
(() => {
  const MIN_ANSWERS = 20;           // abaixo disso a análise ainda não é confiável
  const WINDOW = 90 * DAY;          // olha os últimos 90 dias

  // ---------- Tipos de frase (inglês) ----------
  const IRREG = "was|were|did|went|saw|made|took|came|got|said|told|knew|thought|gave|found|left|felt|brought|bought|began|ran|wrote|ate|drank|spoke|met|paid|sent|heard|kept|lost|sold|stood|understood|won|forgot|became";
  const CATS_EN = [
    { k: "phrasal", name: "Phrasal verbs", re: /\b(get|got|go|went|come|came|take|took|put|look|give|gave|turn|make|made|set|run|ran|break|broke|bring|brought|pick|find|found|figure|work|carry|hold|keep|kept|show|wake|woke|sit|stand|throw|call|check|fill|hang|log|sign|give|cut|end|grow|let|pull|shut|slow|calm|cheer|hurry)(s|ed|ing)?\s+(up|out|off|on|in|down|over|away|back|around|through|along|into|by|after|for)\b/i,
      tip: "Estude o phrasal verb como uma palavra só: crie cartas com o significado de cada um (ex.: \"give up = desistir\") e repita a frase em voz alta." },
    { k: "modal", name: "Verbos modais (would, could, should…)", re: /\b(would|could|should|might|must|may|shall|ought)\b/i,
      tip: "Os modais mudam o sentido da frase inteira. Faça cartas comparando pares, como \"could\" e \"should\", com a mesma frase." },
    { k: "perfect", name: "Tempos perfeitos (have done…)", re: /\b(have|has|had|'ve|'d)\s+(not\s+|never\s+|already\s+|just\s+|ever\s+)?(\w+ed|been|done|gone|seen|made|taken|given|known|written|eaten|got|gotten|had|come|become|said|told|found|thought|brought|bought|met|heard|left|lost)\b/i,
      tip: "O present perfect não tem equivalente direto em português. Associe-o a \"já / ainda não / desde\" e note a diferença para o passado simples." },
    { k: "past", name: "Passado", re: new RegExp(`\\b(\\w{3,}ed|${IRREG})\\b`, "i"),
      tip: "Revise os verbos irregulares mais comuns e crie cartas só com o verbo no passado (\"go → went\")." },
    { k: "future", name: "Futuro (will, going to)", re: /\b(will|won't|'ll|going to|gonna)\b/i,
      tip: "Compare \"will\" (decisão na hora, previsão) com \"going to\" (plano já decidido)." },
    { k: "cond", name: "Condicionais (if…)", re: /\b(if|unless|whether)\b/i,
      tip: "Separe a frase em duas partes (condição + resultado) e preste atenção no tempo verbal de cada parte." },
    { k: "question", name: "Perguntas", re: /\?\s*$/,
      tip: "Em inglês, a pergunta inverte a ordem (do/does/did ou o auxiliar vem antes do sujeito). Treine transformando afirmações em perguntas." },
    { k: "neg", name: "Negações", re: /\b(not|never|nobody|nothing|nowhere|neither)\b|n't\b/i,
      tip: "Atenção às contrações (don't, didn't, won't, can't): crie cartas curtas só com elas." },
    { k: "ing", name: "Formas com -ing", re: /\b\w{3,}ing\b/i,
      tip: "O -ing pode ser gerúndio (\"I'm eating\") ou substantivo (\"Swimming is fun\"). Observe qual função tem em cada frase." },
    { k: "passive", name: "Voz passiva", re: /\b(is|are|was|were|be|been|being)\s+(\w+ed|done|made|taken|given|known|written|built|sold|found|seen|told)\b/i,
      tip: "Na voz passiva o foco é em quem sofre a ação. Reescreva a frase na voz ativa para entender melhor." },
  ];
  const LEN_CATS = [
    { k: "short", name: "Frases curtas (até 6 palavras)", test: n => n <= 6 },
    { k: "mid", name: "Frases médias (7–12 palavras)", test: n => n >= 7 && n <= 12 },
    { k: "long", name: "Frases longas (13+ palavras)", test: n => n >= 13,
      tip: "Frases longas sobrecarregam a memória. Divida em cartas menores (um trecho por carta) e use o áudio para ouvir o ritmo." },
  ];
  const STOP = new Set(("the a an and or but to of in on at for with from by is are was were be been am i you he she it we they me him her us them my your his its our their this that these those do does did have has had not no yes so as if than then there here what who how why when where which will would can could should just very really " +
    "about after before because into over also only more much many some any all one two out up off get got " +
    "o a os as um uma de da do das dos em no na nos nas e que é para com por se eu você ele ela isso").split(" "));

  const words = text => {
    const re = cfg.lang.startsWith("en") ? /[a-z']+/g : /\p{L}+/gu;
    return [...new Set((text.toLowerCase().match(re) || []).map(w => w.replace(/^'+|'+$/g, "")).filter(w => w.length >= 3 && !STOP.has(w)))];
  };
  const wordCount = t => (t.match(/\S+/g) || []).length;
  function cardFeatures(c) {
    const out = [], n = wordCount(c.front);
    if (cfg.lang.startsWith("en")) for (const cat of CATS_EN) if (cat.re.test(c.front)) out.push(cat.k);
    for (const cat of LEN_CATS) if (cat.test(n)) out.push(cat.k);
    if (c.rec) out.push("rec");
    for (const t of (c.tags || "").split(",").map(s => s.trim()).filter(Boolean)) out.push("tag:" + t);
    return out;
  }
  const catInfo = k => CATS_EN.find(c => c.k === k) || LEN_CATS.find(c => c.k === k) ||
    (k === "rec" ? { name: "Cartas de áudio real (transcrição)", tip: "Áudio real é mais rápido que voz sintética. Ouça a carta 2–3 vezes antes de virar e tente repetir junto (shadowing)." }
      : { name: "Etiqueta: " + k.slice(4), tip: "Esse grupo pede atenção: revise as cartas com calma e reescreva as mais confusas." });

  // ---------- Coleta ----------
  function collect() {
    const now = Date.now(), all = [];
    for (const c of cards) for (const e of c.log || [])
      all.push({ c, t: e[0] * 1000, g: e[1], iv: e[2], ms: e[3], rev: !!(e[4] & 1), prac: !!(e[4] & 2), isNew: !!(e[4] & 4) });
    const real = all.filter(e => !e.prac && now - e.t < WINDOW);       // respostas que contam (sem treino)
    return { all, real, reviews: real.filter(e => e.iv >= 1) };
  }
  const rate = (arr, f) => arr.length ? arr.filter(f).length / arr.length : null;
  const failRate = arr => rate(arr, e => e.g === 0);
  const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const pct = x => x == null ? "—" : Math.round(x * 100) + "%";
  const dayKey = t => new Date(t).toLocaleDateString("sv");          // AAAA-MM-DD no fuso local

  function analyze() {
    const now = Date.now(), { all, real, reviews } = collect();
    const base = failRate(real) ?? 0;
    const A = { real, reviews, base, total: real.length };

    // Retenção (acerto nas revisões de cartas já aprendidas), 30 dias e tendência semanal
    const r30 = reviews.filter(e => now - e.t < 30 * DAY);
    A.retention = r30.length ? 1 - failRate(r30) : null;
    const wk = (a, b) => reviews.filter(e => now - e.t >= a * DAY && now - e.t < b * DAY);
    const [w1, w2] = [wk(0, 7), wk(7, 14)];
    A.trend = w1.length >= 10 && w2.length >= 10 ? (1 - failRate(w1)) - (1 - failRate(w2)) : null;

    // Hoje, sequência de dias, maduras
    const days = new Set(all.map(e => dayKey(e.t)));
    A.today = all.filter(e => dayKey(e.t) === dayKey(now)).length;
    let streak = 0, d = new Date(); if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
    while (days.has(dayKey(d))) { streak++; d.setDate(d.getDate() - 1); }
    A.streak = streak;
    A.mature = cards.filter(c => c.interval >= 21).length;
    A.thinkMedian = median(real.map(e => e.ms));

    // Taxa de erro por tipo de frase (com suavização para grupos pequenos não exagerarem)
    const groups = {};
    for (const e of real) for (const k of cardFeatures(e.c)) (groups[k] ||= []).push(e);
    const rev = real.filter(e => e.rev);
    if (rev.length) groups["__rev"] = rev;
    A.cats = Object.entries(groups).map(([k, arr]) => {
      const fails = arr.filter(e => e.g === 0).length;
      return { k, arr, n: arr.length, cards: [...new Set(arr.map(e => e.c.id))], fail: fails / arr.length, smooth: (fails + 4 * base) / (arr.length + 4) };
    }).filter(g => g.n >= 5).sort((a, b) => b.smooth - a.smooth);

    // Palavras que mais aparecem nos erros
    const wmap = {};
    for (const e of real) for (const w of words(e.c.front)) { const o = (wmap[w] ||= { w, n: 0, f: 0, ids: new Set() }); o.n++; if (e.g === 0) o.f++; o.ids.add(e.c.id); }
    // (a palavra precisa aparecer em 2+ cartas: se for de uma carta só, o problema é a carta)
    A.words = Object.values(wmap).filter(o => o.n >= 3 && o.f >= 2 && o.ids.size >= 2)
      .map(o => ({ ...o, ids: [...o.ids], smooth: (o.f + 3 * base) / (o.n + 3) }))
      .filter(o => o.smooth > base * 1.25).sort((a, b) => b.smooth - a.smooth).slice(0, 8);

    // Cartas-problema: erradas muitas vezes
    A.leeches = cards.map(c => {
      const l = (c.log || []).filter(e => !(e[4] & 2)), f = l.filter(e => e[1] === 0).length;
      return { c, n: l.length, f };
    }).filter(x => (x.c.lapses || 0) >= 3 || (x.n >= 4 && x.f / x.n >= 0.5)).sort((a, b) => b.f - a.f);

    // Hesitação: acerta, mas demora muito para lembrar
    const slowLimit = Math.max(8000, A.thinkMedian * 2);
    A.slow = cards.filter(c => {
      const ok = (c.log || []).filter(e => !(e[4] & 2) && e[1] >= 2);
      return ok.length >= 2 && median(ok.map(e => e[3])) > slowLimit;
    });
    A.slowLimit = slowLimit;

    // Melhor período do dia
    const periods = [["madrugada", 0, 6], ["manhã", 6, 12], ["tarde", 12, 18], ["noite", 18, 24]].map(([name, a, b]) => {
      const arr = reviews.filter(e => { const h = new Date(e.t).getHours(); return h >= a && h < b; });
      return { name, n: arr.length, ret: arr.length ? 1 - failRate(arr) : null };
    }).filter(p => p.n >= 10).sort((a, b) => b.ret - a.ret);
    A.periods = periods;

    // Atividade diária (30 dias) e previsão (7 dias)
    A.daily = [...Array(30)].map((_, i) => {
      const dt = new Date(now - (29 - i) * DAY), k = dayKey(dt), arr = all.filter(e => dayKey(e.t) === k && !e.prac);
      return { k, label: dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), n: arr.length, ok: arr.length ? 1 - failRate(arr) : null };
    });
    const start = new Date(); start.setHours(0, 0, 0, 0);
    A.forecast = [...Array(7)].map((_, i) => {
      const a = start.getTime() + i * DAY, b = a + DAY;
      const n = cards.filter(c => c.seen && (i === 0 ? c.due < b : c.due >= a && c.due < b)).length;
      return { label: i === 0 ? "hoje" : new Date(a).toLocaleDateString("pt-BR", { weekday: "short" }), n };
    });
    A.dueNow = cards.filter(c => c.seen && c.due <= now).length;
    A.avgDaily = A.daily.reduce((s, d) => s + d.n, 0) / Math.max(1, A.daily.filter(d => d.n).length);
    return A;
  }

  // ---------- Recomendações ----------
  function recommend(A) {
    const R = [];
    const add = (score, icon, title, text, action) => R.push({ score, icon, title, text, action });
    if (A.total < MIN_ANSWERS) return R;

    if (A.retention != null && A.reviews.length >= 20) {
      if (A.retention < 0.8) {
        const n = Math.max(5, Math.round(cfg.newPerDay * 0.6));
        add(90, "⚠️", `Retenção de ${pct(A.retention)}: você está esquecendo demais`,
          `O ideal é entre 85% e 90%. Entrar com muitas cartas novas faz as antigas se perderem. Reduza de ${cfg.newPerDay} para ${n} novas por dia até a retenção subir.`,
          { label: `Usar ${n}/dia`, run: () => setNew(n) });
      } else if (A.retention > 0.95 && A.reviews.length >= 40) {
        const n = Math.round(cfg.newPerDay * 1.3) + 1;
        add(40, "🚀", `Retenção de ${pct(A.retention)}: você aguenta mais`,
          `Você quase não erra nas revisões. Dá para aprender mais rápido aumentando para ${n} novas por dia.`,
          { label: `Usar ${n}/dia`, run: () => setNew(n) });
      }
    }
    if (A.dueNow > Math.max(40, A.avgDaily * 2))
      add(85, "📚", `${A.dueNow} revisões atrasadas`,
        "Quando as revisões acumulam, a memória enfraquece. Zere as atrasadas antes de adicionar cartas novas.",
        { label: "Revisar agora", run: () => showTab("estudar") });

    // Um grupo só vira sugestão se continuar ruim DEPOIS de tirar as cartas dos grupos já apontados
    // (ex.: "frases médias" pode estar ruim só porque as frases com phrasal verbs também são médias)
    const flagged = new Set(), weak = [];
    const isLen = g => LEN_CATS.some(c => c.k === g.k);      // tamanho é causa genérica: analisa por último
    for (const g of [...A.cats].sort((a, b) => isLen(a) - isLen(b) || b.smooth - a.smooth)) {
      if (weak.length >= 3) break;
      if (g.k === "short" || g.smooth < A.base * 1.35 || g.fail - A.base < 0.08) continue;
      if (g.k !== "__rev" && g.cards.length < 3) continue;   // padrão de verdade = várias cartas, não uma só
      const rest = g.arr.filter(e => !flagged.has(e.c.id));
      const restCards = new Set(rest.map(e => e.c.id)).size;
      const restFail = rest.length >= 5 && restCards >= 2 ? failRate(rest) : 0;
      if (g.k !== "__rev" && restFail < A.base * 1.35) continue;
      weak.push(g); g.cards.forEach(id => flagged.add(id));
    }
    for (const g of weak) {
      if (g.k === "__rev") {
        add(70 + g.fail * 20, "🔁", `No modo inverso você erra ${pct(g.fail)} (média ${pct(A.base)})`,
          "Você reconhece as frases, mas tem dificuldade em produzi-las. Isso é normal: continue alternando os modos e fale a frase em voz alta antes de virar.", null);
        continue;
      }
      const info = catInfo(g.k);
      add(60 + g.fail * 30, "🎯", `${info.name}: você erra ${pct(g.fail)} (média ${pct(A.base)})`, info.tip || "",
        { label: "Treinar esse grupo", run: () => startPractice(info.name, g.cards) });
    }
    if (A.words.length) {
      const ws = A.words.slice(0, 5);
      add(55, "🔤", `Palavras que mais aparecem nos seus erros: ${ws.map(w => w.w).join(", ")}`,
        "Provavelmente o problema está nelas, e não na frase inteira. Crie uma carta só para cada uma (use 💡 Buscar exemplo na aba Adicionar) ou treine as frases que as contêm.",
        { label: "Treinar essas frases", run: () => startPractice("palavras difíceis", [...new Set(ws.flatMap(w => w.ids))]) });
    }
    if (A.leeches.length)
      add(65, "🩹", `${A.leeches.length} carta(s)-problema`,
        "São cartas que você erra repetidamente. Repetir não está funcionando: reescreva com mais contexto, divida em partes menores ou apague as que não valem a pena.",
        { label: "Treinar essas cartas", run: () => startPractice("cartas-problema", A.leeches.map(x => x.c.id)) });
    if (A.slow.length >= 3)
      add(35, "🐢", `${A.slow.length} cartas você acerta, mas demora mais de ${Math.round(A.slowLimit / 1000)} s`,
        "O conhecimento ainda é frágil: você lembra, mas não automaticamente. Um treino rápido ajuda a deixar a resposta instantânea.",
        { label: "Treinar velocidade", run: () => startPractice("respostas lentas", A.slow.map(c => c.id)) });
    if (A.periods.length >= 2 && A.periods[0].ret - A.periods.at(-1).ret >= 0.1)
      add(30, "🕒", `Você rende melhor de ${A.periods[0].name}`,
        `Retenção de ${pct(A.periods[0].ret)} de ${A.periods[0].name} contra ${pct(A.periods.at(-1).ret)} de ${A.periods.at(-1).name}. Se puder, concentre as revisões nesse horário.`, null);
    if (A.trend != null && Math.abs(A.trend) >= 0.07)
      add(A.trend < 0 ? 75 : 20, A.trend < 0 ? "📉" : "📈",
        A.trend < 0 ? `Sua retenção caiu ${Math.round(-A.trend * 100)} pontos nesta semana` : `Sua retenção subiu ${Math.round(A.trend * 100)} pontos nesta semana`,
        A.trend < 0 ? "Pode ser cansaço, revisões atrasadas ou cartas novas demais. Veja os outros pontos desta lista." : "Continue assim! 👏", null);
    if (!R.length)
      add(10, "✅", "Nenhum ponto fraco claro por enquanto",
        "Seu desempenho está equilibrado entre os tipos de frase. Continue revisando todo dia; a análise fica mais precisa com o tempo.", null);
    return R.sort((a, b) => b.score - a.score);
  }
  function setNew(n) { cfg.newPerDay = n; saveCfg(); initCfg(); renderStats(); }

  // ---------- Desenho ----------
  const tip = document.body.appendChild(Object.assign(document.createElement("div"), { id: "tip" }));
  document.addEventListener("mousemove", e => {
    const el = e.target.closest?.("[data-tip]");
    if (!el) return tip.style.display = "none";
    tip.textContent = el.dataset.tip; tip.style.display = "block";
    const x = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8);
    tip.style.left = x + "px"; tip.style.top = (e.clientY + 14) + "px";
  });

  function vbars(data, valueLabel) {
    const max = Math.max(1, ...data.map(d => d.n));
    const step = data.length > 10 ? 7 : 1;
    return `<div class="vbars" role="img" aria-label="${esc(valueLabel)}">${data.map(d =>
      `<div class="b" data-tip="${esc(d.label)}: ${d.n} ${valueLabel}${d.ok != null ? `\nacertos: ${pct(d.ok)}` : ""}"><i style="height:${d.n ? Math.max(3, d.n / max * 100) : 0}%"></i></div>`).join("")}</div>
      <div class="vlabels">${data.filter((_, i) => i % step === 0 || i === data.length - 1).map(d => `<span>${esc(d.label)}</span>`).join("")}</div>`;
  }

  window.renderStats = () => {
    const A = analyze(), R = recommend(A);
    const warm = A.total < MIN_ANSWERS;
    $("#anWarmup").classList.toggle("hidden", !warm);
    if (warm) $("#anWarmup").innerHTML = `<b>📊 Coletando dados: ${A.total} de ${MIN_ANSWERS} respostas</b>
      <p class="muted">A análise começa depois de ${MIN_ANSWERS} respostas. Cada vez que você estuda, o app registra o que errou, o que acertou e quanto tempo levou.</p>`;

    const trend = A.trend == null ? "" : `${A.trend >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(A.trend * 100))} pts na semana`;
    $("#anKpis").innerHTML = [
      [pct(A.retention), "Retenção (30 dias)", trend || "acerto nas revisões"],
      [A.today, "Respostas hoje", `${A.dueNow} revisões pendentes`],
      [A.streak + (A.streak === 1 ? " dia" : " dias"), "Sequência", "dias seguidos estudando"],
      [`${A.mature}/${cards.length}`, "Cartas maduras", "intervalo de 21+ dias"],
    ].map(([v, l, d]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join("");

    $("#anRecs").innerHTML = warm ? `<p class="muted">As sugestões aparecem quando houver dados suficientes.</p>` :
      R.map((r, i) => `<div class="rec"><div class="ic">${r.icon}</div><div class="tx"><b>${esc(r.title)}</b><span>${esc(r.text)}</span></div>
        ${r.action ? `<button data-rec="${i}">${esc(r.action.label)}</button>` : ""}</div>`).join("");
    $("#anRecs").onclick = e => { const b = e.target.closest("[data-rec]"); if (b) R[+b.dataset.rec].action.run(); };

    const cats = A.cats.filter(g => g.k !== "__rev").sort((a, b) => b.fail - a.fail).slice(0, 10);
    const maxF = Math.max(0.01, A.base, ...cats.map(g => g.fail));
    $("#anCats").innerHTML = cats.length ? cats.map(g => `<div class="hbar" data-tip="${esc(catInfo(g.k).name)}\nerro: ${pct(g.fail)} em ${g.n} respostas\nsua média: ${pct(A.base)}">
        <span>${esc(catInfo(g.k).name)}</span>
        <div class="track"><div class="fill" style="width:${g.fail / maxF * 100}%"></div><div class="avg" style="left:${A.base / maxF * 100}%"></div></div>
        <span class="val">${pct(g.fail)} · ${g.n}</span></div>`).join("")
      : `<p class="muted">Ainda não há respostas suficientes por tipo de frase (mínimo de 5 por grupo).</p>`;

    $("#anWords").innerHTML = A.words.length ? `<table class="mini">${A.words.map(w =>
      `<tr><td><b>${esc(w.w)}</b></td><td class="n" data-tip="${w.f} erros em ${w.n} respostas">${pct(w.f / w.n)} de erro</td></tr>`).join("")}</table>`
      : `<p class="muted">Nenhuma palavra se destaca nos erros ainda.</p>`;
    $("#anLeeches").innerHTML = A.leeches.length ? `<table class="mini">${A.leeches.slice(0, 8).map(x =>
      `<tr><td>${esc(x.c.front)}</td><td class="n">${x.f} erros</td></tr>`).join("")}</table>`
      : `<p class="muted">Nenhuma carta-problema. 👍</p>`;

    $("#anDaily").innerHTML = vbars(A.daily, "respostas");
    $("#anForecast").innerHTML = vbars(A.forecast, "revisões");
  };
})();
