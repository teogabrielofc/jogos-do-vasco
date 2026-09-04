/**
 * ============================================================================
 * JOGOS DO VASCO — API EMBUTIDA (o "middleman" inteiro em JS padrao)
 * ============================================================================
 * Porta fiel do scraper (Python → TypeScript → JS padrao), rodando DENTRO da
 * propria TV. Nao precisa de servidor, PC ligado nem nada: o aparelho conversa
 * direto com o futemais e devolve jogos, canais e o link do video.
 *
 * Fluxo (igualzinho ao da API original):
 *   1. GET  apk.futemais.eu/app2/                     → lista de jogos (HTML)
 *   2. GET  links2.futemais.eu/canalapps.php?id=<ID>  → canais do jogo (HTML)
 *   3. GET  <player embed do canal>                   → PAGE_TOKEN + endpoint
 *   4. POST <REFRESH_ENDPOINT> { token }              → URL HLS assinada
 *
 * Compativel com webview antigo (Tizen 3, 2017+): so ES5, XHR, DOMParser e
 * Promise. Sem fetch, sem arrow function, sem async/await.
 *
 * CORS:
 *   - Na TV o TizenBrew Service tem <access origin="*"> + privilegio de
 *     internet, então a TV busca sites de qualquer domínio SEM esbarrar em
 *     CORS. O caminho DIRETO sempre funciona e nada de fallback é acionado.
 *   - No navegador do PC (pré-visualização) o CORS bloqueia a leitura. Nesse
 *     caso o módulo refaz a chamada pela PONTE same-origin (/api/pipe, que
 *     existe no app Jogos do Vasco — sirva o módulo pelo app e pronto) e, se
 *     a ponte não existir nesta origem, tenta proxies públicos best-effort.
 */
(function (global) {
  "use strict";

  // ─── Constantes (iguais à API original) ────────────────────────────────────
  var BASE_APP = "https://apk.futemais.eu/app2/";
  var BASE_IMGS = "https://apk.futemais.eu";
  var TIMEOUT_MS = 15000;
  var MATCHES_TTL = 5 * 60 * 1000; // 5 min
  var CHANNELS_TTL = 2 * 60 * 1000; // 2 min

  // ─── Cache em memória (iguais à API original) ──────────────────────────────
  var cacheJogos = { at: 0, data: null };
  var cacheCanais = {}; // match_id → { at, data }

  // ─── HTTP por XHR (roda em qualquer webview, até as antigas) ───────────────
  function xhrPromessa(metodo, url, corpo, ehJson) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      var acabou = false;

      // Timeout manual: webview de TV antiga não tem AbortController
      var timer = setTimeout(function () {
        if (acabou) return;
        acabou = true;
        try { xhr.abort(); } catch (e) { /* já era */ }
        reject(new Error("tempo esgotado: " + url));
      }, TIMEOUT_MS);

      try {
        xhr.open(metodo, url, true);
        try { xhr.setRequestHeader("Accept-Language", "pt-BR,pt;q=0.9"); } catch (e) {}
        if (ehJson) {
          try { xhr.setRequestHeader("Content-Type", "application/json"); } catch (e) {}
        }
      } catch (err) {
        clearTimeout(timer);
        reject(err);
        return;
      }

      xhr.onreadystatechange = function () {
        if (acabou || xhr.readyState !== 4) return;
        acabou = true;
        clearTimeout(timer);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.responseText);
        } else if (xhr.status === 0) {
          // Status 0 = leitura bloqueada por CORS (o Chromium às vezes nem
          // dispara onerror, só fecha com status 0) ou rede fora. Mesmo
          // tratamento do onerror — é o gatilho do fallback pra ponte.
          reject(new Error("erro de rede: " + url));
        } else {
          reject(new Error(metodo + " " + url + " falhou: " + xhr.status));
        }
      };
      xhr.onerror = function () {
        if (acabou) return;
        acabou = true;
        clearTimeout(timer);
        reject(new Error("erro de rede: " + url));
      };
      xhr.send(corpo || null);
    });
  }

  function httpGet(url) {
    return comFallback("GET", url, null, false);
  }

  function httpPostJson(url, payload) {
    return comFallback("POST", url, JSON.stringify(payload), true).then(function (txt) {
      try {
        return JSON.parse(txt);
      } catch (e) {
        throw new Error("resposta nao e JSON: " + url);
      }
    });
  }

  // ─── Fallback de CORS (só liga no navegador do PC) ─────────────────────────
  // O XHR direto é o caminho da TV. Se o PC bloquear a leitura (status 0 na
  // hora = CORS), refazemos pela ponte same-origin /api/pipe do app e, em
  // último caso, por proxies públicos (GET apenas, best-effort). O transporte
  // que funcionar fica memorizado pra não repetir o teste a cada chamada.
  var PONTE = "/api/pipe?u=";
  var PROXYS_PUBLICOS = [
    function (u) { return "https://api.allorigins.win/raw?url=" + encodeURIComponent(u); },
    function (u) { return "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u); }
  ];

  var transporte = "direto"; // "direto" | "ponte" | índice do proxy público
  var ponteVerificada = false;
  var ponteOk = false;

  function viaPonte(url) {
    return PONTE + encodeURIComponent(url);
  }

  /** A ponte existe nesta origem? Testa 1x: /api/pipe sem ?u responde 400. */
  function descobrirPonte() {
    if (ponteVerificada) return Promise.resolve(ponteOk);
    ponteVerificada = true;
    return xhrPromessa("GET", "/api/pipe", null, false).then(function () {
      ponteOk = true;
      return true;
    }, function (erro) {
      // 400 = rota existe (pediu ?u que faltava); qualquer outra coisa
      // (404 de rota inexistente, status 0 de file://) = não há ponte aqui.
      ponteOk = String(erro && erro.message || "").indexOf(": 400") >= 0;
      return ponteOk;
    });
  }

  function foiBloqueioCORS(erro) {
    // "erro de rede:" = XHR morreu com status 0 na hora (CORS). Timeout e
    // erro HTTP de verdade NÃO acionam fallback (proxy não resolveria).
    return !!erro && String(erro.message || "").indexOf("erro de rede:") === 0;
  }

  function comFallback(metodo, url, corpo, ehJson) {
    if (transporte === "ponte") {
      return xhrPromessa(metodo, viaPonte(url), corpo, ehJson).catch(
        function (erro) {
          transporte = "direto"; // o que estava memorizado morreu; re-testa tudo
          throw erro;
        }
      );
    }
    if (typeof transporte === "number") {
      return xhrPromessa(metodo, PROXYS_PUBLICOS[transporte](url), corpo, ehJson).catch(
        function (erro) {
          transporte = "direto"; // idem
          throw erro;
        }
      );
    }

    return xhrPromessa(metodo, url, corpo, ehJson).catch(function (erro) {
      if (!foiBloqueioCORS(erro)) throw erro;

      // POST por proxy público não existe (só fazem GET) — ponte ou nada.
      if (metodo === "POST") {
        return descobrirPonte().then(function (temPonte) {
          if (!temPonte) throw erro;
          return xhrPromessa(metodo, viaPonte(url), corpo, ehJson).then(function (txt) {
            transporte = "ponte";
            return txt;
          });
        });
      }

      // GET: monta a fila [ponte?] + proxies públicos e pega o 1º que responder
      return descobrirPonte().then(function (temPonte) {
        var fila = [];
        if (temPonte) fila.push({ nome: "ponte", req: viaPonte(url) });
        for (var i = 0; i < PROXYS_PUBLICOS.length; i++) {
          fila.push({ nome: i, req: PROXYS_PUBLICOS[i](url) });
        }
        if (fila.length === 0) throw erro;

        return fila.reduce(function (corrente, cand) {
          return corrente.catch(function () {
            return xhrPromessa(metodo, cand.req, corpo, ehJson).then(function (txt) {
              transporte = cand.nome;
              return txt;
            });
          });
        }, Promise.reject(erro));
      });
    });
  }

  // ─── Parsing do HTML com DOMParser (padrão do navegador) ───────────────────
  function parseDoc(html) {
    return new DOMParser().parseFromString(html, "text/html");
  }

  function texto(elm, seletor) {
    if (!elm) return "";
    var alvo = seletor ? elm.querySelector(seletor) : elm;
    return alvo && alvo.textContent ? alvo.textContent.trim() : "";
  }

  function atributo(elm, seletor, nome) {
    if (!elm) return "";
    var alvo = seletor ? elm.querySelector(seletor) : elm;
    if (alvo && alvo.getAttribute) {
      var v = alvo.getAttribute(nome);
      return v || "";
    }
    return "";
  }

  function absolutizar(src) {
    if (!src) return "";
    if (src.indexOf("http") === 0) return src;
    if (src.charAt(0) === "/") return BASE_IMGS + src;
    return BASE_IMGS + "/" + src;
  }

  /** Resolve endpoint relativo do player contra a URL do embed (como new URL()) */
  function absolutizarEndpoint(end, base) {
    if (end.indexOf("http") === 0) return end;
    var m = base.match(/^https?:\/\/[^\/]+/);
    var origem = m ? m[0] : "";
    if (end.charAt(0) === "/") return origem + end;
    var dir = base.replace(/[^\/]*(\?.*)?$/, "");
    return dir + end;
  }

  // ─── Parsing da lista de jogos ─────────────────────────────────────────────
  function parseJogos(html) {
    var doc = parseDoc(html);
    var jogos = [];
    var containers = doc.querySelectorAll(".albaflex .match-container");

    for (var i = 0; i < containers.length; i++) {
      var c = containers[i];
      var link = c.querySelector("a[href]");
      if (!link) continue;

      var href = link.getAttribute("href") || "";
      var mId = href.match(/id=(\d+)/);
      if (!mId) continue;

      var right = c.querySelector(".right-team");
      var left = c.querySelector(".left-team");
      var center = c.querySelector(".match-center");

      // Data: sobe pro grupo (.albaflex) e caminha pelos irmãos de trás
      // procurando o separador de data mais próximo antes dele
      var matchDate = "";
      var sib = c.parentNode ? c.parentNode.previousElementSibling : null;
      while (sib && !matchDate) {
        var sep = sib.querySelector(".data-separador .sep-data");
        if (!sep && sib.className && String(sib.className).indexOf("data-separador") >= 0) {
          sep = sib.querySelector(".sep-data");
        }
        if (sep) matchDate = sep.textContent.trim();
        sib = sib.previousElementSibling;
      }

      jogos.push({
        match_id: mId[1],
        home_team: texto(right, ".team-name") || "?",
        away_team: texto(left, ".team-name") || "?",
        championship: texto(center, "#match"),
        match_time: texto(center, "#match-time"),
        match_date: matchDate,
        home_logo_url: absolutizar(atributo(right, ".team-logo img", "src")),
        away_logo_url: absolutizar(atributo(left, ".team-logo img", "src")),
        detail_url: href,
        channels: []
      });
    }
    return jogos;
  }

  // ─── Parsing dos canais do jogo ────────────────────────────────────────────
  function parseCanais(html) {
    var doc = parseDoc(html);
    var canais = [];
    var ths = doc.querySelectorAll("table.canais th");
    for (var i = 0; i < ths.length; i++) {
      var a = ths[i].querySelector("a[onclick]");
      if (!a) continue;
      var onclick = a.getAttribute("onclick") || "";
      var m = onclick.match(/changeChannel\(['"](.+?)['"]\)/);
      var label = a.textContent.trim();
      if (m && m[1]) {
        canais.push({ label: label, embed_url: m[1], hls_url: "", expires_at: 0 });
      }
    }
    return canais;
  }

  // ─── Resolução do HLS (a URL do vídeo de verdade) ──────────────────────────
  function resolverHls(canal, forcar) {
    var agoraSec = Math.floor(Date.now() / 1000);

    // Token ainda válido? (margem de 120s, igual à API)
    if (!forcar && canal.hls_url && canal.expires_at > agoraSec + 120) {
      return Promise.resolve(canal.hls_url);
    }

    return httpGet(canal.embed_url)
      .then(function (playerHtml) {
        var mToken = playerHtml.match(/PAGE_TOKEN\s*=\s*["']([^"']+)["']/);
        if (!mToken) throw new Error("PAGE_TOKEN nao encontrado");
        var mEnd = playerHtml.match(/REFRESH_ENDPOINT\s*=\s*['"]([^'"]+)['"]/);
        if (!mEnd) throw new Error("REFRESH_ENDPOINT nao encontrado");
        return httpPostJson(absolutizarEndpoint(mEnd[1], canal.embed_url), {
          token: mToken[1]
        });
      })
      .then(function (data) {
        if (!data || typeof data.url !== "string" || !data.url) {
          throw new Error("sem url do video na resposta");
        }
        canal.hls_url = data.url;
        var expire = Number(data.expire || 0);
        canal.expires_at = isFinite(expire) ? Math.floor(expire) : 0;
        return canal.hls_url;
      });
  }

  // ─── API pública (a mesma cara das rotas /api/jogos do app) ────────────────
  function listarJogos(forcar) {
    if (!forcar && cacheJogos.data && Date.now() - cacheJogos.at < MATCHES_TTL) {
      return Promise.resolve(cacheJogos.data);
    }
    return httpGet(BASE_APP).then(function (html) {
      var jogos = parseJogos(html);
      cacheJogos = { at: Date.now(), data: jogos };
      return jogos;
    });
  }

  /** Preenche jogo.channels e devolve os canais (cache de 2 min) */
  function canaisDoJogo(jogo, forcar) {
    var c = cacheCanais[jogo.match_id];
    if (!forcar && c && Date.now() - c.at < CHANNELS_TTL) {
      jogo.channels = c.data;
      return Promise.resolve(c.data);
    }
    return httpGet(jogo.detail_url).then(function (html) {
      var canais = parseCanais(html);
      cacheCanais[jogo.match_id] = { at: Date.now(), data: canais };
      jogo.channels = canais;
      return canais;
    });
  }

  global.FutemaisAPI = {
    listarJogos: listarJogos,
    canaisDoJogo: canaisDoJogo,
    resolverHls: resolverHls,
    /** pra depurar no console: "direto" (TV), "ponte" (PC via app) ou índice */
    transporte: function () { return transporte; }
  };
})(window);
