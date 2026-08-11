# recording-timer - ocultar gravador da taskbar

Gerado em: 2026-08-10
Sessao/contexto: 019fec04-context
Tipo de registro: retorno-qa

## Card

Arquivo do card: [WIP anterior da aba lateral](recording-timer-2026-08-10-{019fec04-context}-qa-edge-tab-stop-takes.MD)
Resumo:

- Durante a captura, o gravador não deve aparecer minimizado na taskbar do Windows.

## Pedido Do Usuario

Pedido literal:

> Configure para a janela não minimizar para a taskbar do Windows.

Classificacao:

- Pedido explicito: não criar entrada minimizada na taskbar durante a gravação.
- Restricoes explicitas: nenhuma adicional.

## Interpretacao E Inferencias

- Inferencia operacional: o pedido se refere à janela principal do gravador, pois o chip flutuante já usa `skipTaskbar: true`.
- Motivo: o início da gravação chamava `recorderWin.minimize()`.
- Risco da inferencia: a janela fica oculta até o término/cancelamento; o usuário ainda controla a captura pela bandeja e pelo chip.

## Implementacao Ou Alteracao

- O que foi feito: substituído `minimize()` por `hide()` no início de gravação.
- Por que foi feito: `hide()` remove a janela da taskbar sem alterar o fluxo de restauração existente.
- Onde foi feito: [recording-manager.ts](../../../electron/main/features/recording-manager.ts) e [AGENTS.MD](../../../AGENTS.MD).
- O que nao foi feito: nenhuma alteração no chip, na bandeja, na captura ou na restauração após Stop/Cancel.

## Commits Relacionados Ao Card

Nenhum commit relacionado encontrado ate este ponto.
Motivo: trabalho ainda nao commitado no branch `gitbutler/workspace`.

## Validacao

- Validacoes feitas: `npx tsc --noEmit --pretty false`, ESLint focal, Prettier e `git diff --check` passaram.
- Validacoes nao feitas: confirmação visual da ausência na taskbar do Windows.
- Motivo das validacoes nao feitas: requer início real de captura.

## Riscos E Pendencias

- Confirmar que Stop e Cancel restauram a janela normalmente.

## Proximo Teste Esperado

- Iniciar captura, confirmar que o gravador não fica na taskbar e parar/cancelar para confirmar a restauração.
