# JOGOS DO VASCO — Módulo TizenBrew (tudo embutido, sem servidor)

App de TV pro torcedor idoso que não lê: **a voz conta os jogos do Vasco,
narra o que está selecionado e abre a transmissão** — setas + OK + VOLTAR,
letras gigantes, preto e branco do Vasco.

**Esta versão não precisa de servidor, PC ligado nem link de app.**
A "API" é o próprio arquivo `scraper.js` rodando dentro da TV: ele busca os
jogos, os canais e o link do vídeo direto na fonte (igual fazia o servidor),
e o `hls.js` embutido toca o jogo. São 6 arquivos, nada mais.

```
package.json       → ficha do módulo pro TizenBrew
index.html         → a tela (visual, foco, rodapé de dicas)
app.js             → voz, narração, teclas do controle, player
scraper.js         → a API embutida (busca jogos/canais/vídeo em JS puro)
hls.light.min.js   → tocador de vídeo (hls.js, embutido)
icon.png           → escudo do Vasco
```

---

## 1. Instalar o TizenBrew na TV (uma vez só)

1. Na TV: `Configurações → Geral → Gerenciador de dispositivo externo →
   Gerenciador de conexão`… na prática, o que vale é **ativar o modo de
   desenvolvimento**: vá em `Apps`, digite no controle `12345` e ative
   **Developer Mode** (pode pedir o IP do PC).
2. No PC: baixe o **TizenBrewInstaller** em
   <https://github.com/reisxd/TizenBrew> (página tem o passo a passo com
   figuras) e instale o **TizenBrew Service** na TV pelo IP dela.
3. Volte à TV: o app **TizenBrew** aparece na barra de aplicativos.

## 2. Publicar o módulo no GitHub (uma vez só)

O TizenBrew instala módulos "app" puxando de um repositório público.

1. Crie uma conta no GitHub (se não tiver) e um repositório **público**
   novo, ex.: `jogos-do-vasco`.
2. Faça upload dos **6 arquivos listados acima NA RAIZ do repositório**
   (botão *Add file → Upload files*; os arquivos não podem ficar dentro de
   pasta). Dá pra fazer arrastando os arquivos no site do GitHub, sem
   instalar nada no PC.
3. Clique em *Commit changes*.

## 3. Adicionar o módulo na TV

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

## Problemas comuns

- **"Não consegui buscar os jogos agora"** → internet da TV caiu. OK tenta
  de novo. Se persistir, a fonte (site do futemais) pode estar fora do ar —
  espera um pouco.
- **"Nesse jogo ainda não tem canal"** → normal perto demais da hora; os
  canais aparecem mais perto do início.
- **Vídeo não abre / tela de erro** → o link do canal expirou; o app já
  tenta 4 vezes sozinho com token novo. Aperte VOLTAR e tente outro canal.
- **TV sem voz nenhuma** → modelos antes de 2021 não têm TTS pro app; o
  resto funciona normal.
