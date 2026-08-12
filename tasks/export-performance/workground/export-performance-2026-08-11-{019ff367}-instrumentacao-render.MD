# export-performance - instrumentacao de render

Gerado em: 2026-08-11
Sessao/contexto: 019ff367
Tipo de registro: implementacao

## Card

Arquivo do card: nao fornecido.
Resumo:
- Preparar telemetria temporaria para identificar o gargalo de exportacao 1080p/60 fps.
- Registro anterior: [diagnostico 1080p60](export-performance-2026-08-11-{019ff367}-diagnostico-1080p60.MD).

## Pedido Do Usuario

Pedido literal:
> Ok, entao prepare o App somente para escrever logs uteis para voce analisar depois.
>
> Aponte para uma pasta de sua escolha, por hora faca com que ao abrir o app ele apaga esses logs para comecar novos do zero (somente para o nosso experimento)

Classificacao:
- Pedido explicito: instrumentacao temporaria, sem correcao do renderizador.
- Restricoes explicitas: apagar somente os logs do experimento a cada abertura do app.

## Interpretacao E Inferencias

- Inferencia operacional: usar `%APPDATA%\\recordsaas\\logs\\export-experiment` para isolar os dados e preservar `main.log`.
- Motivo: `app.getPath('userData')` e o local proprio do aplicativo, independente do checkout de desenvolvimento.
- Risco da inferencia: o diretorio e zerado em toda inicializacao; exportacoes anteriores nao permanecem para comparacao.

## Implementacao Ou Alteracao

- O que foi feito: criou JSONL exclusivo, limpo ao `app.whenReady`; registrou sessao, configuracao efetiva, metricas de render a cada 10 s, erros e termino do FFmpeg.
- Por que foi feito: separar `mainDecode`, `webcamDecode`, `draw`, `encode`, `backpressure` e fila do encoder na proxima exportacao.
- Onde foi feito: [export-experiment-log.ts](../../../electron/main/lib/export-experiment-log.ts), [index.ts](../../../electron/main/index.ts), [preload.ts](../../../electron/preload.ts), [export-manager.ts](../../../electron/main/features/export-manager.ts), [RendererPage.tsx](../../../src/pages/RendererPage.tsx).
- O que nao foi feito: nenhuma alteracao de codec, qualidade, FPS ou pipeline de exportacao.

## Commits Relacionados Ao Card

Repositorio: `E:\GitHub\recordsaas-solutions\recordsaas`
- Branch: `al-branch-1`
- Base/destino: nao determinado.
- Commits:
  - `bd71fb3` - `docs: finalize export frame ownership WIP` - contexto do pipeline de exportacao.
  - `6aedef6` - `fix(export): isolate decoded frames per source` - contexto do pipeline de exportacao.
- Push/PR: nao realizado.

## Validacao

- Validacoes feitas: `npx tsc --noEmit`; `npm run verify:export-startup`; ESLint direcionado aos cinco arquivos alterados.
- SCC: escopo dos cinco arquivos; baseline indisponivel; complexidade/ULOC proporcionais, classificacao Neutral, sem refactor necessario.
- Validacoes nao feitas: abertura real do Electron e uma exportacao completa gerando `export-performance.jsonl`.
- Motivo das validacoes nao feitas: o teste exige executar o aplicativo e renderizar midia local.

## Riscos E Pendencias

- O log do experimento e apagado na proxima abertura por desenho; copiar o arquivo antes de reiniciar o app.
- Diagnostico de hardware ainda depende da proxima exportacao real.

## Proximo Teste Esperado

- Abrir o app, exportar o projeto de teste em 1080p/60 fps/ultra high e enviar [export-performance.jsonl](C:/Users/andre/AppData/Roaming/recordsaas/logs/export-experiment/export-performance.jsonl) antes de reabrir o app.
