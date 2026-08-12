# export-performance - diagnostico de renderizacao 1080p60

Gerado em: 2026-08-11
Sessao/contexto: 019ff367
Tipo de registro: contexto

## Card

Arquivo do card: nao fornecido.
Resumo:
- Investigar a causa de um projeto de gravacao de 11 min, com saida de 394,19 s, levar 23 min em 1080p/60 fps/ultra high.
- Artefato analisado: [projeto exportado](C:/Users/andre/OneDrive/Documentos/RecordSaaS/CorrigindoTabuaDeMareAPIv2/project.rsproj).

## Pedido Do Usuario

Pedido literal:
> Quero que identifique alguma causa que faca um video de 11min que o video final e de 6min levar 23min renderizando em 1080p 60fps ultra high.

Classificacao:
- Pedido explicito: investigacao de causa.
- Restricoes explicitas: sem pedido de alteracao de codigo.

## Interpretacao E Inferencias

- Inferencia operacional: a pasta fornecida contem artefatos do projeto, nao o checkout do app; a implementacao foi apenas correlacionada com o checkout local do RecordSaaS.
- Motivo: a pasta nao possui `.git` nem `package.json`; contem `project.rsproj`, video, audios e metadados.
- Risco da inferencia: os logs de exportacao desta execucao nao estavam disponiveis; a atribuicao por etapa ainda requer os logs `RendererPage[Perf]` da proxima execucao.

## Implementacao Ou Alteracao

- O que foi feito: inspecao read-only de projeto, fontes e configuracao de exportacao.
- Por que foi feito: isolar quantidade real de frames, composicao por frame e perfil de encoder antes de propor mudanca.
- Onde foi feito: [project.rsproj](C:/Users/andre/OneDrive/Documentos/RecordSaaS/CorrigindoTabuaDeMareAPIv2/project.rsproj), [RendererPage.tsx](../../../src/pages/RendererPage.tsx), [renderer.ts](../../../src/lib/renderer.ts), [export-manager.ts](../../../electron/main/features/export-manager.ts).
- O que nao foi feito: nenhuma alteracao de runtime, configuracao, midia ou codigo.

## Commits Relacionados Ao Card

Repositorio: `E:\GitHub\recordsaas-solutions\recordsaas`
- Branch: `al-branch-1`
- Base/destino: nao determinado.
- Commits:
  - `bd71fb3` - `docs: finalize export frame ownership WIP` - relacionado ao pipeline de exportacao.
  - `6aedef6` - `fix(export): isolate decoded frames per source` - relacionado ao pipeline de exportacao.
- Push/PR: nao verificado.

## Validacao

- Validacoes feitas: `project.rsproj` confirmou `sourceDuration=671.316667`, `duration=394.188043`, `takes=21`, `events=23639`, webcam e 30 regioes de zoom; FFmpeg confirmou fonte `11:11.32`, saida `6:28.28`, ambas 1920x1080/60 fps; fonte confirmou loop de `floor(duration * fps)` e composicao/decode de tela+webcam por frame.
- Validacoes nao feitas: perfil real WebCodecs/encoder, GPU, fila de encoder e tempos por etapa desta exportacao.
- Motivo das validacoes nao feitas: nao ha log `RendererPage[Perf]` correspondente ao projeto fornecido.

## Riscos E Pendencias

- `ultra high` usa `imageSmoothingQuality='high'`; nao aumenta o bitrate acima de `high`.
- A saida real de 388,28 s exige 23.297 frames; 23 min implica aproximadamente 16,9 fps ou 59,2 ms/frame.
- Cada frame compoe canvas 1920x1080 com frame de tela, webcam com crop/borda/sombra, fundo, cursor e zoom antes de codificar.

## Proximo Teste Esperado

- Repetir uma exportacao e capturar os registros `RendererPage[Perf]` para comparar `mainDecode`, `webcamDecode`, `draw`, `encode` e `backpressure`.
