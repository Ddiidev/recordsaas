# Webcam overlay piscando - origem temporal e ondas de audio

Gerado em: 2026-08-11  
Sessao/contexto: 019fef4b  
Tipo de registro: implementacao

## Card

Arquivo do card: [diagnostico anterior](./webcam-overlay-flicker-2026-08-11-%7B019fef4b-context%7D-qa-export-audio-sync.MD)  
Resumo:

- Substituir o corte fixo de audio por uma origem temporal comum de captura.
- Mostrar e ocultar as faixas de onda de microfone e audio do PC, abaixo de Cut/Change Sound e independentemente de Take Mode.

## Pedido Do Usuario

Pedido literal:

> Iniciar tudo em paralelo... dar uma linha de corte para dizer que comecou o video e tudo a partir daquele momento.
>
> Essas faixas de audio... aparecessem as ondulacoes do som... e eu devo tambem poder ocultar ou nao ocultar aquela linha faixa de audio.

Classificacao:

- Pedido explicito: implementar origem temporal monotona, pre-roll e normalizacao comum para captura, Editor, takes e export.
- Pedido explicito: implementar ondas de audio para microfone e audio do PC, visiveis sem takes, abaixo da faixa especial e com visibilidade controlavel.
- Restricoes explicitas: preservar Cut/Change Sound como faixa especial acima das novas faixas de audio; nao alterar arquivos brutos existentes.

## Interpretacao E Inferencias

- Inferencia operacional: a origem e definida no relogio monotono assim que todas as fontes ativas confirmam prontidao; os offsets entre essa marca e cada fonte sao persistidos nos metadados da nova gravacao.
- Motivo: processos FFmpeg separados podem iniciar em instantes distintos; um simples `spawn` em sequencia nao garante tempo de midia comum.
- Inferencia operacional: as ondas serao calculadas sob demanda a partir da faixa bruta pela camada principal, em taxa reduzida, para nao carregar PCM integral no Renderer.
- Risco da inferencia: a captura de microfone compartilha o processo principal com a tela; ambas usam a mesma origem de progresso enquanto nao houver timestamp de pacote por stream.

## Implementacao Ou Alteracao

- O que foi feito:
  - Removido o corte destrutivo fixo de 1.000 ms para microfone e audio do sistema.
  - Processos de captura continuam iniciados sem `await` entre os `spawn`; apos os sinais de prontidao, `captureOriginMonotonicMs` gera `captureSourceOffsetsMs` para tela, webcam, microfone e sistema.
  - Eventos do cursor passam a usar o mesmo relogio monotono; metadados salvam offsets automaticos e projetos antigos recebem zero.
  - Preview, seek do Editor, Take Mode e Renderer usam a mesma conversao `timeline -> fonte`; o exportador normaliza offsets automaticos antes dos recortes e aplica o offset manual no mesmo sentido do player. Assim, `-680 ms` continua atrasando o audio tanto no Editor quanto no MP4.
  - Criado IPC de extracao reduzida de picos por FFmpeg e as faixas `Microfone` e `Audio do sistema` na Timeline, abaixo de Take/Cut/Change Sound. Cada faixa tem alternancia individual de visibilidade.
- Por que foi feito: eliminar a suposicao de que todos os dispositivos iniciam no mesmo frame e impedir que a exportacao invertesse o ajuste manual que o usuario aplicou no Editor.
- Onde foi feito: [recording-manager.ts](../../../electron/main/features/recording-manager.ts), [state.ts](../../../electron/main/state.ts), [export-manager.ts](../../../electron/main/features/export-manager.ts), [audio-waveform.ts](../../../electron/main/ipc/handlers/audio-waveform.ts), [projectSlice.ts](../../../src/store/slices/projectSlice.ts), [Preview.tsx](../../../src/components/editor/Preview.tsx), [RendererPage.tsx](../../../src/pages/RendererPage.tsx), [Timeline.tsx](../../../src/components/editor/Timeline.tsx) e [AudioWaveformTrack.tsx](../../../src/components/editor/timeline/AudioWaveformTrack.tsx).
- O que nao foi feito: nenhum arquivo de projeto ou midia do usuario foi alterado.

## Commits Relacionados Ao Card

Repositorio: `E:\GitHub\recordsaas-solutions\recordsaas`

- Branch: `gitbutler/workspace`
- Base/destino: `gitbutler/workspace`
- Commits:
  - `73ab8a2` - `feat(recording): add take editing mode` - 2026-08-09 - introduziu takes e o fluxo de exportacao relacionado.
  - Nenhum commit novo; implementacao local ainda nao commitada.
- Push/PR: not pushed.

## Validacao

- Validacoes feitas:
  - `npx tsc --noEmit --pretty false` - passou.
  - ESLint focado nos arquivos alterados - passou sem warnings.
  - `npm run build` - passou; compilou Renderer, Main e Preload.
  - `npm run verify:export-startup` - passou.
  - `git diff --check` - passou.
  - Extracao FFmpeg de 1 segundo do AAC real do projeto `CorrigindoTabuaDeMareAPIv2` - passou no mesmo formato usado pelas ondas.
  - SCC focado - snapshot atual: 8 arquivos, ULOC 8.483, DRYness 0,64%, complexidade 2.358; nao ha baseline anterior comparavel.
- Validacoes nao feitas: gravacao nova com as quatro fontes e exportacao completa; o Electron local foi aberto, mas nao foi possivel carregar/controlar o projeto real por IPC para captura visual automatizada.
- Motivo das validacoes nao feitas: nao repetir uma exportacao de seis minutos quebrada como teste e ausencia de automacao de UI Electron nesta sessao.

## Riscos E Pendencias

- Registros antigos nao possuem offsets automaticos e continuam com zero para compatibilidade. O projeto analisado preserva `recordingSyncOffsetMs: -680` e agora sera exportado no mesmo sentido da previa.
- A marca de prontidao e uma aproximacao de inicio da primeira midia de cada backend; a verificacao final requer uma nova gravacao com tela, webcam, microfone e audio do PC ativos.

## Proximo Teste Esperado

- Gravar fontes simultaneas, conferir o marco zero no Editor, alternar a visibilidade de cada onda e exportar um trecho curto mantendo o mesmo sincronismo.
