# recording-timer - visual verde e configuracao

Gerado em: 2026-08-10
Sessao/contexto: 019fec04
Tipo de registro: alteracao

## Card

Arquivo do card: [implementacao anterior](./2026-08-10-019fec04-recording-timer-f12.MD)
Resumo:

- alinhar o timer flutuante ao verde, raio e controle persistente do RecordSaaS.

## Pedido Do Usuario

Pedido literal:

> Quero que ajuste as cores da janela flutuante com o tempo de gravação para a cor verde que é a cor predominante do app inteiro. E deve ser quadrado com bordas levemente arredondadas assim como é o resto do app. E deixe configurável na tela inicial ou nas configurações a possibilidade de não aparecer essa janela. Essa tela deve estar bem coladinha na lateral da tela.

Classificacao:

- Pedido explicito: timer verde, quadrado, com cantos discretos, junto da borda direita e opcional.
- Restricoes explicitas: usar a identidade visual atual; configuracao pode ficar em Settings.

## Interpretacao E Inferencias

- Inferencia operacional: `General Settings` e a superficie adequada porque o usuario autorizou “na tela inicial ou nas configurações”.
- Motivo: [GeneralTab.tsx](E:/GitHub/recordsaas-solutions/recordsaas/src/components/settings/GeneralTab.tsx) ja persiste switches por `window.electronAPI.setSetting`.
- Risco da inferencia: a troca do switch vale para a proxima captura; uma janela de timer ja aberta nao e removida no meio da gravacao.

## Implementacao Ou Alteracao

- O que foi feito: timer recolhido agora tem `44x44`, raio `4px`, verde primario `hsl(154 60% 42%)`, superficie branca e margem `4px` da borda inferior direita; expandido preserva o mesmo canto e abre para a esquerda.
- O que foi feito: `General Settings > Recording Timer` persiste `recorder.showTimer`; ausente significa ligado por compatibilidade.
- Por que foi feito: reproduzir os tokens reais de [index.css](E:/GitHub/recordsaas-solutions/recordsaas/src/index.css), sem introduzir biblioteca ou estilo paralelo.
- Onde foi feito: [recording-manager.ts](E:/GitHub/recordsaas-solutions/recordsaas/electron/main/features/recording-manager.ts), [GeneralTab.tsx](E:/GitHub/recordsaas-solutions/recordsaas/src/components/settings/GeneralTab.tsx) e [AGENTS.MD](E:/GitHub/recordsaas-solutions/recordsaas/AGENTS.MD).
- O que nao foi feito: nao foi alterado fluxo de captura, F12, IPC existente, exportacao ou a janela durante uma captura ja em andamento.

## Commits Relacionados Ao Card

Nenhum commit relacionado encontrado ate este ponto.
Motivo: alteracao local ainda nao commitada.

## Validacao

- Validacoes feitas: `npx tsc --noEmit --pretty false`, ESLint direcionado, Prettier e `git diff --check` passaram.
- SCC: `recording-manager.ts` e `GeneralTab.tsx`, sem baseline comparavel; complexidade 769, ULOC 2714, DRYness 0.63; classificacao Neutral.
- Validacoes nao feitas: interacao visual em captura real, switch desligado seguido de nova gravacao.
- Motivo das validacoes nao feitas: a superficie Electron de gravacao requer interacao desktop; servidor local estava disponivel em `localhost:5173`.

## Riscos E Pendencias

- Validar o contraste no tema escuro e confirmar que o chip com margem de 4px nao conflita com elementos do sistema no monitor escolhido.

## Proximo Teste Esperado

- Em `Settings > General`, desligar `Recording Timer`, iniciar nova captura e confirmar ausencia de chip/F12.
- Ligar novamente, iniciar nova captura, confirmar chip verde 44x44 junto da borda direita e expansao por clique/F12.
