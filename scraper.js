/**
 * ============================================================================
 * JOGOS DO VASCO — scraper do módulo (v3: API na Vercel como caminho primário)
 * ============================================================================
 * A partir da v3 o módulo é SÓ UI: quem conversa com o futemais é a API
 * publicada na Vercel (lib/futemais.js do projeto futemais-api), que devolve
 * JSON prontinho. Vantagens pra TV:
 *   - parsing de HTML fora da TV (o engine velho do Samsung não quebra mais)
 *   - o site do futemais mudou de endereço/estrutura? Corrige-se na API e o
 *     deploy é na hora — sem depender de cache de CDN na TV
 *   - até os escudos vêm pela API (/api/img): a TV não fala com o futemais
 *
 * Se API_BASE não estiver configurada (ou a API falhar), o módulo volta pro
 * middleman EMBUTIDO aqui embaixo — a porta fiel do scraper original rodando
 * dentro da própria TV:
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

  // ─── API EXTERNA (VERCEL) — caminho PRIMÁRIO ─────────────────────────────
  // COLE AQUI a URL do teu deploy (sem barra no final). Exemplo:
  //   var API_BASE = "https://vasco-api.vercel.app";
  var API_BASE = "";
  // Atalho pra testar sem editar código: abra o módulo com
  //   ?api=https://teu-api.vercel.app
  var apiBase = (function () {
    try {
      var m = String(location.search || "").match(/[?&]api=([^&]+)/);
      if (m) return decodeURIComponent(m[1]).replace(/\/+$/, "");
    } catch (e) { /* sem location disponível */ }
    return String(API_BASE || "").replace(/\/+$/, "");
  })();
  var fonteAtual = apiBase ? "api" : "direto";

  /** Chamada GET na API (JSON {ok:true,...}); erro qualquer → reject */
  function apiGet(rota) {
    return xhrPromessa("GET", apiBase + rota, null, false).then(function (txt) {
      var d;
      try { d = JSON.parse(txt); } catch (e) { throw new Error("api nao devolveu json"); }
      if (!d || d.ok !== true) throw new Error("api: " + ((d && d.erro) || "resposta invalida"));
      return d;
    });
  }

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
  /** Caminho direto (middleman embutido): embed → token → POST refresh */
  function resolverHlsDireto(canal) {
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
        fonteAtual = "direto";
        return canal.hls_url;
      });
  }

  /** Resolvo pela API (primário) e, se falhar, pelo middleman embutido. */
  function resolverHls(canal, forcar) {
    var agoraSec = Math.floor(Date.now() / 1000);

    // Token ainda válido? (margem de 120s, igual à API)
    if (!forcar && canal.hls_url && canal.expires_at > agoraSec + 120) {
      return Promise.resolve(canal.hls_url);
    }

    var viaApi = apiBase
      ? apiGet("/api/stream?u=" + encodeURIComponent(canal.embed_url)).then(function (d) {
          if (!d.url) throw new Error("api: sem url do video");
          fonteAtual = "api";
          canal.hls_url = d.url;
          var expire = Number(d.expire || 0);
          canal.expires_at = isFinite(expire) ? Math.floor(expire) : 0;
          return canal.hls_url;
        })
      : Promise.reject(new Error("api nao configurada"));
    return viaApi.catch(function () {
      return resolverHlsDireto(canal);
    });
  }

  // ─── API pública (a mesma cara das rotas /api/jogos do app) ────────────────
  // O futemais vive trocando de endereço por região (no Brasil o
  // apk.futemais.eu cai no espelho futemais.link, e a raiz do espelho é uma
  // página SEM jogos — por isso a TV mostrava "nenhum jogo" sem erro).
  // Se a listagem vier vazia ou falhar, o módulo troca de host sozinho: o
  // espelho serve a MESMA página de jogos, com os links absolutos dele.
  var BASES_LISTA = [
    "https://apk.futemais.eu/app2/",
    "https://futemais.link/app2/"
  ];
  var hostLista = 0; // índice da base que funcionou por último

  function basesNaOrdem() {
    var ordem = [BASES_LISTA[hostLista]];
    for (var i = 0; i < BASES_LISTA.length; i++) {
      if (i !== hostLista) ordem.push(BASES_LISTA[i]);
    }
    return ordem;
  }

  function tentarBases(bases, i) {
    if (i >= bases.length) return Promise.resolve([]);
    return httpGet(bases[i]).then(function (html) {
      var jogos = parseJogos(html);
      if (jogos.length > 0) {
        for (var j = 0; j < BASES_LISTA.length; j++) {
          if (bases[i] === BASES_LISTA[j]) { hostLista = j; break; }
        }
        return jogos;
      }
      // respondeu, mas veio sem jogos (página de enfeite/redirect regional)
      return tentarBases(bases, i + 1);
    }, function (erro) {
      if (i + 1 < bases.length) return tentarBases(bases, i + 1);
      throw erro; // último host falhou de verdade — deixa o erro subir
    });
  }

  function listarJogos(forcar) {
    if (!forcar && cacheJogos.data && Date.now() - cacheJogos.at < MATCHES_TTL) {
      return Promise.resolve(cacheJogos.data);
    }
    // Primário: API na Vercel (JSON pronto). Plano B: middleman embutido.
    var viaApi = apiBase
      ? apiGet("/api/jogos").then(function (d) {
          fonteAtual = "api";
          return d.jogos || [];
        })
      : Promise.reject(new Error("api nao configurada"));
    return viaApi.catch(function () {
      fonteAtual = "direto";
      return tentarBases(basesNaOrdem(), 0);
    }).then(function (jogos) {
      if (jogos.length > 0) {
        cacheJogos = { at: Date.now(), data: jogos };
      } else {
        // dia sem jogo de verdade: não cacheia, pra re-testar no próximo ciclo
        cacheJogos = { at: 0, data: null };
      }
      return jogos;
    });
  }

  /** Preenche jogo.channels e devolve os canais (cache de 2 min).
   *  links2.futemais.eu e temporariofutemais.com servem a MESMA página de
   *  canais (cada listagem aponta pra um deles): se um vier vazio ou falhar,
   *  tenta o outro uma vez. 0 canais também é estado válido ("ainda não tem"). */
  function hostAlternativoDeCanais(url) {
    if (url.indexOf("links2.futemais.eu") >= 0) {
      return url.replace("links2.futemais.eu", "temporariofutemais.com");
    }
    if (url.indexOf("temporariofutemais.com") >= 0) {
      return url.replace("temporariofutemais.com", "links2.futemais.eu");
    }
    return "";
  }

  /** Caminho direto do meio: baixa a página de canais e faz o parsing aqui */
  function buscarCanaisDireto(url) {
    return httpGet(url).then(function (html) {
      return parseCanais(html);
    });
  }

  function canaisDoJogo(jogo, forcar) {
    var c = cacheCanais[jogo.match_id];
    if (!forcar && c && Date.now() - c.at < CHANNELS_TTL) {
      jogo.channels = c.data;
      return Promise.resolve(c.data);
    }
    function guardar(canais) {
      cacheCanais[jogo.match_id] = { at: Date.now(), data: canais };
      jogo.channels = canais;
      return canais;
    }
    // Primário: API na Vercel. Plano B: middleman embutido (com espelho).
    var viaApi = apiBase
      ? apiGet("/api/canais?id=" + encodeURIComponent(jogo.match_id)).then(function (d) {
          fonteAtual = "api";
          return d.canais || [];
        })
      : Promise.reject(new Error("api nao configurada"));
    return viaApi.catch(function () {
      fonteAtual = "direto";
      var alt = hostAlternativoDeCanais(jogo.detail_url);
      return buscarCanaisDireto(jogo.detail_url).then(function (canais) {
        if (canais.length > 0 || !alt) return canais;
        // veio vazia: pode ser página errada do redirect regional — tenta o espelho
        return buscarCanaisDireto(alt).then(function (altCanais) {
          return altCanais.length > 0 ? altCanais : canais;
        });
      }, function (erro1) {
        if (!alt) throw erro1;
        return buscarCanaisDireto(alt); // erro de rede/HTTP no principal → espelho
      });
    }).then(guardar);
  }

  global.FutemaisAPI = {
    listarJogos: listarJogos,
    canaisDoJogo: canaisDoJogo,
    resolverHls: resolverHls,
    /** de onde veio o último dado: "api" (Vercel) ou "direto" (middleman embutido) */
    fonte: function () { return fonteAtual; },
    /** pra depurar no console: "direto" (TV), "ponte" (PC via app) ou índice */
    transporte: function () { return transporte; },
    /** qual host da listagem funcionou por último (0 = apk, 1 = espelho) */
    hostLista: function () { return hostLista; },
    /** a URL da API que está em uso ("" = só middleman embutido) */
    apiBase: function () { return apiBase; }
  };
})(window);
