# export-performance - analise do log real

Gerado em: 2026-08-11
Sessao/contexto: 019ff367
Tipo de registro: contexto

## Card

Arquivo do card: nao fornecido.
Resumo:
- Analise read-only da exportacao que produziu [RecordSaaS-2026-08-12-01-10-08.mp4](C:/Users/andre/OneDrive/Documentos/RecordSaaS/CorrigindoTabuaDeMareAPIv2/RecordSaaS-2026-08-12-01-10-08.mp4).
- Registro anterior: [instrumentacao de render](export-performance-2026-08-11-{019ff367}-instrumentacao-render.MD).

## Pedido Do Usuario

Pedido literal:
> por hora quero analise todos os pontos e depois eu penso se vamos trabalhar nisso ou nao

Classificacao:
- Pedido explicito: analise completa, sem alteracao de codigo.
- Restricoes explicitas: decidir implementacao depois da analise.

## Interpretacao E Inferencias

- Inferencia operacional: a variacao 23 min -> 18 min nao e explicada apenas por processos externos; os logs mostram pausas internas deterministicas nos limites de takes.
- Motivo: 21 inicializacoes de decoder/pump de tela e 21 de webcam aparecem no log, uma dupla por take, embora todos reutilizem os mesmos dois arquivos de origem.
- Risco da inferencia: os dados nao medem GPU/CPU de todo o sistema nem se WebCodecs escolheu hardware; nao sao necessarios para confirmar a duplicacao de decoders.

## Implementacao Ou Alteracao

- O que foi feito: correlacao do JSONL, `recordsaas-main.log`, `.rsproj` e MP4 final.
- Por que foi feito: separar custo normal por frame, pausas por take e mux/finalizacao.
- Onde foi feito: [export-performance.jsonl](C:/Users/andre/AppData/Roaming/recordsaas/logs/export-experiment/export-performance.jsonl), [recordsaas-main.log](E:/GitHub/recordsaas-solutions/recordsaas/recordsaas-main.log), [project.rsproj](C:/Users/andre/OneDrive/Documentos/RecordSaaS/CorrigindoTabuaDeMareAPIv2/project.rsproj), [RendererPage.tsx](../../../src/pages/RendererPage.tsx).
- O que nao foi feito: nenhuma alteracao de runtime ou configuracao.

## Commits Relacionados Ao Card

Repositorio: `E:\GitHub\recordsaas-solutions\recordsaas`
- Branch: `al-branch-1`
- Base/destino: nao determinado.
- Commits:
  - `bd71fb3` - `docs: finalize export frame ownership WIP` - contexto de ownership de frames no export.
  - `6aedef6` - `fix(export): isolate decoded frames per source` - contexto de decoders por fonte.
- Push/PR: nao realizado.

## Validacao

- Validacoes feitas:
  - MP4 final: 6:28.28, 1920x1080, 60 fps, H.264 Constrained Baseline, 14.645 Mb/s, AAC 48 kHz.
  - Sessao: 1.107,566 s (18:27,6); renderer: 1.016,731 s (16:56,7); pre-render/finalizacao: cerca de 90,8 s.
  - Renderer: 23.297 frames; 21 takes; 23.639 eventos; 30 zooms; webcam ativa.
  - Log principal: 21 decoders/pumps de tela + 21 de webcam para os mesmos dois arquivos de origem.
- Validacoes nao feitas: perfil GPU, ocupacao/temperatura e comparacao controlada com o export de 23 min.
- Motivo das validacoes nao feitas: os dados nao foram capturados na sessao anterior.

## Riscos E Pendencias

- O tempo medio do loop piorou de 14-19 ms em trechos normais para 44-50 ms acumulados; picos nos limites dos takes chegam a 0,2-0,5 s por frame e um pico de aproximadamente 4,1 s por frame em 148,0 s do video final.
- Metricas `mainDecode`/`webcamDecode` permanecem zero no take mode porque o cronometro atual nao cobre `renderTakeSource`; nao significa custo de decode zero.
- Configuracao de RAM esta em 30%, mas o budget estima 2 providers no take mode enquanto a sessao abre 42; isso aumenta risco de pressao/GC.

## Proximo Teste Esperado

- Se for autorizado corrigir: reutilizar providers por caminho de midia, liberar provider inativo, reutilizar canvas de take e medir decode/memoria no take mode antes/depois.
