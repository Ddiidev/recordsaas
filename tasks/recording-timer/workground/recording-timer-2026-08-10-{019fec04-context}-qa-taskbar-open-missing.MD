# recording-timer - Open Window ausente na taskbar

Gerado em: 2026-08-10
Sessao/contexto: 019fec04-context
Tipo de registro: retorno-qa

## Card

Arquivo do card: [WIP anterior do tooltip e taskbar](recording-timer-2026-08-10-{019fec04-context}-qa-native-tooltip-taskbar-open.MD)
Resumo:

- Corrige a associação da Jump List do Windows ao aplicativo RecordSaaS.

## Pedido Do Usuario

Pedido literal:

> Na taksbar não aparece a opção de Open window.

Classificacao:

- Pedido explicito: fazer `Open Window` aparecer no menu de contexto do ícone da taskbar.
- Restricoes explicitas: nenhuma adicional.

## Interpretacao E Inferencias

- Inferencia operacional: `app.setUserTasks` já estava registrado, mas o AppUserModelID só existia no pacote de build.
- Motivo: a taskbar associa Jump Lists ao AppUserModelID do processo em execução; o runtime não o definia.
- Risco da inferencia: o Windows pode manter cache do menu até o processo ser encerrado e iniciado novamente.

## Implementacao Ou Alteracao

- O que foi feito: definido `com.recordsaas.app` com `app.setAppUserModelId` antes da inicialização da janela, registrado `Open Window` com o executável como ícone e adicionado log do resultado de `app.setUserTasks`.
- Por que foi feito: alinhar o processo de desenvolvimento/execução ao `build.appId` do pacote.
- Onde foi feito: [index.ts](../../../electron/main/index.ts) e [AGENTS.MD](../../../AGENTS.MD).
- O que nao foi feito: nenhuma alteração na captura, no tooltip ou no fluxo de Stop.

## Commits Relacionados Ao Card

Nenhum commit relacionado encontrado ate este ponto.
Motivo: trabalho ainda nao commitado no branch `gitbutler/workspace`.

## Validacao

- Validacoes feitas: `npx tsc --noEmit --pretty false`, ESLint focal, Prettier, `git diff --check` e SCC focal passaram.
- Validacoes nao feitas: confirmação visual do menu de contexto da taskbar.
- Motivo das validacoes nao feitas: requer interação real com a taskbar do Windows.

## Riscos E Pendencias

- Confirmar que o menu mostra `Open Window` após reinício completo do app.

## Proximo Teste Esperado

- Encerrar todas as instâncias do RecordSaaS, iniciar novamente, minimizar e clicar com o botão direito no ícone da taskbar.
