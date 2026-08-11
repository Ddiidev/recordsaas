# Timer flutuante da gravação — 2026-08-10

## Pedido literal

> Quero que adicione uma mini modal ou uma janela flutuante pequena que eu possa clicar para aparecer ou não aparecer; ela deve ficar no cantinho da tela. Eu clico, ela sai da direita para a esquerda e eu consigo olhar o tempo de gravação atual.
>
> Atualmente ele grava, mas eu não sei quanto tempo já se foi gravando, então eu quero adicionar isso aí. Vamos lá. Outro chip da F12.

## Decisão

- `F12` foi tratado como atalho global adicional, ativo apenas durante captura.
- O estado inicial é um chip recolhido no canto inferior direito; clique ou `F12` expande para a esquerda e mostra `HH:MM:SS`.
- O cronômetro inicia quando o pipeline FFmpeg confirma que a gravação está pronta, não durante preparação.
- A janela é do processo principal, sempre no topo e `setContentProtection(true)` para não entrar na gravação.
- Se `F12` estiver ocupado no sistema, a captura continua e o clique no chip mantém a função disponível.

## Alterações

- [recording-manager.ts](E:/GitHub/recordsaas-solutions/recordsaas/electron/main/features/recording-manager.ts): janela, animação, tempo, atalho e ciclo de vida.
- [state.ts](E:/GitHub/recordsaas-solutions/recordsaas/electron/main/state.ts): referência da janela de timer.
- [recording.ts](E:/GitHub/recordsaas-solutions/recordsaas/electron/main/ipc/handlers/recording.ts), [index.ts](E:/GitHub/recordsaas-solutions/recordsaas/electron/main/ipc/index.ts) e [preload.ts](E:/GitHub/recordsaas-solutions/recordsaas/electron/preload.ts): IPC restrito `recording:toggle-timer`.
- [AGENTS.MD](E:/GitHub/recordsaas-solutions/recordsaas/AGENTS.MD): contrato de IPC, proteção e atalho.

## Validação

- `npx tsc --noEmit --pretty false` passou.
- `npx eslint electron/main/features/recording-manager.ts electron/main/state.ts electron/main/ipc/handlers/recording.ts electron/main/ipc/index.ts electron/preload.ts` passou.
- `npx prettier --check electron/main/features/recording-manager.ts electron/main/state.ts electron/main/ipc/handlers/recording.ts electron/main/ipc/index.ts electron/preload.ts AGENTS.MD` passou.
- `git diff --check` passou.
- SCC localizado: 5 arquivos, complexidade 743, ULOC 3132, DRYness 0.66; não havia baseline para comparação.
- `run.bat` iniciou uma instância local atualizada; interação de captura real ainda requer confirmação visual.

## Risco residual

- Falta QA manual em gravação real: posição no monitor escolhido, clique, `F12`, expansão e confirmação de que o chip não aparece no vídeo final.

## Git

- Branch: `gitbutler/workspace`.
- Nenhum commit criado.
