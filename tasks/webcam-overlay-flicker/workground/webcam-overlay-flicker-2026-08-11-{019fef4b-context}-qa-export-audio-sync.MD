# Webcam overlay piscando - retorno QA de sincronismo do audio exportado

Gerado em: 2026-08-11  
Sessao/contexto: 019fef4b  
Tipo de registro: retorno-qa

## Card

Arquivo do card: [WIP anterior](./webcam-overlay-flicker-2026-08-11-%7B019fef4b-context%7D-export-take-frame-ownership.MD)  
Resumo:

- Diagnosticar o audio do MP4 exportado que ficou desalinhado apesar de o Editor ter ficado alinhado com um ajuste de 680 ms.

## Pedido Do Usuario

Pedido literal:

> Durante a edicao ele estava alinhado, so que depois que exportou ele ficou desalinhado. Entao, na verdade, eu presumo nada, nao sei; analisa ai para mim e fala.

Classificacao:

- Pedido explicito: analisar a causa do desvio no exportado.
- Restricoes explicitas: diagnostico, sem autorizacao para alterar o projeto gravado, os MP4s ou o codigo nesta etapa.

## Interpretacao E Inferencias

- Inferencia operacional: o projeto salvo contem `recordingSyncOffsetMs = -680`; e necessario conferir se preview e export aplicam o mesmo sentido e a mesma faixa de audio.
- Motivo: o [project.rsproj](C:/Users/andre/OneDrive/Documentos/RecordSaaS/CorrigindoTabuaDeMareAPIv2/project.rsproj) tem `audioPath` (microfone) com `recordingSyncOffsetMs = -680`, `systemAudioPath` com `systemAudioSyncOffsetMs = 0` e nenhuma `changeSoundRegion`; o alinhamento observado no Editor nao prova que o filtro de audio usado no mux final preservou o mesmo offset.
- Confirmado: o preview usa `targetTime = sourceTime + offset`; com `-680 ms`, a voz e tocada 680 ms depois na timeline.
- Confirmado: o export trata offset negativo com `atrim=start=0.680`, removendo o inicio da faixa e adiantando a voz 680 ms. Preview e export aplicam o mesmo valor em sentidos opostos; o desvio resultante pode chegar a 1,36 s.
- Confirmado: tela e webcam sao gravadas por processos FFmpeg distintos. O app espera cada processo sinalizar pronto antes de mostrar a interface, mas nao persiste um timestamp de primeira amostra por fonte, nem corta os arquivos em um marco comum.
- Risco da inferencia: ambos os MP4s comecam em PTS 0, portanto seus containers nao informam a diferenca de inicio fisico entre os processos; o alinhamento automatico precisa ser registrado durante a captura.

## Implementacao Ou Alteracao

- O que foi feito: confirmado que o projeto usa simultaneamente as faixas de microfone e audio do PC, mas apenas a de microfone possui deslocamento manual de -680 ms.
- Por que foi feito: separar uma possivel falha de aplicacao do offset da voz de uma falha de timestamp/mux que afetaria ambas as faixas.
- O que foi feito: rastreado o offset no preview, na composicao/mux de audio do export e na inicializacao dos capturadores.
- O que foi feito: validado que tela e webcam brutas iniciam em PTS 0 em seus respectivos containers, sem um identificador de origem temporal compartilhada.
- Onde foi feito: [project.rsproj](C:/Users/andre/OneDrive/Documentos/RecordSaaS/CorrigindoTabuaDeMareAPIv2/project.rsproj), [useExportProcess.ts](../../../src/hooks/useExportProcess.ts) e [export-manager.ts](../../../electron/main/features/export-manager.ts).
- O que nao foi feito: nenhuma alteracao.

## Commits Relacionados Ao Card

Repositorio: `E:\GitHub\recordsaas-solutions\recordsaas`

- Branch: `gitbutler/workspace`
- Base/destino: `gitbutler/workspace`
- Commits:
  - Nenhum commit novo; diagnostico somente.
- Push/PR: not pushed.

## Validacao

- Validacoes feitas:
  - Inspecao do projeto gravado; confirmados `audioPath`, `systemAudioPath`, os dois offsets e ausencia de regioes de alteracao de som.
  - Inspecao do preview: `syncResolvedAudioElement` calcula `resolved.sourceTime + timeOffsetSec`.
  - Inspecao do export: `applyAudioSyncOffset` aplica `atrim=start` para offset negativo depois da composicao dos takes.
  - `npm run verify:webcodecs-decode` nas fontes de tela e webcam: passou; ambas iniciam no timestamp 0, com 60 fps e 30 fps respectivamente.
  - Inspecao de captura: tela e webcam sao processos separados; o sinal de pronto apenas libera a UI e o timer.
- Validacoes nao feitas: nova exportacao e comparacao visual/auditiva de uma referencia comum no MP4 corrigido.
- Motivo das validacoes nao feitas: este lote e somente diagnostico e planejamento; nenhuma correcao foi aplicada.

## Riscos E Pendencias

- O audio do microfone esta comprovadamente deslocado no sentido oposto entre preview e export.
- O audio do PC tem offset zero; se tambem estiver desalinhado, falta uma origem temporal comum para os capturadores e esse e um segundo defeito independente.
- Proposta recomendada: iniciar cada fonte em pre-roll, registrar seu primeiro timestamp real em relacao a um relogio monotono unico, escolher a origem global somente quando todas estiverem prontas e descartar/recortar os pre-rolls. Preview, takes e export devem consumir o mesmo mapa de tempo, nunca regras de sinal separadas.

## Proximo Teste Esperado

- Corrigir primeiro a semantica unica do offset de microfone no preview e no export, com teste que compare os dois sentidos.
- Depois implementar a origem temporal comum da captura: pre-roll, timestamps de primeira amostra por fonte, marco global persistido e trim automatico antes do Editor.
