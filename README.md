# JOGOS DO VASCO — Módulo TizenBrew (v3: só a tela + API na Vercel)

App de TV pro torcedor idoso que não lê: **a voz conta os jogos do Vasco,
narra o que está selecionado e abre a transmissão** — setas + OK + VOLTAR,
letras gigantes, preto e branco do Vasco.

**Na v3 o módulo é só a tela: quem busca os jogos é a API publicada na
Vercel** (grátis). Isso resolve os dois problemas que a TV estava tendo:

1. O **engine JavaScript velho do Samsung** não precisa mais entender o HTML
   do site — a API entrega JSON prontinho (e até os escudos vêm pela API);
2. Quando o site do futemais muda de endereço/estrutura, **conserta-se na
   API e vale na hora** — sem depender do cache do jsDelivr na TV.

O módulo continua com o middleman embutido de sempre (scraper.js): se a API
estiver fora do ar, ele tenta buscar direto da fonte por conta própria.

```
package.json       → ficha do módulo pro TizenBrew
index.html         → a tela (visual, foco, rodapé de dicas)
app.js             → voz, narração, teclas do controle, player
scraper.js         → liga na API da Vercel (e tem o plano B embutido)
hls.light.min.js   → tocador de vídeo (hls.js, embutido)
icon.png           → escudo do Vasco
```

---

## 0. Publicar a API na Vercel (uma vez só, ~5 min, grátis)

A pasta `futemais-api` que veio junto tem TUDO. O passo a passo completo
está no `futemais-api/README.md` — resumo:

1. Cria conta em **vercel.com** usando o GitHub.
2. Cria um repositório novo no GitHub (ex.: `vasco-api`) e sobe o conteúdo
   da pasta `futemais-api` na raiz dele (`api/`, `lib/`, `package.json`,
   `vercel.json`).
3. Na Vercel: **Add New → Project → Import** o `vasco-api` → **Deploy**
   (não mexe em nada). Vai vir uma URL tipo `https://vasco-api.vercel.app`.
4. Testa no navegador: `https://vasco-api.vercel.app/api/ping` → tem que
   aparecer `{"ok":true,...}`.

## 1. Apontar o módulo pra tua API

1. Abre o `scraper.js` do módulo (aqui ou no GitHub, botão do lápis ✏️).
2. No topo, cola a tua URL:

   ```js
   var API_BASE = "https://vasco-api.vercel.app";
   ```

3. Pronto. Dá pra testar no PC sem editar nada abrindo o módulo com
   `?api=https://vasco-api.vercel.app` no fim do link.

## 2. Instalar o TizenBrew na TV (uma vez só)

1. Na TV: `Configurações → Geral → Gerenciador de dispositivo externo →
   Gerenciador de conexão`… na prática, o que vale é **ativar o modo de
   desenvolvimento**: vá em `Apps`, digite no controle `12345` e ative
   **Developer Mode** (pode pedir o IP do PC).
2. No PC: baixe o **TizenBrewInstaller** em
   <https://github.com/reisxd/TizenBrew> (página tem o passo a passo com
   figuras) e instale o **TizenBrew Service** na TV pelo IP dela.
3. Volte à TV: o app **TizenBrew** aparece na barra de aplicativos.

## 3. Publicar o módulo no GitHub (uma vez só)

O TizenBrew instala módulos "app" puxando de um repositório público.

1. Crie uma conta no GitHub (se não tiver) e um repositório **público**
   novo, ex.: `jogos-do-vasco`.
2. Faça upload dos **6 arquivos listados acima NA RAIZ do repositório**
   (botão *Add file → Upload files*; os arquivos não podem ficar dentro de
   pasta). Dá pra fazer arrastando os arquivos no site do GitHub, sem
   instalar nada no PC.
3. Clique em *Commit changes*.

### ⚠️ Atualizou o módulo no GitHub? Limpa o cache do jsDelivr!

O TizenBrew baixa os arquivos do módulo pelo **jsDelivr** (um CDN), e esse
CDN **guarda os arquivos velhos por horas** — foi por isso que atualizações
não chegavam na TV (o famoso "mesma coisa"). Depois de TODO commit, abra no
navegador (PC ou celular) o link de purge pra cada arquivo que mudou:

```
https://purge.jsdelivr.net/gh/SEU-USUARIO/SEU-REPO@main/scraper.js
```

Aparece algo como `... "status":"ok"` — aí é só reabrir o módulo na TV.

### Como saber se a TV pegou a versão nova? Olhe o selo no rodapé

A partir da **v3.0.1** a tela principal mostra no cantinho direito do rodapé
um selo cinza pequeno com a versão e a fonte dos dados:

- `v3.0.1 · API: seu-projeto.vercel.app` → rodando o código novo e buscando
  da tua API na Vercel (é assim que tem que estar).
- `v3.0.1 · API: ... (caiu p/ direto)` → a API falhou e o módulo usou o
  middleman embutido de reserva (na TV do Brasil esse caminho costuma dar
  "nenhum jogo" — checa se a Vercel tá no ar).
- `v3.0.1 · direto (API não configurada)` → o `API_BASE` do scraper.js no
  teu repo está vazio — cola a URL da Vercel lá (seção 1).
- **O selo não aparece de jeito nenhum?** A TV está rodando um código velho
  em cache — faz o purge do jsDelivr acima e reabre o módulo.


## 4. Adicionar o módulo na TV

1. Abra o **TizenBrew** na TV.
2. Vá em **Gerenciador de módulos → Adicionar módulo do GitHub**
   (botão verde).
3. Digite `seuusuario/jogos-do-vasco` e confirme. Ele baixa e instala.
4. Abra o módulo **Jogos do Vasco** na lista. A voz dá o bom dia/boa noite
   na hora.

### Abrir sozinho quando ligar a TV (opcional, recomendado)

No TizenBrew: **Configurações → Autolaunch → Jogos do Vasco**.
Ligou a TV, tá falando os jogos. Pra voltar pro TizenBrew, aperte VOLTAR
no controle.

---

## A voz

- No **navegador de PC** a voz só fala depois do primeiro toque (regra do
  Chrome) — por isso aparece o aviso "Aperte qualquer botão pra ouvir".
- Na **TV**, se o modelo tiver voz pronta (Tizen 6.5+, 2021 em diante), o
  app usa o TTS nativo; se não tiver, **tudo continua funcionando** com as
  letras gigantes — só fica sem narração.
- Se um dia o site da fonte começar a bloquear o acessório/TV, existe
  **Configurações → User Agent** no TizenBrew pra trocar o UA (o app
  avisa na tela se a lista de jogos não carregar).

## Controle remoto

| Botão | O que faz |
|---|---|
| Setas | Move o destaque gigante (a voz narra cada jogo) |
| OK | Abre os canais do jogo; de novo, assiste; no vídeo, pausa/despausa |
| VOLTAR | Volta: vídeo → canais → home; na home, sai do app |

## Ver no PC (pré-visualização)

O módulo roda na TV SEM CORS (o TizenBrew tem `<access origin="*">`, o Tizen
ignora a política de mesma origem). No navegador do PC isso não vale — mas o
módulo v2.1+ se vira sozinho: se o navegador bloquear a leitura do futemais,
ele refaz a chamada pela **ponte `/api/pipe`** do app Jogos do Vasco.

- **Jeito fácil**: abra `<link do app>/tizenbrew/index.html` no navegador
  (o app serve o módulo pronto em `public/tizenbrew/`). Tudo funciona:
  jogos, canais e até o vídeo ao vivo.
- **Abrir o `index.html` solto (duplo clique / file://)**: a ponte não existe
  nessa origem; o módulo tenta proxies públicos best-effort — se todos
  estiverem fora, aparece "Não consegui buscar os jogos". Na TV isso nunca
  acontece (caminho direto).
- Depois de editar qualquer arquivo do módulo, rode `scripts/sync_module.sh`
  pra espelhar em `public/tizenbrew/` e re-empacotar o `download/`.

## Problemas comuns

- **"Nenhum jogo listado hoje" na TV, mas tem jogo no celular** → três
  suspeitos, nessa ordem:
  1. **Cache do jsDelivr** — a TV recebendo o scraper velho depois de um
     commit. Abre o link de purge (seção 3) e reabre o módulo.
  2. **API não configurada / API fora do ar** — confere se o `API_BASE` no
     topo do `scraper.js` está com a URL certa e se `/api/ping` responde no
     navegador. Sem API, o módulo tenta direto na fonte — e aí o redirect
     regional pro espelho `futemais.link` pode entregar a página de desafio
     do Cloudflare (parece página vazia, dá "0 jogos" sem erro). É exatamente
     por isso que a API na Vercel é o caminho recomendado.
  3. **Dia sem jogo mesmo** — o Vasco às vezes descansa.
- **Depois de mudar algo na API, preciso mexer no módulo?** → Não. Só mexe
  no módulo se mudar a URL dela. Correções de parsing são commit na API.
- **"Não consegui buscar os jogos agora"** → internet da TV caiu. OK tenta
  de novo. Se persistir, a fonte (site do futemais) pode estar fora do ar —
  espera um pouco.
- **"Nesse jogo ainda não tem canal"** → normal perto demais da hora; os
  canais aparecem mais perto do início.
- **Vídeo não abre / tela de erro** → o link do canal expirou; o app já
  tenta 4 vezes sozinho com token novo. Aperte VOLTAR e tente outro canal.
- **TV sem voz nenhuma** → modelos antes de 2021 não têm TTS pro app; o
  resto funciona normal.
