# RecordSaaS Agent Memory

Leitura obrigatoria, inteira, no inicio de todo novo prompt de manutencao deste repositorio. Este arquivo guarda apenas regras criticas e duraveis; detalhes de tarefa ficam nos WIPs em `tasks/*/workground/`.

## Regras de manutencao

- Ler este arquivo antes de `AGENTS.MD`; depois seguir `AGENTS.MD` e inspecionar somente dominio pedido.
- Adicionar aqui somente fato confirmado que evita regressao recorrente. Manter curto; substituir regra obsoleta, nao acumular historico.
- WIP registra evidencia, pedido do usuario, validacoes e pendencias. Nao duplicar WIP aqui.

## Editor: seek e playback

- Sintoma somente no preview/editor, com exportacao correta: investigar React/media elements/seek antes de captura, WASAPI ou FFmpeg.
- Seek deve sincronizar video principal, canvas, webcam, audio de gravacao, audio do computador, audio de midia e instancias de monitor.
- Durante scrub: pausar fontes, coalescer entrada por `requestAnimationFrame` e manter somente um seek de decoder em voo; guardar apenas o ultimo alvo pendente ate `seeked`. Registrar listener final antes do ultimo seek e liberar scrub no proximo frame. Preservar estado anterior: se estava tocando, retomar apos seek; se estava pausado, continuar pausado. `currentTime` e operacional, fora de undo/redo; playhead o assina isoladamente, sem re-renderizar toda timeline.
- Nunca chamar `HTMLMediaElement.play()` novamente enquanto promessa anterior ainda esta pendente. `AbortError` por pause/seek e esperado; nao registrar em loop. Manter intencao de playback para retentar uma vez apos interrupcao.
- Seek de audio separado e de monitor usa a mesma fila por `HTMLMediaElement`: um seek em voo, somente ultimo destino pendente. Nao escrever `currentTime` diretamente em cada `timeupdate`.
- Quando monitor termina seek depois do video principal, agendar um unico redraw no proximo frame; scrub suprime redraw por `currentTime`, mas nao pode congelar frame de monitor atrasado.
- O canvas do preview e composicoes aninhadas usam raster limitado ao tamanho visivel da stage e DPR limitado; `canvasDimensions` e tamanho canonico de export, nao resolucao obrigatoria do preview. Geometria de blur/monitor permanece normalizada no tamanho CSS.
- Inicio/fim de scrub da regua e do playhead instala listeners nativos no proprio `mousedown`; nao depender de `useEffect` apos re-render, pois clique curto pode perder `mouseup` e deixar playback pausado.
- Durante scrub de video, `Preview` nao pode assinar `currentTime` junto com toda sua arvore React; ignore os updates transitorios e reconcilie no fim do scrub. Edicao de imagem continua assinando cada tempo, pois nao existe `seeked` de video para redesenhar.
- O loop de canvas do Preview deve manter no maximo um `requestAnimationFrame` pendente e, em playback, pular composicao quando `getVideoPlaybackQuality().totalVideoFrames` nao mudou. Seek e preview pausado continuam redesenhando diretamente.
- Monitor flutuante usa fonte por instancia de regiao, nao apenas por asset. Cada instancia pode ter offset proprio; sincronizacao de video guarda somente o ultimo alvo e nunca sobrescreve seek em voo.
- Render de monitor aninhado deve reutilizar canvas `screen`/`composition` por caminho da instancia; nunca criar ou copiar canvas por frame no hot path de `drawScene`.

## Persistencia de assets

- Edicao temporaria de asset isola timeline, camera, audio, cursor, playback e selecao; ao concluir restaura contexto principal.
- Primeiro editar cria clone `Edit`; re-editar clone reutiliza-o. Preset dentro da edicao e template local; nunca muda preset global.
- Swap troca slots `origin` e `target`; participantes validos sao tela, webcam ou instancia de monitor. Participante igual/invalido nao renderiza.
