# Modo Take - retorno QA: botao de split no take selecionado

Gerado em: 2026-08-09
Sessao/contexto: 019fe6a2-context
Tipo de registro: retorno-qa

## Card

Registro anterior: [retorno de regua e transicoes](./take-mode-2026-08-09-%7B019fe6a2-context%7D-retorno-qa-transicoes.MD)

## Pedido Do Usuario

Pedido literal:

> Outra coisa, eu percebi que eu posso criar takes manualmente usando a tecla S, que faz o split.
>
> Porém, quando eu clico naquele take, não aparece o botãozinho da tesoura para eu poder fazer o split. Então, observei isso aí também.

Classificacao:

- Pedido explicito: exibir tesoura contextual no take selecionado.
- Restricoes explicitas: manter split por `S` e o comportamento atual da faixa.

## Interpretacao E Inferencias

- Inferencia operacional: a tesoura deve usar o playhead atual, ficar visivel somente no take selecionado e ficar desabilitada fora dos limites minimos de split.
- Motivo: evita split invalido e mantém a faixa sem ruido visual.

## Implementacao Ou Alteracao

- [TakeTrack.tsx](../../../src/components/editor/timeline/TakeTrack.tsx) agora mostra `Split take at playhead (S)` com icone `Scissors` no take selecionado.
- O botao usa `splitTake(id, currentTime - start)` e respeita `TAKE_MIN_DURATION` em ambos os lados.
- Nenhuma alteracao no atalho `S`, inspector, transicoes ou timeline inferior.

## Commits Relacionados Ao Card

Repositorio: `E:\GitHub\recordsaas-solutions\recordsaas`

- Branch: `main`
- Base/destino: `origin/main`
- Commits:
  - `e0ffa30` - `feat(editor): refine timeline and audio synchronization` - checkpoint anterior; nao contem este retorno QA.
- Push/PR: not pushed.

## Validacao

- `npx tsc --noEmit --pretty false`: passou.
- ESLint direcionado em `TakeTrack.tsx`: passou.
- Prettier direcionado: aplicado.
- `git diff --check`: passou.
- Teste puro de split existente cobre limite e continuidade de audio.
- Runtime manual: usuario assumiu este teste.

## Riscos E Pendencias

- Em take muito curto o botao continua visivel, mas desabilitado quando o playhead nao permite dois takes minimos.

## Proximo Teste Esperado

- Selecionar take, mover playhead para dentro, clicar tesoura e confirmar duas caixas.
- Repetir com playhead na borda e confirmar estado desabilitado.
