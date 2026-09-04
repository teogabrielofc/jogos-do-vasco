/**
 * ============================================================================
 * JOGOS DO VASCO — o app inteiro (voz + narração + foco + player)
 * ============================================================================
 * Feito pra um torcedor idoso que não lê: a voz conta os jogos, narra o que
 * está selecionado e o controle faz tudo (setas + OK + VOLTAR).
 *
 * Porta fiel do app Next.js pra JS padrao (ES5) — compatível com webview
 * antigo de TV (Tizen 3, 2017+). Usa a API embutida do scraper.js.
 */
(function () {
  "use strict";

  // ═══════════════════════════ UTILIDADES ═══════════════════════════

  function $(id) { return document.getElementById(id); }
  function mostra(el) { el.classList.remove("esconder"); }
  function esconde(el) { el.classList.add("esconder"); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function maisProximo(el, seletor) {
    while (el && el !== document.body) {
      var m = el.matches || el.webkitMatchesSelector || el.msMatchesSelector;
      if (m && m.call(el, seletor)) return el;
      el = el.parentNode;
    }
    return null;
  }

  function rolarAte(el) {
    try {
      if ("scrollBehavior" in document.documentElement.style) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else {
        el.scrollIntoView(false);
      }
    } catch (e) {
      try { el.scrollIntoView(false); } catch (e2) { /* paciência */ }
    }
  }

  function tocarVideo(video) {
    try {
      var p = video.play();
      if (p && typeof p.catch === "function") p.catch(function () { /* TV manda, obedece */ });
    } catch (e) {
      try { video.play(); } catch (e2) { /* idem */ }
    }
  }

  var DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
  var MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

  // ═══════════════ LÓGICA DOS JOGOS (porta do games.ts) ═══════════════

  /** "04/09/2026" → "04092026" (compara sem medo de espaço sobrando) */
  function normDate(data) {
    var m = String(data || "").match(/\d+/g);
    var juntos = m ? m.join("") : "";
    while (juntos.length < 8) juntos = "0" + juntos;
    return juntos;
  }

  function todayKey(now) {
    return pad2(now.getDate()) + "/" + pad2(now.getMonth() + 1) + "/" + now.getFullYear();
  }

  /** "dd/MM/yyyy" + "HH:mm" → Date local */
  function jogoDate(j) {
    var dm = String(j.match_date || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    var tm = String(j.match_time || "").match(/(\d{1,2}):(\d{2})/);
    if (!dm || !tm) return null;
    return new Date(+dm[3], +dm[2] - 1, +dm[1], +tm[1], +tm[2], 0, 0);
  }

  /** 21:30 → "21 horas e meia" / 19:00 → "19 horas" */
  function horaFalada(hhmm) {
    var m = String(hhmm || "").match(/(\d{1,2}):(\d{2})/);
    if (!m) return hhmm;
    var h = +m[1], min = +m[2];
    if (min === 0) return h + " horas";
    if (min === 30) return h + " horas e meia";
    return h + " horas e " + min + " minutos";
  }

  function horaCurta(hhmm) {
    var m = String(hhmm || "").match(/(\d{1,2}):(\d{2})/);
    return m ? m[1] + ":" + m[2] : hhmm;
  }

  function isVasco(j) {
    return (j.home_team + " " + j.away_team).toLowerCase().indexOf("vasco") >= 0;
  }

  function adversario(j) {
    return j.home_team.toLowerCase().indexOf("vasco") >= 0 ? j.away_team : j.home_team;
  }

  /** live = bola rolando (margem de 2h30 depois do início) */
  function gameStatus(j, now) {
    var d = jogoDate(j);
    if (!d) return "upcoming";
    var min = (now.getTime() - d.getTime()) / 60000;
    if (min < 0) return "upcoming";
    if (min <= 150) return "live";
    return "done";
  }

  function sortJogos(lista) {
    return lista.slice(0).sort(function (a, b) {
      var da = jogoDate(a), db = jogoDate(b);
      return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
    });
  }

  // ═══════════ Textos que a voz fala (porta do games.ts) ═══════════

  /** Saudação completa ao ligar o app, no formato que o velhão pediu */
  function buildGreeting(jogos, now) {
    var h = now.getHours();
    var saudacao = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
    var hoje = normDate(todayKey(now));

    var vascoHoje = null;
    for (var i = 0; i < jogos.length; i++) {
      if (isVasco(jogos[i]) && normDate(jogos[i].match_date) === hoje) { vascoHoje = jogos[i]; break; }
    }

    if (vascoHoje) {
      var st = gameStatus(vascoHoje, now);
      var adv = adversario(vascoHoje);
      if (st === "live") {
        return saudacao + "! Hoje tem jogo do Vasco, e já está rolando! Vasco e " + adv + ".";
      }
      if (st === "done") {
        return saudacao + "! O jogo do Vasco contra o " + adv + " já aconteceu hoje.";
      }
      return saudacao + "! Hoje tem jogo do Vasco! Vasco e " + adv + ", às " + horaFalada(vascoHoje.match_time) + ".";
    }

    // Próximo jogo do Vasco (o site lista hoje e amanhã)
    var proximo = null;
    for (i = 0; i < jogos.length; i++) {
      if (!isVasco(jogos[i])) continue;
      var d = jogoDate(jogos[i]);
      if (d && d.getTime() > now.getTime()) {
        if (!proximo || jogoDate(proximo).getTime() > d.getTime()) proximo = jogos[i];
      }
    }

    var parteVasco = "Hoje não tem jogo do Vasco.";
    if (proximo) {
      var amanhaAmanhece = new Date(now.getTime() + 86400000);
      var ehAmanha = normDate(todayKey(amanhaAmanhece)) === normDate(proximo.match_date);
      var dd = jogoDate(proximo);
      var dia = dd ? pad2(dd.getDate()) : "";
      var quando = ehAmanha ? "é amanhã" : dia ? "é dia " + dia : "em breve";
      parteVasco = "Hoje não tem jogo do Vasco. O próximo " + quando + ", Vasco e " +
        adversario(proximo) + ", às " + horaFalada(proximo.match_time) + ".";
    }

    var jogosHoje = [];
    for (i = 0; i < jogos.length; i++) {
      if (normDate(jogos[i].match_date) === hoje && gameStatus(jogos[i], now) !== "done") jogosHoje.push(jogos[i]);
    }
    jogosHoje = sortJogos(jogosHoje);

    if (!jogosHoje.length) return saudacao + "! " + parteVasco;

    var citados = jogosHoje.slice(0, 4);
    var partes = [];
    for (i = 0; i < citados.length; i++) {
      partes.push(citados[i].home_team + " contra " + citados[i].away_team + ", " +
        (gameStatus(citados[i], now) === "live" ? "que já começou" : "às " + horaFalada(citados[i].match_time)));
    }
    var lista = partes.join("; ");
    var resto = jogosHoje.length - citados.length;
    var sufixo = resto > 0 ? ". E mais " + resto + (resto === 1 ? " jogo" : " jogos") + "." : ".";
    return saudacao + "! " + parteVasco + " Mas hoje tem: " + lista + sufixo;
  }

  function saudacaoCurta(now) {
    var h = now.getHours();
    return h < 12 ? "Bom dia!" : h < 18 ? "Boa tarde!" : "Boa noite!";
  }

  /** Narração de um card de jogo quando ganha foco */
  function jogoFalado(j, now) {
    var st = gameStatus(j, now);
    if (st === "live") return j.home_team + " contra " + j.away_team + ", ao vivo agora!";
    if (st === "done") return j.home_team + " contra " + j.away_team + ", já encerrou.";
    return j.home_team + " contra " + j.away_team + ", às " + horaFalada(j.match_time) + ".";
  }

  /** Narração do banner do Vasco quando ganha foco */
  function jogoFaladoVasco(j, now) {
    var st = gameStatus(j, now);
    var adv = adversario(j);
    if (st === "live") {
      return "Jogos do Vasco. Hoje tem jogo do Vasco, e já está rolando! Vasco e " + adv + ". Aperte OK pra assistir.";
    }
    return "Jogos do Vasco. Hoje tem jogo do Vasco! Vasco e " + adv + ", às " + horaFalada(j.match_time) + ". Aperte OK pra assistir.";
  }

  // ═══════════════════ VOZ (porta do voice.ts + Tizen TTS) ═══════════════════

  var Voice = {
    synth: null,
    voz: null,
    unlocked: false,
    disponivel: false,
    tsModo: -1, // forma da chamada tizen.textspeech que funcionou

    init: function () {
      if ("speechSynthesis" in window && window.speechSynthesis) {
        this.synth = window.speechSynthesis;
        this.disponivel = true;
        this.escolherVoz();
        var self = this;
        if (typeof this.synth.addEventListener === "function") {
          this.synth.addEventListener("voiceschanged", function () { self.escolherVoz(); });
        } else if ("onvoiceschanged" in this.synth) {
          this.synth.onvoiceschanged = function () { self.escolherVoz(); };
        }
      } else {
        // Web Speech não existe no webview da TV — Tizen 6.5+ tem TTS nativo
        var ts = window.tizen && window.tizen.textspeech;
        this.disponivel = !!(ts && typeof ts.readText === "function");
      }
    },

    escolherVoz: function () {
      if (!this.synth) return;
      var vozes = [];
      try { vozes = this.synth.getVoices() || []; } catch (e) { return; }
      if (!vozes.length) return;
      var pt = [];
      for (var i = 0; i < vozes.length; i++) {
        var lang = (vozes[i].lang || "").toLowerCase().replace("_", "-");
        if (lang.indexOf("pt") === 0) pt.push(vozes[i]);
      }
      var preferida = null, j;
      for (j = 0; j < pt.length; j++) {
        if (/luciana|francisca|maria|fernanda|joana|google/i.test(pt[j].name)) { preferida = pt[j]; break; }
      }
      if (!preferida) {
        for (j = 0; j < pt.length; j++) {
          if (pt[j].lang.toLowerCase().indexOf("br") >= 0) { preferida = pt[j]; break; }
        }
      }
      this.voz = preferida || pt[0] || vozes[0];
    },

    falar: function (texto, opts) {
      opts = opts || {};
      if (!texto) return;
      if (this.synth) {
        if (opts.interrupt) { try { this.synth.cancel(); } catch (e) {} }
        var utter = new SpeechSynthesisUtterance(texto);
        utter.lang = "pt-BR";
        if (this.voz) utter.voice = this.voz;
        utter.rate = opts.rate || 0.95;
        utter.pitch = 1;
        var self = this;
        var comecou = false;
        utter.onstart = function () { comecou = true; self.unlocked = true; };
        try { this.synth.speak(utter); } catch (e) { return; }
        // Detecção de bloqueio: navegador de PC exige um toque antes de falar
        if (opts.onblocked) {
          setTimeout(function () {
            if (!comecou && self.synth && !self.synth.speaking && !self.unlocked) opts.onblocked();
          }, 1300);
        }
        return;
      }
      if (this.tsFalar(texto)) return;
      if (opts.onnovoz) opts.onnovoz();
    },

    /** TTS nativo da TV (Tizen 6.5+) — melhor esforço, testando formas da API */
    tsFalar: function (texto) {
      var ts = window.tizen && window.tizen.textspeech;
      if (!ts || typeof ts.readText !== "function") return false;
      var formas;
      if (this.tsModo >= 0) formas = [this.tsModo];
      else formas = [0, 1, 2];
      for (var i = 0; i < formas.length; i++) {
        var f = formas[i];
        try {
          if (f === 0) ts.readText(texto, { language: "pt-BR" }, function () {}, function () {});
          else if (f === 1) ts.readText(texto, function () {}, function () {});
          else ts.readText(texto);
          this.tsModo = f;
          this.unlocked = true;
          return true;
        } catch (e) { /* tenta a próxima forma */ }
      }
      return false;
    },

    parar: function () {
      if (this.synth) { try { this.synth.cancel(); } catch (e) {} }
      try {
        var ts = window.tizen && window.tizen.textspeech;
        if (ts && typeof ts.stop === "function") ts.stop();
      } catch (e) { /* se não puder, fala mesmo */ }
    }
  };

  // ═══════════════════════════ ESTADO ═══════════════════════════

  var S = {
    tela: "home", // home | canais | player
    jogos: null,
    erro: null,
    foco: 0,
    agora: null,
    vozBloqueada: false,
    semVoz: false,
    jogoSel: null,
    canais: null,
    canaisErro: null,
    canalSel: 0,
    canalTocado: "",
    greetingFeito: false,
    greetingTxt: "",
    voiceUnlocked: false,
    userNav: 0,
    narrKey: "",
    abriuIdx: 0
  };
  var focaveis = [];
  var cols = 4;

  // ═══════════════════════ BANNER DA VOZ ═══════════════════════

  function atualizarBannerVoz() {
    var mostrar = S.vozBloqueada || S.semVoz;
    var el = $("bannerVoz");
    if (mostrar) {
      $("bannerVozTxt").textContent = S.semVoz
        ? "Essa TV não tem voz pronta — mas dá pra usar tudo normal"
        : "Aperte qualquer botão do controle pra ouvir";
      mostra(el);
      document.body.classList.add("com-banner");
    } else {
      esconde(el);
      document.body.classList.remove("com-banner");
    }
  }

  // ═══════════════════════════ HOME ═══════════════════════════

  function logoHtml(src, nome, tamanho) {
    var cls = tamanho === "pq" ? " pq" : "";
    var iniciais = esc(String(nome || "?").slice(0, 3).toUpperCase());
    var fallback = '<span class="escudo-fallback' + cls + '">' + iniciais + "</span>";
    if (!src) return fallback;
    return '<img class="escudo-time' + cls + '" src="' + esc(src) + '" alt="" data-nome="' + esc(nome) + '" onerror="logoFalhou(this)">';
  }

  /** Se o escudo não carregar, mostra um círculo com as 3 primeiras letras */
  window.logoFalhou = function (img) {
    if (!img || !img.parentNode) return;
    var nome = img.getAttribute("data-nome") || "?";
    var span = document.createElement("span");
    span.className = img.className.replace("escudo-time", "escudo-fallback");
    span.textContent = String(nome).slice(0, 3).toUpperCase();
    img.parentNode.replaceChild(span, img);
  };

  function cardHtml(j, idx, rel) {
    var st = gameStatus(j, rel);
    var badge = st === "live" ? '<span class="badge vivo">AO VIVO</span>'
      : st === "done" ? '<span class="badge fim">ENCERROU</span>' : "";
    var hora = st === "live" ? "AGORA" : horaCurta(j.match_time);
    var focado = idx === S.foco ? " focado" : "";
    return '<div class="card' + focado + '" data-idx="' + idx + '">' +
      '<div class="escudos">' + logoHtml(j.home_logo_url, j.home_team) +
      '<span class="xis">X</span>' + logoHtml(j.away_logo_url, j.away_team) + "</div>" +
      '<div class="nomes"><p>' + esc(j.home_team) + "</p><p>" + esc(j.away_team) + "</p></div>" +
      '<p class="hora">' + esc(hora) + "</p>" +
      '<div class="rodape-card">' + badge + '<p class="camp">' + esc(j.championship) + "</p></div>" +
      "</div>";
  }

  function heroHtml(j, rel) {
    var st = gameStatus(j, rel);
    var status = st === "live" ? "AO VIVO AGORA" : "HOJE ÀS " + horaCurta(j.match_time);
    var focado = S.foco === 0 ? " focado" : "";
    return '<div class="hero' + focado + '" data-idx="0">' +
      '<img class="escudo-grande" src="icon.png" alt="Escudo do Vasco da Gama">' +
      '<div style="flex:1;min-width:0">' +
      '<p class="titulo">JOGOS DO VASCO</p>' +
      '<div class="enfrente">' +
      '<div class="duelo">' + logoHtml(j.home_logo_url, j.home_team, "pq") +
      '<span class="xis">X</span>' + logoHtml(j.away_logo_url, j.away_team, "pq") + "</div>" +
      '<div class="nomes-duelo">' +
      '<p class="t">' + esc(j.home_team) + " X " + esc(j.away_team) + "</p>" +
      '<p class="s">' + esc(status) + "</p>" +
      '<p class="c">' + esc(j.championship) + "</p>" +
      "</div></div></div></div>";
  }

  function heroVazioHtml(proximo) {
    var extra = "";
    if (proximo) {
      var d = jogoDate(proximo);
      var diaSemana = d ? DIAS[d.getDay()] : "";
      extra = '<p class="proximo">Próximo: Vasco e ' + esc(adversario(proximo)) +
        (diaSemana ? " • " + esc(diaSemana) : "") +
        (proximo.match_time ? " • " + esc(horaCurta(proximo.match_time)) : "") + "</p>";
    }
    return '<div class="hero apagado">' +
      '<img class="escudo-grande" src="icon.png" alt="Escudo do Vasco da Gama">' +
      "<div><p class=\"titulo\">JOGOS DO VASCO</p>" +
      '<p class="sem-jogo">Hoje não tem jogo do Vasco</p>' + extra + "</div></div>";
  }

  function renderHome() {
    var rel = S.agora || new Date();
    $("saudacaoTxt").textContent = saudacaoCurta(rel);
    $("horaTxt").textContent = pad2(rel.getHours()) + ":" + pad2(rel.getMinutes());
    $("dataTxt").textContent = DIAS[rel.getDay()] + ", " + rel.getDate() + " de " + MESES[rel.getMonth()];

    var hoje = normDate(todayKey(rel));
    var vascoHoje = null;
    for (var i = 0; i < S.jogos.length; i++) {
      if (isVasco(S.jogos[i]) && normDate(S.jogos[i].match_date) === hoje) { vascoHoje = S.jogos[i]; break; }
    }
    var proximoVasco = acharProximoVasco(rel);

    var outros = [];
    for (i = 0; i < S.jogos.length; i++) {
      if (!vascoHoje || S.jogos[i].match_id !== vascoHoje.match_id) outros.push(S.jogos[i]);
    }

    focaveis = [];
    if (vascoHoje) {
      focaveis.push({ jogo: vascoHoje, fala: jogoFaladoVasco(vascoHoje, rel) });
    }
    for (i = 0; i < outros.length; i++) {
      focaveis.push({ jogo: outros[i], fala: jogoFalado(outros[i], rel) });
    }
    if (S.foco > focaveis.length - 1) S.foco = Math.max(0, focaveis.length - 1);

    $("secaoVasco").innerHTML = vascoHoje ? heroHtml(vascoHoje, rel) : heroVazioHtml(proximoVasco);

    if (!outros.length) {
      $("gradeJogos").innerHTML = '<p class="sem-jogos">Nenhum jogo listado hoje.</p>';
    } else {
      var html = '<div class="grade">';
      for (i = 0; i < outros.length; i++) {
        html += cardHtml(outros[i], (vascoHoje ? 1 : 0) + i, rel);
      }
      html += "</div>";
      $("gradeJogos").innerHTML = html;
    }
    aplicarFoco();
  }

  function acharProximoVasco(rel) {
    var melhor = null;
    for (var i = 0; i < S.jogos.length; i++) {
      if (!isVasco(S.jogos[i])) continue;
      var d = jogoDate(S.jogos[i]);
      if (d && d.getTime() > rel.getTime()) {
        if (!melhor || jogoDate(melhor).getTime() > d.getTime()) melhor = S.jogos[i];
      }
    }
    return melhor;
  }

  function aplicarFoco() {
    var el = document.querySelector('#telaHome [data-idx="' + S.foco + '"]');
    var todos = document.querySelectorAll("#telaHome .card, #telaHome .hero");
    for (var i = 0; i < todos.length; i++) todos[i].classList.remove("focado");
    if (el && S.tela === "home") {
      el.classList.add("focado");
      rolarAte(el);
    }
  }

  /** Atualiza relógio e status sem recriar a tela inteira (sem piscar) */
  function atualizarStatuses() {
    var rel = S.agora || new Date();
    $("horaTxt").textContent = pad2(rel.getHours()) + ":" + pad2(rel.getMinutes());
    for (var i = 0; i < focaveis.length; i++) {
      var el = document.querySelector('#telaHome [data-idx="' + i + '"]');
      if (!el) continue;
      var st = gameStatus(focaveis[i].jogo, rel);
      var horaEl = el.querySelector(".hora");
      if (horaEl) horaEl.textContent = st === "live" ? "AGORA" : horaCurta(focaveis[i].jogo.match_time);
      var badgeEl = el.querySelector(".badge");
      if (st === "live" && badgeEl) {
        badgeEl.textContent = "AO VIVO";
        badgeEl.className = "badge vivo";
      } else if (st === "done" && badgeEl) {
        badgeEl.textContent = "ENCERROU";
        badgeEl.className = "badge fim";
      } else if (st === "upcoming" && badgeEl) {
        badgeEl.parentNode.removeChild(badgeEl);
      } else if (st !== "upcoming" && !badgeEl) {
        var rodapeCard = el.querySelector(".rodape-card");
        if (rodapeCard) {
          var b = document.createElement("span");
          b.className = "badge " + (st === "live" ? "vivo" : "fim");
          b.textContent = st === "live" ? "AO VIVO" : "ENCERROU";
          rodapeCard.insertBefore(b, rodapeCard.firstChild);
        }
      }
      var sEl = el.querySelector(".nomes-duelo .s");
      if (sEl) sEl.textContent = st === "live" ? "AO VIVO AGORA" : "HOJE ÀS " + horaCurta(focaveis[i].jogo.match_time);
    }
  }

  // ═══════════════════════════ CANAIS ═══════════════════════════

  function renderCanais() {
    if (!S.jogoSel) return;
    $("canaisCamp").textContent = S.jogoSel.championship;
    $("canaisTitulo").innerHTML = esc(S.jogoSel.home_team) + ' <span class="meio-dim">X</span> ' + esc(S.jogoSel.away_team);

    var lista = $("canaisLista");
    if (S.canais === null && !S.canaisErro) {
      lista.innerHTML = '<div class="centro-linha"><div class="spinner"></div><p class="gigante bold">Buscando canais...</p></div>';
    } else if (S.canaisErro && (!S.canais || !S.canais.length)) {
      lista.innerHTML = '<div class="aviso-linha"><div class="aviso-icone">!</div><p>' + esc(S.canaisErro) + "</p></div>" +
        '<p class="dica-erro">Aperte OK pra tentar de novo, ou VOLTAR pra sair.</p>';
    } else if (S.canais && S.canais.length) {
      var html = "";
      for (var i = 0; i < S.canais.length; i++) {
        html += '<div class="linha-canal' + (i === S.canalSel ? " focado" : "") + '" data-canal="' + i + '">' +
          '<span class="num-canal">' + (i + 1) + "</span> CANAL " + esc(S.canais[i].label) + "</div>";
      }
      lista.innerHTML = html;
    }
    var el = document.querySelector('#canaisLista [data-canal="' + S.canalSel + '"]');
    if (el) rolarAte(el);
    narrarFoco();
  }

  // ═══════════════════════════ PLAYER ═══════════════════════════

  var P = { tentativa: 0, morto: true, hls: null, engine: null, engineBase: null, status: "carregando", badgeTimer: null };

  function acharCanal(label) {
    if (!S.jogoSel || !S.jogoSel.channels) return null;
    for (var i = 0; i < S.jogoSel.channels.length; i++) {
      if (S.jogoSel.channels[i].label === label) return S.jogoSel.channels[i];
    }
    return null;
  }

  function escolherEngine() {
    var video = $("video");
    var temHls = window.Hls && window.Hls.isSupported && window.Hls.isSupported();
    var temNativa = video.canPlayType && video.canPlayType("application/vnd.apple.mpegurl");
    if (temHls) { P.engine = "hls"; P.engineBase = "hls"; }
    else if (temNativa) { P.engine = "nativa"; P.engineBase = "nativa"; }
    else { P.engine = null; P.engineBase = null; }
  }

  function trocarEngine() {
    var video = $("video");
    var temNativa = video.canPlayType && video.canPlayType("application/vnd.apple.mpegurl");
    if (P.engineBase === "hls" && temNativa) {
      P.engine = P.engine === "hls" ? "nativa" : "hls";
    }
  }

  function destruirHls() {
    if (P.hls) {
      try { P.hls.destroy(); } catch (e) {}
      P.hls = null;
    }
  }

  function anexarStream(url) {
    var video = $("video");
    destruirHls();
    if (P.engine === "hls" && window.Hls && window.Hls.isSupported && window.Hls.isSupported()) {
      var hls = new window.Hls({
        manifestLoadingTimeOut: 15000,
        manifestLoadingMaxRetry: 2,
        fragLoadingMaxRetry: 4,
        backBufferLength: 60
      });
      P.hls = hls;
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, function () {
        tocarVideo(video);
      });
      hls.on(window.Hls.Events.ERROR, function (evt, data) {
        if (!data || !data.fatal || P.morto) return;
        proximaTentativa();
      });
      hls.loadSource(url);
    } else {
      // HLS nativo — a TV decodifica direto no <video>
      var onErro = function () {
        video.removeEventListener("error", onErro);
        if (P.morto) return;
        proximaTentativa();
      };
      video.addEventListener("error", onErro);
      video.src = url;
      tocarVideo(video);
    }
  }

  function carregarStream(forcarToken) {
    if (P.morto) return;
    P.status = "carregando";
    atualizarPlayerUI();
    var canal = acharCanal(S.canalTocado);
    if (!canal) { proximaTentativa(); return; }
    window.FutemaisAPI.resolverHls(canal, forcarToken).then(function (url) {
      if (P.morto) return;
      if (!url) { proximaTentativa(); return; }
      anexarStream(url);
    }).catch(function () {
      proximaTentativa();
    });
  }

  /**
   * Escada de tentativas (sem proxy — a TV não precisa):
   *   0. token em cache + engine preferida (hls.js)
   *   1. token novo + mesma engine
   *   2. token novo + engine alternativa (nativa)
   *   3. token novo + engine preferida
   *   4. desiste e mostra o erro FALADO
   */
  function proximaTentativa() {
    if (P.morto) return;
    P.tentativa += 1;
    if (P.tentativa > 3) { falhaPlayer(); return; }
    if (P.tentativa === 2) trocarEngine();
    carregarStream(P.tentativa >= 1);
  }

  function falhaPlayer() {
    P.status = "erro";
    atualizarPlayerUI();
    Voice.falar("Não rolou abrir esse canal. Aperte VOLTAR pra escolher outro.", { interrupt: true });
  }

  function atualizarPlayerUI() {
    var titulo = S.jogoSel ? S.jogoSel.home_team + " x " + S.jogoSel.away_team : "";
    $("playerCarregandoTxt").textContent = "Carregando " + titulo + "...";
    $("playerCarregandoCanal").textContent = "Canal " + S.canalTocado;
    $("playerBadgeT").textContent = titulo;
    $("playerBadgeC").textContent = "Canal " + S.canalTocado;
    $("playerCarregando").classList.toggle("esconder", P.status !== "carregando");
    $("playerErro").classList.toggle("esconder", P.status !== "erro");
    if (P.status === "tocando") {
      $("playerDica").style.display = "block";
    } else {
      $("playerDica").style.display = "none";
      $("playerPausado").classList.add("esconder");
      $("playerBadge").classList.add("esconder");
    }
  }

  function bindVideo() {
    var video = $("video");
    video.addEventListener("playing", function () {
      if (P.morto) return;
      P.status = "tocando";
      atualizarPlayerUI();
      $("playerBadge").classList.remove("esconder");
      if (P.badgeTimer) clearTimeout(P.badgeTimer);
      P.badgeTimer = setTimeout(function () { $("playerBadge").classList.add("esconder"); }, 5000);
    });
    video.addEventListener("play", function () {
      $("playerPausado").classList.add("esconder");
    });
    video.addEventListener("pause", function () {
      if (!P.morto && P.status === "tocando") $("playerPausado").classList.remove("esconder");
    });
  }

  function sairDoPlayer() {
    P.morto = true;
    destruirHls();
    var video = $("video");
    try { video.pause(); } catch (e) {}
    video.removeAttribute("src");
    try { video.load(); } catch (e) {}
    Voice.parar();
    irTela("canais");
    renderCanais();
  }

  // ═══════════════════ AÇÕES E NAVEGAÇÃO ═══════════════════

  function irTela(tela) {
    S.tela = tela;
    esconde($("telaCarregando"));
    esconde($("telaErro"));
    esconde($("telaHome"));
    esconde($("telaCanais"));
    esconde($("telaPlayer"));
    if (tela === "home") { mostra($("telaHome")); renderRodape("home"); }
    else if (tela === "canais") { mostra($("telaCanais")); renderRodape("canais"); }
    else {
      mostra($("telaPlayer"));
      renderRodape("player");
      document.body.classList.add("player-mode");
    }
  }

  function renderRodape(tela) {
    var html = "";
    if (tela === "home") {
      html = "<span><kbd>\u25B2\u25BC\u25C0\u25B6</kbd> Mover</span><span><kbd>OK</kbd> Abrir</span><span><kbd>VOLTAR</kbd> Sair</span>";
    } else if (tela === "canais") {
      html = "<span><kbd>\u25B2\u25BC</kbd> Escolher</span><span><kbd>OK</kbd> Assistir</span><span><kbd>VOLTAR</kbd> Voltar</span>";
    }
    $("rodape").innerHTML = html;
    $("rodape").classList.toggle("esconder", tela === "player");
  }

  function abrirJogo(jogo, idx, retry) {
    S.jogoSel = jogo;
    S.abriuIdx = idx;
    irTela("canais");
    if (!retry) {
      S.canais = null;
      S.canaisErro = null;
      S.canalSel = 0;
    }
    renderCanais();
    window.FutemaisAPI.canaisDoJogo(jogo, false).then(function (canais) {
      if (S.jogoSel !== jogo) return; // o velhão já saiu daqui
      if (!canais || !canais.length) {
        S.canais = [];
        S.canaisErro = "Esse jogo ainda não tem canal. Tenta mais perto da hora.";
      } else {
        S.canais = canais;
        S.canaisErro = null;
      }
      renderCanais();
    }).catch(function () {
      if (S.jogoSel !== jogo) return;
      S.canais = [];
      S.canaisErro = "Não consegui pegar os canais agora.";
      renderCanais();
    });
  }

  function abrirCanal(idx) {
    if (!S.jogoSel || !S.canais || !S.canais.length) return;
    if (isNaN(idx)) idx = S.canalSel;
    if (idx < 0 || idx > S.canais.length - 1) return;
    S.canalSel = idx;
    S.canalTocado = S.canais[idx].label;
    irTela("player");
    Voice.falar("Abrindo " + S.jogoSel.home_team + " contra " + S.jogoSel.away_team + ", canal " + S.canalTocado + ". Boa partida!", { interrupt: true });
    P.tentativa = 0;
    P.morto = false;
    escolherEngine();
    carregarStream(false);
  }

  function voltarHome() {
    irTela("home");
    S.canais = null;
    S.canaisErro = null;
    Voice.parar();
    S.foco = Math.min(S.abriuIdx, Math.max(0, focaveis.length - 1));
    renderHome();
    narrarFoco();
  }

  // ═══════════ NARRAÇÃO DO FOCO (só depois do 1º toque) ═══════════

  function narrarFoco() {
    if (S.tela === "player") return;
    var fala = "";
    if (S.tela === "home") {
      fala = focaveis[S.foco] ? focaveis[S.foco].fala : "";
    } else if (S.tela === "canais") {
      if (S.canaisErro) {
        fala = "Não consegui pegar os canais. " + S.canaisErro + " Aperte OK pra tentar de novo, ou VOLTAR pra sair.";
      } else if (S.canais && S.canais.length) {
        fala = "Canal " + S.canais[S.canalSel].label + ". Aperte OK pra assistir.";
      }
    }
    var key = S.tela + "|" + S.foco + "|" + S.canalSel + "|" + fala + "|" + S.userNav;
    if (key === S.narrKey) return;
    S.narrKey = key;
    if (!S.userNav) return; // antes do primeiro toque, só a saudação fala
    if (fala) Voice.falar(fala, { interrupt: true, rate: 1.1 });
  }

  // ═══════════════════ DADOS (carregar / atualizar) ═══════════════════

  function carregarJogos(forcar) {
    if (S.jogos === null && S.tela === "home") mostra($("telaCarregando"));
    window.FutemaisAPI.listarJogos(forcar).then(function (lista) {
      S.jogos = sortJogos(lista || []);
      S.erro = null;
      esconde($("telaCarregando"));
      esconde($("telaErro"));
      if (S.tela === "home") {
        mostra($("telaHome"));
        renderRodape("home");
        renderHome();
      }
      anunciarPrimeiraVez(S.jogos);
    }).catch(function () {
      if (S.jogos === null) {
        S.erro = "Não consegui buscar os jogos agora.";
        $("erroTxt").textContent = S.erro;
        esconde($("telaCarregando"));
        mostra($("telaErro"));
        renderRodape("home");
      }
      anunciarPrimeiraVez([]);
    });
  }

  /** Fala a saudação na primeira carga (com resposta de erro falada também) */
  function anunciarPrimeiraVez(lista) {
    if (S.greetingFeito) return;
    S.greetingFeito = true;
    S.greetingTxt = lista.length
      ? buildGreeting(lista, new Date())
      : "Tive um problema pra buscar os jogos. Aperte OK pra tentar de novo.";
    // espera um tiquinho pra TV carregar as vozes
    setTimeout(function () {
      Voice.falar(S.greetingTxt, {
        onblocked: function () {
          S.vozBloqueada = true;
          atualizarBannerVoz();
        }
      });
    }, 700);
  }

  // ═══════════════════ TECLAS DO CONTROLE ═══════════════════

  var NAV = { 37: 1, 38: 1, 39: 1, 40: 1, 13: 1, 32: 1, 8: 1, 27: 1, 19: 1, 413: 1, 415: 1, 10252: 1, 10009: 1, 461: 1 };

  document.addEventListener("keydown", function (e) {
    var code = e.keyCode;
    if (!NAV[code]) return;
    e.preventDefault();

    // primeiro toque destrava a voz (exigência de alguns navegadores)
    if (!S.voiceUnlocked) {
      S.voiceUnlocked = true;
      Voice.unlocked = true;
      S.vozBloqueada = false;
      atualizarBannerVoz();
      if (S.tela === "home" && S.greetingTxt) Voice.falar(S.greetingTxt, { interrupt: true });
    }
    S.userNav = Date.now();

    // ── PLAYER: cuida das próprias teclas ──
    if (S.tela === "player") {
      if ([8, 27, 413, 10009, 461].indexOf(code) >= 0) { sairDoPlayer(); return; }
      if ([13, 32, 19, 413, 415, 10252].indexOf(code) >= 0) {
        var video = $("video");
        if (!video || P.status !== "tocando") return;
        try { if (video.paused) tocarVideo(video); else video.pause(); } catch (err) {}
      }
      return;
    }

    // ── CANAIS ──
    if (S.tela === "canais") {
      if ([8, 27, 10009, 461].indexOf(code) >= 0) { voltarHome(); return; }
      if (!S.canais || !S.canais.length) {
        if (code === 13 && S.canaisErro && S.jogoSel) abrirJogo(S.jogoSel, S.abriuIdx, true);
        return;
      }
      if (code === 38) { S.canalSel = Math.max(0, S.canalSel - 1); renderCanais(); }
      else if (code === 40) { S.canalSel = Math.min(S.canais.length - 1, S.canalSel + 1); renderCanais(); }
      else if (code === 13) abrirCanal(S.canalSel);
      return;
    }

    // ── HOME ──
    if (S.erro && !S.jogos) {
      if (code === 13) carregarJogos(true);
      return;
    }
    var total = focaveis.length;
    if (!total) return;
    if (code === 37) { S.foco = Math.max(0, S.foco - 1); aplicarFoco(); narrarFoco(); }
    else if (code === 39) { S.foco = Math.min(total - 1, S.foco + 1); aplicarFoco(); narrarFoco(); }
    else if (code === 38) { S.foco = Math.max(0, S.foco - cols); aplicarFoco(); narrarFoco(); }
    else if (code === 40) { S.foco = Math.min(total - 1, S.foco + cols); aplicarFoco(); narrarFoco(); }
    else if (code === 13) {
      var item = focaveis[S.foco];
      if (item) abrirJogo(item.jogo, S.foco, false);
    }
  });

  // Cliques (úteis no PC e em TVs com mouse/touch)
  $("telaHome").addEventListener("click", function (e) {
    var alvo = maisProximo(e.target, "[data-idx]");
    if (!alvo) return;
    var idx = parseInt(alvo.getAttribute("data-idx"), 10);
    if (isNaN(idx) || !focaveis[idx]) return;
    abrirJogo(focaveis[idx].jogo, idx, false);
  });

  $("telaCanais").addEventListener("click", function (e) {
    var alvo = maisProximo(e.target, "[data-canal]");
    if (!alvo) return;
    abrirCanal(parseInt(alvo.getAttribute("data-canal"), 10));
  });

  // ═══════════════════════════ BOOT ═══════════════════════════

  function boot() {
    Voice.init();
    if (!Voice.disponivel) S.semVoz = true;
    atualizarBannerVoz();
    bindVideo();
    S.agora = new Date();
    carregarJogos(false);

    // relógio + status dos jogos a cada 20s (sem recriar a tela)
    setInterval(function () {
      S.agora = new Date();
      if (S.tela === "home" && S.jogos && !S.erro) atualizarStatuses();
    }, 20000);

    // atualiza os jogos a cada 5 minutos (em silêncio)
    setInterval(function () {
      if (S.tela === "home") carregarJogos(false);
    }, 5 * 60 * 1000);
  }

  boot();
})();
