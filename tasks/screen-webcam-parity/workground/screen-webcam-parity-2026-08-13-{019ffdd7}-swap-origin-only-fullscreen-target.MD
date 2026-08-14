# screen-webcam-parity - Origin oculto deixa Target em tela cheia

Gerado em: 2026-08-13
Sessao/contexto: 019ffdd7
Tipo de registro: retorno-qa

## Card

Arquivo do card: nao fornecido.
Registro anterior: [swap-origin-target-visibility.MD](screen-webcam-parity-2026-08-13-{019ffdd7}-swap-origin-target-visibility.MD).

Resumo:

- Corrigir o Swap para ocultar somente o Origin.
- Quando o Origin estiver oculto, mostrar somente o Target no quadro principal, com o padding existente.

## Pedido Do Usuario

Pedido literal:

> Deixa a opcao de remover a visibilidade somente do Origin. Eu gostaria tambem de adicionar uma forma de aparecer a tela principal e tela cheia, baseado no padding la que ja existe, padrao.

> E remover a visualizacao da webcam que fica ali em overlay ou em side by side, enfim. E uma forma de ocultar a webcam e aparecer somente a tela.

> Em resumo, eu so gostaria de uma forma de eu poder remover da tela a webcam ou a tela principal por um periodo de tempo.

Classificacao:

- Pedido explicito: manter a opcao de visibilidade apenas em Origin; remover a da Target.
- Pedido explicito: com Origin `Webcam` e Target `Tela principal`, ocultar a webcam e deixar somente a tela no quadro principal.
- Restricao explicita: continuar dentro do elemento Swap; nao criar outro elemento.
- Fora de escopo: preservar o comportamento anterior que reenviava a fonte do Origin para o Target.

## Interpretacao E Inferencias

- Inferencia operacional: `hideOrigin` significa esconder a fonte Origin, sem trocar fontes; o Target remanescente usa o quadro principal completo e o padding do projeto.
- Motivo: as capturas mostram a webcam ainda renderizada no slot do Target quando Origin esta `Hidden`, em vez de a tela ficar sozinha.
- Inferencia operacional: a opcao de transicao continua para o Swap de dois lados; no modo Origin oculto, o Target precisa permanecer visivel em tela cheia durante toda a regiao.
- Risco da inferencia: a animacao de entrada/saida deixa de governar o modo de ocultacao, para nao redesenhar o Origin escondido.

## Implementacao Ou Alteracao

- O que foi feito: mantido somente o switch `Visible` no Origin; o Target ficou apenas com o seletor de participante.
- O que foi feito: removido `hideTarget` de tipo, defaults, preset, insercao, atualizacao e serializacao de Swap. Dados desconhecidos de projeto/preset nao entram no objeto normalizado.
- O que foi feito: com `hideOrigin=true`, o renderer remove os draws-base de Origin e Target e redesenha somente a fonte Target em [mainRectConfig](../../../src/lib/renderer.ts), que ja incorpora o padding e o estilo do frame principal; crop/flip continuam sendo os do Target.
- O que foi feito: o modo Origin oculto nao troca fontes nem redesenha o Origin durante `fade`, `slide` ou `scale`; a animacao continua inalterada para o Swap normal de dois lados.
- Onde foi feito: [types/index.ts](../../../src/types/index.ts), [timelineSlice.ts](../../../src/store/slices/timelineSlice.ts), [presetSlice.ts](../../../src/store/slices/presetSlice.ts), [projectSlice.ts](../../../src/store/slices/projectSlice.ts), [RegionSettingsPanel.tsx](../../../src/components/editor/RegionSettingsPanel.tsx), [renderer.ts](../../../src/lib/renderer.ts), [swap.ts](../../../src/lib/swap.ts), [swap.test.ts](../../../src/lib/swap.test.ts) e [AGENTS.MD](../../../AGENTS.MD).
- O que nao sera feito: alterar as mudancas preexistentes de raio, flip, borda, binario de audio ou os demais WIPs do checkout.

## Commits Relacionados Ao Card

Nenhum commit relacionado encontrado ate este ponto.
Motivo: correcao ainda nao commitada.

## Validacao

- Validacoes feitas:
  - Inspecao das tres capturas fornecidas pelo usuario: o estado `Origin Hidden` ainda mostrava a webcam, e a opcao `Target Hidden` ainda existia.
  - `node --test .\\src\\lib\\swap.test.ts` — 3 testes aprovados: Target no quadro principal quando Origin esta oculto, Swap normal e estado do switch.
  - `npx tsc --noEmit --pretty false`.
  - ESLint focado em tipo, painel, stores, renderer e helper/teste de Swap.
  - Prettier focado nos arquivos alterados, WIP e [AGENTS.MD](../../../AGENTS.MD).
  - `npm run build` — concluido; somente o aviso existente de chunk maior que 500 kB.
  - `git diff --check`.
  - SCC nos sete arquivos TypeScript da regra: complexidade 1309 para 1291; ULOC 4526 para 4482; DRYness 0.63% estavel; classificacao `Improved`.
- Validacoes nao feitas: interacao visual no Editor Electron e exportacao de um video real.
- Motivo das validacoes nao feitas: a janela RecordSaaS ativa nao foi manipulada para nao interferir em uma sessao de edicao em uso.

## Riscos E Pendencias

- Confirmar no Editor Electron: Origin `Webcam` oculto deve remover a webcam e deixar a tela principal no quadro completo, tanto em overlay quanto em side-by-side.
- Confirmar o sentido complementar: Origin `Tela principal` oculto deve deixar a webcam sozinha no quadro principal.
- Confirmar Preview e exportacao de um trecho curto, pois ambos usam o mesmo renderizador de composicao. A validacao estatica nao prova a imagem composta.

## Proximo Teste Esperado

- Criar um Swap com Origin `Webcam`, Target `Tela principal` e Origin `Hidden`.
- Verificar que nenhuma webcam permanece em overlay/side-by-side e que a tela respeita o padding atual em Preview e no arquivo exportado.
