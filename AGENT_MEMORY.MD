# RecordSaaS Agent Memory

Leitura obrigatoria, inteira, no inicio de todo novo prompt de manutencao deste repositorio. Este arquivo guarda apenas regras criticas e duraveis; detalhes de tarefa ficam nos WIPs em `tasks/*/workground/`.

## Regras de manutencao

- Ler este arquivo antes de `AGENTS.MD`; depois seguir `AGENTS.MD` e inspecionar somente dominio pedido.
- Adicionar aqui somente fato confirmado que evita regressao recorrente. Manter curto; substituir regra obsoleta, nao acumular historico.
- WIP registra evidencia, pedido do usuario, validacoes e pendencias. Nao duplicar WIP aqui.

## Editor: seek e playback

- Sintoma somente no preview/editor, com exportacao correta: investigar React/media elements/seek antes de captura, WASAPI ou FFmpeg.
- Seek deve sincronizar video principal, canvas, webcam, audio de gravacao, audio do computador, audio de midia e instancias de monitor.
- Durante scrub: pausar fontes, coalescer seeks por `requestAnimationFrame`, registrar listener `seeked` antes do ultimo seek e liberar scrub no proximo frame. Preservar estado anterior: se estava tocando, retomar apos seek; se estava pausado, continuar pausado. Nao manter estado de scrub por timeout perceptivel; ele bloqueia Play clicado logo depois da regua.
- Nunca chamar `HTMLMediaElement.play()` novamente enquanto promessa anterior ainda esta pendente. `AbortError` por pause/seek e esperado; nao registrar em loop. Manter intencao de playback para retentar uma vez apos interrupcao.
- Monitor flutuante usa fonte por instancia de regiao, nao apenas por asset. Cada instancia pode ter offset proprio.

## Persistencia de assets

- Edicao temporaria de asset isola timeline, camera, audio, cursor, playback e selecao; ao concluir restaura contexto principal.
- Primeiro editar cria clone `Edit`; re-editar clone reutiliza-o. Preset dentro da edicao e template local; nunca muda preset global.
- Swap troca slots `origin` e `target`; participantes validos sao tela, webcam ou instancia de monitor. Participante igual/invalido nao renderiza.
