# recording-timer - tooltip interno e Open Window

Gerado em: 2026-08-10
Sessao/contexto: 019fec04-context
Tipo de registro: retorno-qa

## Card

Arquivo do card: [WIP anterior do Stop clicavel](recording-timer-2026-08-10-{019fec04-context}-qa-stop-pointer-events.MD)
Resumo:

- Remove tooltip nativo do Stop e adiciona comando Open Window na taskbar do Windows.

## Pedido Do Usuario

Pedido literal:

> Mude para, ao invés de aparecer um tooltips nativo do Windows, mostrar um tooltips renderizado na própria interface, e não nativo.

> Quando o app for minimizado para a taskbar, o ícone da taskbar, quando eu clicar do outro lado do mouse, deve aparecer também o botão de Open Window para ele abrir novamente aquela telinha.

Classificacao:

- Pedido explicito: tooltip interno e item Open Window no menu de contexto da taskbar.
- Restricoes explicitas: tooltip não pode ser nativo/capturável.

## Interpretacao E Inferencias

- Inferencia operacional: o tooltip nativo vinha de `title="Stop recording"`; a tarefa da taskbar usa o mecanismo Windows Jump List do Electron.
- Motivo: `title` é renderizado pelo sistema operacional, enquanto `app.setUserTasks` adiciona uma ação ao clique direito do ícone.
- Risco da inferencia: a entrada Open Window só aparece no Windows e pode exigir reinício do processo para o Jump List ser atualizado.

## Implementacao Ou Alteracao

- O que foi feito: removido `title`, criado tooltip HTML por hover/foco e registrado `Open Window` com single-instance restore/show/focus.
- Por que foi feito: manter a ajuda visual dentro da janela protegida e reabrir o gravador pelo menu da taskbar.
- Onde foi feito: [recording-manager.ts](../../../electron/main/features/recording-manager.ts), [index.ts](../../../electron/main/index.ts) e [AGENTS.MD](../../../AGENTS.MD).
- O que nao foi feito: nenhum tooltip nativo adicional, nenhuma alteração de captura ou de IPC do Stop.

## Commits Relacionados Ao Card

Nenhum commit relacionado encontrado ate este ponto.
Motivo: trabalho ainda nao commitado no branch `gitbutler/workspace`.

## Validacao

- Validacoes feitas: `npx tsc --noEmit --pretty false`, ESLint focal, Prettier, `git diff --check` e SCC focal passaram. SCC sem baseline: complexidade 812, ULOC 2786 e DRYness 0.63 no escopo acumulado.
- Validacoes nao feitas: hover real no Stop e clique direito real no ícone da taskbar.
- Motivo das validacoes nao feitas: exigem interação visual no Windows.

## Riscos E Pendencias

- Confirmar que o tooltip aparece dentro do chip e não no sistema operacional.
- Confirmar que Open Window aparece no menu de contexto após reiniciar o app.

## Proximo Teste Esperado

- Reiniciar o app, minimizar, clicar com botão direito no ícone da taskbar e acionar Open Window; depois expandir o chip e passar o mouse sobre Stop.
