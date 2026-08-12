# playback-seek - Retorno sobre travamento persistente

Gerado em: 2026-08-06
Sessao/contexto: 019fd7b6-context
Tipo de registro: retorno-qa

## Card

Arquivo do card: nao fornecido.
Registro anterior: [diagnostico inicial](./playback-seek-2026-08-06-{019fd7b6-context}-diagnostico-gop-playback-lento.MD).
Resumo:
- Refinar a causa apos o usuario confirmar que saltar entre pontos deixa o editor travado sem recuperacao observavel.

## Pedido Do Usuario

Pedido literal:
> mudar de um ponto para outro, trava bastante. Na verdade nem chegou a voltar ao normal. ele ficou travado mesmo! Nao consegui resolver de maneira nenhuma. Nao reparei se o que ficou travado foi a webcam e o video ficou normal ou o contrario ou ambos.

Classificacao:
- Pedido explicito: registrar e considerar travamento persistente e incerteza sobre qual fonte congelou.
- Restricoes explicitas: nenhuma correcao, reencode ou alteracao de projeto foi autorizada.

## Interpretacao E Inferencias

- Inferencia operacional: continuar investigacao; nao implementar ainda.
- Motivo: retorno adiciona comportamento novo, mas nao pede explicitamente a correcao.
- Risco da inferencia: runtime continua vulneravel ate correcao do GOP e da fila de seek.

## Implementacao Ou Alteracao

- O que foi feito: auditoria focada em `seeking/seeked`, fallbacks, retomada de playback, composicao de tela/webcam e erro do computer audio; controle A/B temporario com GOP de dois segundos.
- Por que foi feito: explicar por que o editor pode nao voltar ao normal e qual fonte bloqueia o preview composto.
- Onde foi feito: [Timeline.tsx](../../../src/components/editor/Timeline.tsx), [Preview.tsx](../../../src/components/editor/Preview.tsx), [playbackSlice.ts](../../../src/store/slices/playbackSlice.ts), [log principal](../../../recordsaas-main.log).
- O que nao foi feito: nenhuma alteracao de runtime, source media ou `.rsproj`; nenhum commit, push ou PR.

## Causa Refinada

- Tela principal continua sendo o bloqueio: um IDR em 588 s obriga decode desde `t=0`.
- Fallback logico da Timeline dispara em 1,5 s, remove listener e limpa `isVideoSeekInFlightRef`, mas nao cancela o seek fisico do Chromium.
- Fallback de encerramento do scrub tambem libera UI e restaura `isPlaying` em 1,5 s mesmo com `video.seeking=true`.
- Novo salto grava outro `currentTime` e reinicia/invalida o decode anterior. Saltos repetidos podem impedir qualquer seek de terminar.
- Preview so redesenha composicao quando avanca `totalVideoFrames` da tela. Sem frame novo, retorna antes de sincronizar/desenhar webcam. Resultado visivel: tela e webcam parecem congeladas, mesmo que webcam oculta tenha recuperado.
- Cut de `301,731673` ate `552,178354` pode disparar segundo seek longo quando playback encontra o intervalo.

## Evidencia A/B

- Original: 10 saltos entre 120 s e 580 s, limite de 500 ms por alvo; `0/10` concluidos.
- Controle temporario com NVENC e GOP de 120 frames/2 s: 295 keyframes; 10/10 saltos concluidos; media 139 ms, maximo 170 ms.
- Seek em 563 s: original 81,942 s; controle 0,167 s, aproximadamente 490 vezes mais rapido.
- Webcam: seeks profundos em 102-124 ms. Microfone/computer audio: 43-55 ms.
- Controle existiu somente em `C:\tmp`, foi removido; projeto permaneceu intocado.

## Erro Secundario Confirmado

- `recordsaas-main.log`: computer audio falhou no Chromium com `code=3`, `PIPELINE_ERROR_DECODE`, timestamp `581334785` (~581,335 s).
- Validacao FFmpeg anterior passou; parse/decode FFmpeg nao exclui falha do pipeline Chromium.
- Projeto tem `systemAudioMuted=true`, mas Preview ainda carrega, busca e tenta reproduzir o elemento. Mute nao evita decode.
- Nenhum erro equivalente de tela ou webcam apareceu no log.

## Commits Relacionados Ao Card

Repositorio: `E:\GitHub\recordsaas-solutions\recordsaas`
- Branch: `main`
- Base/destino: `main`
- Commits:
  - `6d6c080` - `fix: stabilize adaptive screen and system audio recording` - 2026-06-19 - introduziu a definicao NVENC atual sem GOP explicito.
- Push/PR: nenhum; somente analise.

## Validacao

- Validacoes feitas: leitura estatica dos ciclos de seek/play; benchmark original vs GOP de dois segundos; teste de dez saltos; comparacao independente de webcam e audios; inspecao do log renderer encaminhado ao main.
- Validacoes nao feitas: observacao visual do editor e dos elementos HTML em DevTools.
- Motivo das validacoes nao feitas: aprovacao do controle da janela expirou. O app local foi iniciado, mas a automacao visual nao recebeu acesso.

## Riscos E Pendencias

- Corrigir GOP resolve custo fisico, mas fila tambem deve separar timeout de UI da conclusao real do decoder.
- Nao retomar playback enquanto main video ainda busca; preservar apenas ultimo alvo sem reiniciar seek por fallback.
- Avaliar desenho da webcam quando tela nao avancou; nao mascarar estado real durante diagnostico.
- Isolar computer audio mutado e parar retentativas apos erro fatal.
- Processos Electron/Vite iniciados para o teste nao puderam ser encerrados automaticamente: acesso negado no sandbox e aprovacao elevada indisponivel por limite de uso. Fechar manualmente.

## Proximo Teste Esperado

- Apos fix, gravar 2-3 minutos com GOP <=2 s; executar 10 saltos rapidos e exigir 10/10 abaixo de 500 ms.
- Confirmar em DevTools: `main-screen`, `webcam` e canvas; nenhum hard release enquanto `video.seeking=true`; nenhum `PIPELINE_ERROR_DECODE` de audio mutado.
