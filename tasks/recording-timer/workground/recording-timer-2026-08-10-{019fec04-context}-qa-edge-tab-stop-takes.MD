# recording-timer - aba lateral, parar e takes

Gerado em: 2026-08-10
Sessao/contexto: 019fec04-context
Tipo de registro: retorno-qa

## Card

Arquivo do card: [WIP anterior do atalho F2](recording-timer-2026-08-10-{019fec04-context}-qa-f2-shortcut.MD)
Resumo:

- Corrige exibição inicial do cronometro e seus controles ativos de gravacao.

## Pedido Do Usuario

Pedido literal:

> Essa mini janela que está aparecendo não aparece assim que o app é minimizado.

> Deveria ser uma setinha para, quando eu clicar, ele puxar para a esquerda.

> Seria interessante que eu pudesse realmente dar um stop por aquela tela ali.

> Se tiver já algum take, aí ele vai mostrando um contadorzinho de quantos takes já foram.

Classificacao:

- Pedido explicito: aparecer ao minimizar, aba lateral com seta, parar gravacao e contador de takes.
- Restricoes explicitas: aba rente à tela; contador oculto sem take.

## Interpretacao E Inferencias

- Inferencia operacional: o primeiro `showInactive` ocorria antes do carregamento interno da janela e podia ser perdido durante a minimizacao.
- Motivo: a janela era criada oculta, carregava URL assincronamente e so recebia atualizacoes no `did-finish-load`.
- Risco da inferencia: o posicionamento final depende de Windows e dos monitores reais; exige QA manual com captura.

## Implementacao Ou Alteracao

- O que foi feito: exibição pendente apos `did-finish-load`, visibilidade em todas as areas/full screen, aba verde 44px rente à direita, seta para expandir/retrair, botao explicito de parar e contador de marcacoes de take.
- Por que foi feito: elimina a corrida de carregamento e torna o controle ativo identificavel durante a gravacao.
- Onde foi feito: [recording-manager.ts](../../../electron/main/features/recording-manager.ts) e [AGENTS.MD](../../../AGENTS.MD).
- O que nao foi feito: nenhuma mudanca em captura, arquivos gravados, editor ou serializacao de projeto.

## Commits Relacionados Ao Card

Nenhum commit relacionado encontrado ate este ponto.
Motivo: trabalho ainda nao commitado no branch `gitbutler/workspace`.

## Validacao

- Validacoes feitas: `npx tsc --noEmit --pretty false`, ESLint focal, Prettier e `git diff --check` passaram.
- SCC: snapshot sem baseline; complexidade 744, ULOC 2584 e DRYness 0.63 em `recording-manager.ts`. Crescimento proporcional aos novos estados de carregamento, parar e contador; sem duplicacao nova.
- Validacoes nao feitas: gravacao manual no Electron em janela minimizada e fullscreen.
- Motivo das validacoes nao feitas: requer atalho global, janela sempre no topo e captura real do Windows.

## Riscos E Pendencias

- Confirmar que o botao Stop nao grava na captura, pois a janela segue content-protected.

## Proximo Teste Esperado

- Iniciar gravacao e minimizar imediatamente; confirmar aba na borda direita, F2, Stop e contador apos marcar takes.
