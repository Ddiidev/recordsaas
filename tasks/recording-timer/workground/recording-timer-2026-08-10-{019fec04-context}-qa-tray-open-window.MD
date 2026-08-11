# recording-timer - Open Window na tray

Gerado em: 2026-08-10
Sessao/contexto: 019fec04-context
Tipo de registro: retorno-qa

## Card

Arquivo do card: [WIP anterior da tentativa na taskbar](recording-timer-2026-08-10-{019fec04-context}-qa-taskbar-open-missing.MD)
Resumo:

- Move o comando `Open Window` para o menu do ícone da bandeja do sistema.

## Pedido Do Usuario

Pedido literal:

> Perdão eu fali taskbar, na taskbar aparece o que não aparece é na traybar

Classificacao:

- Pedido explicito: `Open Window` deve aparecer na traybar/system tray.
- Restricoes explicitas: corrigir o alvo da implementação anterior.

## Interpretacao E Inferencias

- Inferencia operacional: o menu correto é o `Menu.buildFromTemplate` usado por `createTray()` durante a gravação.
- Motivo: esse menu já contém Stop Recording e Cancel Recording.
- Risco da inferencia: o comando só existe enquanto há gravação ativa, quando o ícone da tray é criado.

## Implementacao Ou Alteracao

- O que foi feito: removido o registro de Jump List/taskbar e adicionado `Open Window` ao menu da system tray.
- Por que foi feito: alinhar a implementação ao local correto informado pelo usuário.
- Onde foi feito: [recording-manager.ts](../../../electron/main/features/recording-manager.ts) e [AGENTS.MD](../../../AGENTS.MD).
- O que nao foi feito: nenhuma alteração no tooltip, captura, Stop ou taskbar.

## Commits Relacionados Ao Card

Nenhum commit relacionado encontrado ate este ponto.
Motivo: trabalho ainda nao commitado no branch `gitbutler/workspace`.

## Validacao

- Validacoes feitas: `npx tsc --noEmit --pretty false`, ESLint focal, Prettier, `git diff --check` e SCC focal passaram.
- Validacoes nao feitas: clique real no ícone da system tray durante captura.
- Motivo das validacoes nao feitas: requer interação visual no Windows.

## Riscos E Pendencias

- Confirmar que `Open Window` aparece acima de Mark Take/Stop/Cancel e restaura a janela oculta.

## Proximo Teste Esperado

- Iniciar gravação, clicar com o botão direito no ícone da tray, escolher `Open Window` e confirmar que a janela do gravador reaparece.
