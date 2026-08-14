# screen-webcam-parity - visibilidade do Origin e Target no Swap

Gerado em: 2026-08-13
Sessao/contexto: 019ffdd7
Tipo de registro: alteracao

## Card

Arquivo do card: nao fornecido.
Resumo:

- Permitir que uma regiao Swap mantenha somente um lado visual durante seu intervalo.
- Preservar a troca de fonte, a geometria centralizada do destino restante e a compatibilidade de projeto/preset.

## Pedido Do Usuario

Pedido literal:

> Nao precisa focar no comportamento antigo. So foque na correcao do problema novo que eu estou lhe passando para fazer funcionar como eu gostaria.

> Se eu digo que o origin e a webcam e o target e a tela principal e eu ocultei o origin, ... so fica a tela principal ocupando tudo, e a fonte daquele video da tela principal agora e o video da webcam durante aquela timeline do swap.

Classificacao:

- Pedido explicito: incluir um controle de visibilidade ao lado de Origin e Target em cada Swap.
- Restricoes explicitas: ocultar um lado, centralizar o destino restante e manter a fonte trocada durante a regiao.
- Fora de escopo: recuperar ou investigar a implementacao antiga.

## Interpretacao E Inferencias

- Inferencia operacional: Origin e Target continuam sendo participantes concretos; a ocultacao e um estado da regiao, nao um quarto tipo de participante.
- Motivo: evita quebrar seletores, limites temporais e projetos existentes, e preserva a semantica atual de a fonte chegar ao estilo do destino.
- Regra escolhida: apenas um lado pode ficar oculto. Ao ocultar Origin, sua fonte entra no Target centralizado; ao ocultar Target, sua fonte entra no Origin centralizado.
- Transicoes: `none`, `fade`, `slide` e `scale` usam a mesma fonte/destino durante entrada e saida da regiao.

## Implementacao Ou Alteracao

- O que foi feito: adicionados `hideOrigin` e `hideTarget` ao contrato de Swap, com default `false`, exclusividade, persistencia em `.rsproj` e defaults de preset.
- O que foi feito: adicionados switches `Visible` ao lado de Origin e Target no painel da regiao.
- O que foi feito: o renderizador remove apenas o draw-base do lado oculto e desenha sua fonte no config centralizado do outro destino, mantendo crop, flip, borda e estilo do destino.
- O que foi feito: centralizadas em [swap.ts](../../../src/lib/swap.ts) a comparacao de participantes, a normalizacao de visibilidade, o estado do switch, o plano de troca e a geometria centralizada.
- Onde foi feito: [types/index.ts](../../../src/types/index.ts), [timelineSlice.ts](../../../src/store/slices/timelineSlice.ts), [presetSlice.ts](../../../src/store/slices/presetSlice.ts), [projectSlice.ts](../../../src/store/slices/projectSlice.ts), [RegionSettingsPanel.tsx](../../../src/components/editor/RegionSettingsPanel.tsx), [renderer.ts](../../../src/lib/renderer.ts), [swap.ts](../../../src/lib/swap.ts), [swap.test.ts](../../../src/lib/swap.test.ts) e [AGENTS.MD](../../../AGENTS.MD).
- O que nao foi feito: nao houve alteracao nas mudancas preexistentes de raio, flip, borda, binario de audio ou demais WIPs do checkout.

## Commits Relacionados Ao Card

Nenhum commit relacionado encontrado ate este ponto.
Motivo: alteracao ainda nao commitada; a busca por `screen-webcam-parity` no historico nao retornou commit correspondente.

## Validacao

- Validacoes feitas:
  - `node --test .\\src\\lib\\swap.test.ts` — 5 testes aprovados: ambos os sentidos de ocultacao, Swap normal, exclusividade e centralizacao preservando estilo.
  - `npx tsc --noEmit --pretty false`.
  - ESLint focado nos arquivos alterados.
  - Prettier focado nos arquivos alterados e [AGENTS.MD](../../../AGENTS.MD).
  - `npm run build` — concluido; somente o aviso existente de chunk maior que 500 kB.
  - `git diff --check`.
  - SCC no mesmo conjunto de seis arquivos existentes antes/depois e no modulo/teste novo.
- SCC result:
  - Scope: seis arquivos existentes afetados; [swap.ts](../../../src/lib/swap.ts) e [swap.test.ts](../../../src/lib/swap.test.ts) inspecionados separadamente.
  - Baseline: comparado.
  - Complexity: 1287 para 1298; a nova regra visual adiciona decisao de composicao.
  - ULOC/DRYness: ULOC 4550 para 4491; DRYness 0.64% para 0.63%.
  - Classification: Worsened.
  - Action: refactor feito; comparacao/normalizacao de participantes foi removida de tres chamadores e centralizada em [swap.ts](../../../src/lib/swap.ts). O aumento residual e a logica necessaria da nova capacidade.
- Validacoes nao feitas: interacao visual no Editor Electron e exportacao de um video real.
- Motivo das validacoes nao feitas: a janela RecordSaaS ativa nao estava em uma sessao segura de edicao; ela nao foi manipulada para nao interferir no uso em curso.

## Riscos E Pendencias

- Confirmar no Electron os dois sentidos com webcam + tela: Origin oculto deve mostrar webcam no quadro Target; Target oculto deve mostrar tela no quadro Origin centralizado.
- Confirmar `fade`, `slide` e `scale` no inicio e no fim da regiao, alem de `none`.
- Salvar, reabrir e exportar um trecho curto para confirmar o contrato `.rsproj` e o frame codificado.
- O worktree ja continha mudancas nao relacionadas; elas permanecem fora desta alteracao.

## Proximo Teste Esperado

- Criar uma regiao Swap com Origin `Webcam` e Target `Tela principal`.
- Desligar `Visible` em Origin e confirmar webcam ocupando o destino da tela.
- Desligar `Visible` em Target e confirmar a tela no destino da webcam, centralizado.
- Salvar/reabrir e exportar um trecho curto em cada sentido.
