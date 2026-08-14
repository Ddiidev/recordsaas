# screen-webcam-parity - transicoes com Origin oculto

Gerado em: 2026-08-13
Sessao/contexto: 019ffdd7
Tipo de registro: retorno-qa

## Card

Arquivo do card: nao fornecido.
Registro anterior: [swap-origin-only-fullscreen-target.MD](screen-webcam-parity-2026-08-13-{019ffdd7}-swap-origin-only-fullscreen-target.MD).

Resumo:

- Fazer a transicao do Swap funcionar quando Origin esta oculto, sem perder o Target em tela cheia.

## Pedido Do Usuario

Pedido literal:

> A transicao que nao esta funcionando, nao esta fluida; ele simplesmente faz um corte.

> Tudo parece ter a mesma animacao que o meu fade. O fade funciona. Eu nao sei se esse scale seria um zoom; seria tambem interessante um zoom in e zoom out para fazer a troca.

> Hoje funciona se o origin estiver visivel. Se o origin nao estiver visivel, essa transicao nao funciona muito bem, nao tem nenhuma transicao de ocultar alguma coisa do tipo.

Classificacao:

- Pedido explicito: animar o modo Origin oculto, em vez de cortar diretamente para o Target fullscreen.
- Pedido explicito: `slide` e `scale` precisam ser visualmente distintos de `fade`.
- Restricao explicita: manter o comportamento aprovado de Origin oculto — Target sozinho em tela cheia, sem trocar fontes.

## Interpretacao E Inferencias

- Causa observada: o ramo `target-only` ignora `swapProgress` e sempre desenha o Target final; por isso `fade`, `slide` e `scale` viram corte.
- Inferencia operacional: `fade` dissolve o Origin enquanto o Target aparece no frame principal; `slide` move o Target fullscreen a partir do lado do layout original; `scale` expande e recolhe o Target entre seu slot normal e o frame principal.
- Motivo: preserva a leitura normal no inicio/fim da regiao e da aos tres modos movimentos diferentes.
- Risco da inferencia: a direcao do slide e derivada da posicao horizontal Origin/Target; layouts sobrepostos podem ter direcao menos evidente, mas mantem uma entrada/saida consistente.

## Implementacao Ou Alteracao

- O que foi feito: o ramo `target-only` passou a usar `swapProgress` e uma tabela de transicao no [renderer.ts](../../../src/lib/renderer.ts), sem trocar fontes.
- O que foi feito: `fade` dissolve Origin e Target normal enquanto revela o Target no frame principal; `slide` traz esse frame a partir do lado horizontal do Target; `scale` expande/recolhe o Target entre o slot normal e o frame principal.
- O que foi feito: os dois draws-base sao removidos e reintroduzidos somente quando necessarios pela transicao; slide inicia a camada em movimento sem sombra/borda propria, evitando duplicacao visual ou webcam/monitor residual fora do frame principal.
- O que foi feito: adicionado [getSwapSlideStartConfig](../../../src/lib/swap.ts) e teste para os dois sentidos horizontais; o seletor agora nomeia `Scale (Zoom)`.
- O que foi feito: atualizado o contrato em [AGENTS.MD](../../../AGENTS.MD) para as transicoes do modo Origin oculto.
- O que nao foi feito: reintroduzir visibilidade de Target ou voltar a trocar a fonte do Origin quando ele esta oculto.

## Commits Relacionados Ao Card

Nenhum commit relacionado encontrado ate este ponto.
Motivo: correcao ainda nao commitada.

## Validacao

- Validacoes feitas:
  - Inspecao do ramo de renderizacao: `target-only` usa `swapProgress` para diferenciar fade, slide e scale.
  - `node --test .\\src\\lib\\swap.test.ts` — 4 testes aprovados, incluindo os dois sentidos do slide.
  - `npx tsc --noEmit --pretty false`.
  - ESLint focado em renderer, helper/teste de Swap e painel.
  - Prettier focado nos arquivos alterados, WIP e [AGENTS.MD](../../../AGENTS.MD).
  - `npm run build` — concluido; somente o aviso existente de chunk maior que 500 kB.
  - `git diff --check`.
  - SCC no renderer, helper e teste: complexidade 331 para 332; ULOC 1122 para 1177; DRYness 0.68% estavel. Classificacao `Worsened`; a tabela de modos reduziu a primeira versao de 340 para 332, e o ponto residual representa as tres transicoes distintas solicitadas.
- Validacoes nao feitas: interacao visual no Editor Electron e exportacao de um video real.
- Motivo das validacoes nao feitas: a janela RecordSaaS ativa nao foi manipulada para nao interferir em uma sessao de edicao em uso.

## Riscos E Pendencias

- Confirmar no Editor Electron a entrada e saida para `fade`, `slide` e `scale`, em overlay e side-by-side.
- Confirmar que a sombra do frame nao escurece durante a transicao e que nao surge uma segunda webcam/tela.
- Confirmar Preview e exportacao de um trecho curto.

## Proximo Teste Esperado

- Com Origin `Webcam` oculto e Target `Tela principal`, verificar `fade`, `slide` e `scale` no inicio e no fim da regiao.
- Confirmar que `scale` faz zoom in na entrada e zoom out na saida, enquanto `slide` desloca horizontalmente sem usar a mesma geometria.
