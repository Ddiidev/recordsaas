# RecordSaaS Agent Memory

Leitura obrigatoria, inteira, no inicio de todo novo prompt de manutencao deste repositorio. Este arquivo guarda apenas regras criticas e duraveis; detalhes de tarefa ficam nos WIPs em `tasks/*/workground/`.

## Regras de manutencao

- Ler este arquivo antes de `AGENTS.MD`; depois seguir `AGENTS.MD` e inspecionar somente dominio pedido.
- Adicionar aqui somente fato confirmado que evita regressao recorrente. Manter curto; substituir regra obsoleta, nao acumular historico.
- WIP registra evidencia, pedido do usuario, validacoes e pendencias. Nao duplicar WIP aqui.

## Editor: seek e playback

- Travamento extremo que cresce conforme o ponto buscado pode vir do GOP da gravacao, nao do loop do preview. Confirmado em 2026-08-06: tela H.264 NVENC 1080p60, 588 s e 35.302 frames tinha somente um IDR em `t=0`; seek em 563 s levou ~82 s, enquanto webcam com keyframes periodicos levou ~0,2 s. Gravar CFR e decodificar do inicio sem erro nao validam seek. Exigir GOP explicito de no maximo dois segundos e testar seek proximo do fim. Arquivo existente precisa reencode; remux nao cria keyframes.
- Nesse artefato de um IDR, o fallback de 1,5 s limpa o in-flight logico enquanto `video.seeking` continua; novo salto reinicia o decode e saltos repetidos podem manter o app travado indefinidamente. Canvas depende de frame novo da tela, entao webcam recuperada por baixo tambem parece congelada. Timeout pode liberar UI, mas nunca representar conclusao fisica do seek.
- `systemAudioMuted=true` nao evita decode. O projeto `ReportandoBugV` falhou no Chromium com `PIPELINE_ERROR_DECODE` no pacote final do computer audio, embora a validacao FFmpeg tivesse passado; audio mutado e corrompido precisa ser isolado do playback.
- Sintoma somente no preview/editor, com exportacao correta: investigar React/media elements/seek antes de captura, WASAPI ou FFmpeg.
- Seek deve sincronizar video principal, canvas, webcam, audio de gravacao, audio do computador, audio de midia e instancias de monitor.
- Durante scrub: pausar fontes, coalescer entrada por `requestAnimationFrame` e manter somente um seek de decoder em voo; guardar apenas o ultimo alvo pendente ate `seeked`. Registrar listener final antes do ultimo seek e liberar scrub no proximo frame. Preservar estado anterior: se estava tocando, retomar apos seek; se estava pausado, continuar pausado. `currentTime` e operacional, fora de undo/redo; playhead o assina isoladamente, sem re-renderizar toda timeline.
- Nunca chamar `HTMLMediaElement.play()` novamente enquanto promessa anterior ainda esta pendente. `AbortError` por pause/seek e esperado; nao registrar em loop. Manter intencao de playback para retentar uma vez apos interrupcao.
- Seek de audio separado e de monitor usa a mesma fila por `HTMLMediaElement`: um seek em voo, somente ultimo destino pendente. Nao escrever `currentTime` diretamente em cada `timeupdate`.
- Quando monitor termina seek depois do video principal, agendar um unico redraw no proximo frame; scrub suprime redraw por `currentTime`, mas nao pode congelar frame de monitor atrasado.
- O canvas do preview e composicoes aninhadas usam raster limitado ao tamanho visivel da stage e DPR limitado; `canvasDimensions` e tamanho canonico de export, nao resolucao obrigatoria do preview. Geometria de blur/monitor permanece normalizada no tamanho CSS.
- Inicio/fim de scrub da regua e do playhead instala listeners nativos no proprio `mousedown`; nao depender de `useEffect` apos re-render, pois clique curto pode perder `mouseup` e deixar playback pausado.
- A liberacao do scrub aguarda o seek final, mas seu fallback e curto (1,5 s), igual as filas de midia; nunca manter o playback parado por dez segundos quando o evento `seeked` se perde ou atrasa.
- Durante scrub de video, `Preview` nao pode assinar `currentTime` junto com toda sua arvore React; ignore os updates transitorios e reconcilie no fim do scrub. Edicao de imagem continua assinando cada tempo, pois nao existe `seeked` de video para redesenhar.
- O loop de canvas do Preview deve manter no maximo um `requestAnimationFrame` pendente e, em playback, pular composicao quando `getVideoPlaybackQuality().totalVideoFrames` nao mudou. Seek e preview pausado continuam redesenhando diretamente.
- Monitor flutuante usa fonte por instancia de regiao, nao apenas por asset. Cada instancia pode ter offset proprio; sincronizacao de video guarda somente o ultimo alvo e nunca sobrescreve seek em voo.
- Metadado de video de monitor pode chegar apos primeiro canvas draw. Ao carregar, sincronizar instancia ao tempo atual e enfileirar redraw; nao depender de reposicionamento para revelar primeiro frame.
- Render de monitor aninhado deve reutilizar canvas `screen`/`composition` por caminho da instancia; nunca criar ou copiar canvas por frame no hot path de `drawScene`.
- Ao substituir fonte de monitor por canvas de composicao aninhada, passar `canvas.width`/`canvas.height` ao desenho. Dimensoes do video original em canvas reduzido de preview recortam conteudo no topo/esquerda.
- Projetos legados podem ter `AssetTimelineState.cursorStyles` ausente. Ao compor timeline aninhada, nunca deixar spread sobrescrever `state.cursorStyles` por `undefined`; usar cursor do contexto pai.
- Ao importar monitor de video, preservar `timelineDuration` quando metadado bruto ainda e `0`. Regiao representa composicao editada e deve limitar por `timelineDuration`, nao por `monitor.duration` transitorio. `loadProject` ocorre antes do metadado principal: nao limitar regiao pela `state.duration` enquanto for `0`.

## Persistencia de assets

- Edicao temporaria de asset isola timeline, camera, audio, cursor, playback e selecao; ao concluir restaura contexto anterior, que pode ser outra edicao temporaria. Media Audio pertence a timeline local do asset; audio principal permanece isolado. Save durante edicao resolve recursivamente rascunhos aninhados antes de serializar.
- Primeiro editar cria clone `Edit`; re-editar clone reutiliza-o. Preset dentro da edicao e template local; nunca muda preset global.
- Ao abrir/crear clone `Edit`, reutilizar clone existente por `originalName`+`path` e mover instancias antigas da timeline atual que apontavam ao original para clone antes do snapshot. Assim composicao aninhada, selecao e card ativo usam mesmo asset, inclusive projetos legados.
- Ao adicionar monitor dentro de uma edicao temporaria, se card original ja tiver clone `Edit`, criar regiao com ID do clone; main timeline mantem escolha explicita do card original.
- Ao abrir uma timeline temporaria, normalizar regioes legadas `original → Edit` quando clone correspondente existir; painel tambem resolve destaque por essa regra enquanto estado anterior estiver aberto.
- Swap troca slots `origin` e `target`; participantes validos sao tela, webcam ou instancia de monitor. Participante igual/invalido nao renderiza.
- Cut bloqueia visual global da timeline: toda regiao nao-Cut sobreposta fica esmaecida. Mesma lane: sem pointer events e sem selecao. Outra lane: permite somente mover pelo corpo, bloqueia resize. Cut permanece interativo e acima dos demais.
- Alcas de resize de qualquer regiao ficam centradas nas bordas temporais reais e podem sair do bloco estreito; nunca deixar as duas alcas dentro da largura da regiao, pois abaixo de `40px` a alca direita invade a esquerda. Mostrar somente na selecao ou hover.
- Ao mudar o zoom da timeline, preservar a coordenada horizontal atual do playhead escalando `scrollLeft` pela relacao anterior/nova de pixels por segundo. Se ja estiver fora do viewport, centraliza-lo. Zoom sempre deixa o playhead visivel, limitado apenas pelo inicio/fim fisico.
