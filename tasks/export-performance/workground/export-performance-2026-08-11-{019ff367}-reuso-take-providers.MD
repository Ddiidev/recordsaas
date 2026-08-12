# export-performance - reuso de providers no take mode

Gerado em: 2026-08-11
Sessao/contexto: 019ff367
Tipo de registro: implementacao

## Card

Arquivo do card: nao fornecido.
Resumo:
- Corrigir a multiplicacao de decoders/canvases no export de takes e medir o efeito no experimento.
- Diagnostico base: [analise do log real](export-performance-2026-08-11-{019ff367}-analise-log-real.MD).

## Pedido Do Usuario

Pedido literal:
> implemente isso que voce sugere para ver se melhora ou nao.

Classificacao:
- Pedido explicito: implementar e validar a otimizacao sugerida.
- Restricoes explicitas: manter o objetivo no ganho mensuravel da exportacao.

## Interpretacao E Inferencias

- Inferencia operacional: compartilhar provider por caminho apenas quando nao ha transicao ativa e a origem avanca; em salto temporal para tras, fechar e recriar o provider para preservar a semantica de reorder/duplicacao.
- Motivo: `VideoFrameProvider` so suporta leitura sequencial crescente; compartilhar incondicionalmente quebraria takes reordenados.
- Risco da inferencia: takes com transicoes continuam usando providers isolados durante a transicao; providers que deixam de estar ativos sao fechados no frame seguinte.

## Implementacao Ou Alteracao

- O que foi feito:
  - Reuso de `VideoFrameProvider` por media path no take mode sem transicao.
  - Fechamento de provider inativo; recreacao somente quando `sourceTime` retrocede.
  - Reuso de dois canvases 1920x1080 (`primary` e `secondary`), eliminando alocacao de um canvas por frame.
  - Metricas novas: decode de tela/webcam no take mode, providers criados/reusados/liberados/resetados e canvases criados.
- Por que foi feito: a exportacao anterior abriu 42 providers para 21 takes e criou 23.297 canvases de composicao.
- Onde foi feito: [RendererPage.tsx](../../../src/pages/RendererPage.tsx).
- O que nao foi feito: nao alterou codec, qualidade, FPS, bitrate, estrutura de takes nem configuracao de RAM.

## Commits Relacionados Ao Card

Repositorio: `E:\GitHub\recordsaas-solutions\recordsaas`
- Branch: `al-branch-1`
- Base/destino: nao determinado.
- Commits:
  - `b64d5b2` - `chore: checkpoint pending RecordSaaS work` - contem a instrumentacao do experimento.
  - `6aedef6` - `fix(export): isolate decoded frames per source` - contexto de ownership de frame/provider.
  - `2ea1924` - `perf: reuse take decoders during export` - reuso validado no experimento de 9 min.
- Push/PR: nao realizado.

## Validacao

- Validacoes feitas: `npx prettier --write src/pages/RendererPage.tsx`; `npx tsc --noEmit`; ESLint direcionado; `npm run verify:export-startup`; `git diff --check`.
- SCC: escopo `RendererPage.tsx`; baseline indisponivel; complexidade/ULOC do arquivo alterado sem classificacao piorada observavel; Neutral, sem refactor adicional.
- Validacoes nao feitas: exportacao real pos-correcao.
- Motivo das validacoes nao feitas: requer interacao no Electron; build de desenvolvimento foi aberta as 23:03 e zerou o JSONL do experimento.

## Riscos E Pendencias

- O ganho so sera confirmado pelo proximo `export-performance.jsonl`.
- Reiniciar o aplicativo limpa o log do experimento; copiar o arquivo antes disso.

## Proximo Teste Esperado

- Exportar o mesmo projeto em 1080p/60 fps/ultra high e comparar duracao com 1.107,566 s; esperado: `takeProviders.created` proximo de 2, `reused` alto, `active` maximo de 2 e `canvases=1` sem transicao.
