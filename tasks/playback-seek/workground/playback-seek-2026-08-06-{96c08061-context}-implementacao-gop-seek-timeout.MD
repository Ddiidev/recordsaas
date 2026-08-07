# playback-seek - Implementacao GOP (3s), fix seek/timeout e Plano WebGL

Gerado em: 2026-08-06
Sessao/contexto: 96c08061-context
Tipo de registro: contexto

## Card

Registro anterior: [implementacao-gop-seek-timeout](./playback-seek-2026-08-06-{96c08061-context}-implementacao-gop-seek-timeout.MD).
Resumo:
- Ajustar intervalo de GOP para 3s (`fps * 3`), otimizar tamanho do arquivo do projeto atual, diagnosticar o gargalo de FPS da webcam (composição 2D na CPU) e registrar o plano detalhado de migração do compositor para WebGL2 + OffscreenCanvas Worker.

## Pedido Do Usuario

Pedido literal:
> salve esse plano e salve no arquivo de WIP mencionando o plano e que ainda não foi decicido.

Classificacao:
- Pedido explicito: salvar o plano de arquitetura WebGL e registrar no documento de WIP que a decisão sobre sua execução permanece pendente.
- Restricoes explicitas: nenhuma implementação do plano WebGL deve ser iniciada até a aprovação do usuário.

## Interpretacao E Inferencias

- Inferencia operacional: registrar o plano técnico completo no WIP sem alterar nenhum código referente à migração WebGL neste momento.
- Motivo: o usuário optou por planejar a Opção B (WebGL2 + OffscreenCanvas Worker) para resolver o gargalo de renderização da webcam e micro-stutters, mas a decisão final de início de desenvolvimento ainda não foi tomada.

## Implementacao Ou Alteracao Concluida

1. **GOP e Seek (Concluído nesta sessão):**
   - Gravador ([recording-manager.ts](../../../electron/main/features/recording-manager.ts)): GOP configurado para `fps * 3` em tela e webcam.
   - Script ([fix_project_video.ps1](../../../fix_project_video.ps1)): Re-encode do projeto de teste concluído (`-g 180`, `-crf 22`, redução do arquivo de 281 MB para 40.19 MB).
   - Player ([Timeline.tsx](../../../src/components/editor/Timeline.tsx) e [Preview.tsx](../../../src/components/editor/Preview.tsx)): Proteção contra seeks cancelados prematuramente e liberação de redraw durante scrubbing.

2. **Plano de Arquitetura WebGL2 (Registrado e Pendente de Decisão):**
   - **Diagnóstico:** O arquivo MP4 gerado tem 30 FPS constantes e sem falhas no MPC. A queda de FPS da webcam ocorre exclusivamente no compositor 2D do player (`Preview.tsx` / `renderer.ts`), que roda em CPU compartilhando a thread do React.
   - **Plano de Solução (Opção B):**
     - **Fase 1:** WebGLCompositor no main thread (substitui `ctx.drawImage` por `texImage2D` acelerado por GPU).
     - **Fase 2:** OffscreenCanvas em Web Worker dedicado (elimina competição por thread com o React).
     - **Fase 3:** Shaders GLSL avançados (Gaussian blur e transições em GPU).
   - **Estado Atual:** Plano documentado em [implementation_plan.md](../../../../.gemini/antigravity/brain/96c08061-a13b-4683-8056-44d20a72c4f3/implementation_plan.md). **Ainda não decidido / Não iniciado.**

## Commits Relacionados Ao Card

- Repositorio: `E:\GitHub\recordsaas-solutions\recordsaas`
- Commits: nenhum commit feito; apenas alterações locais de GOP e seek no working tree.

## Validacao

- Validacoes feitas: probe do arquivo de vídeo com FFmpeg (CFR 30fps perfeito); re-encode com GOP de 3s gerando arquivo de 40.19 MB; plano de arquitetura WebGL2 validado teoricamente.
- Validacoes nao feitas: implementação do compositor WebGL (aguardando decisão).

## Riscos E Pendencias

- O gargalo de FPS da webcam no player continuará até a aprovação e implementação do plano WebGL2.
- A decisão de iniciar o desenvolvimento do compositor WebGL2 está pendente de autorização do usuário.
