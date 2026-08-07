# playback-seek - Implementacao GOP (3s), fix seek/timeout e Plano WebGL

Gerado em: 2026-08-06
Sessao/contexto: 96c08061-context
Tipo de registro: contexto

## Card

Registro anterior: [implementacao-gop-seek-timeout](./playback-seek-2026-08-06-{96c08061-context}-implementacao-gop-seek-timeout.MD).
Arquivo do plano exportado: [implementation_plan_webgl_compositor.MD](./implementation_plan_webgl_compositor.MD)
Resumo:
- Ajustar intervalo de GOP para 3s (`fps * 3`), otimizar tamanho do arquivo do projeto atual, diagnosticar o gargalo de FPS da webcam no player e exportar o plano detalhado de migração do compositor para WebGL2 + OffscreenCanvas Worker.

## Pedido Do Usuario

Pedido literal:
> você atualizou o wip, porém gostaria que exportasse o plano "c:\Users\andre\.gemini\antigravity\brain\96c08061-a13b-4683-8056-44d20a72c4f3\implementation_plan.md" para dentro dessa pasta do projeto e mencionasse o plano que ainda não foi concluído e expicar de forma breve sobre o que é direcionar para mais de detalhes e informar que ainda não foi aplicado o plano e nem respondido nada.

Classificacao:
- Pedido explicito: exportar o arquivo `implementation_plan.md` para a pasta de tarefas do projeto e atualizar o WIP com explicação breve, direcionamento de detalhes e aviso explícito de não aplicação/sem resposta do usuário.
- Restricoes explicitas: NENHUMA alteração de código ou execução do plano WebGL foi autorizada.

## Interpretacao E Inferencias

- Inferencia operacional: exportar o plano para [implementation_plan_webgl_compositor.MD](./implementation_plan_webgl_compositor.MD) no repositório e deixar registrado com clareza no WIP o seu status pendente.
- Motivo: manter o histórico técnico 100% auditável dentro do repositório do projeto.

## O Que É O Plano E Direcionamento Para Detalhes

### Resumo Breve do Plano:
O player atual do RecordSaaS usa a API 2D do Canvas (`drawImage`) na thread principal do React para compor a gravação de tela e a webcam. Esse processo obriga o navegador a fazer cópias constantes de quadros entre a GPU e a CPU a cada frame, causando perda severa de FPS na webcam (sensação de "vídeo travado/robótico").

O plano propõe a criação de um **Compositor WebGL2 acelerado por GPU rodando em um Web Worker separado (`OffscreenCanvas`)**, dividido em 3 fases:
- **Fase 1:** WebGL2 Compositor no main thread (upload direto de texturas `texImage2D`, elimina cópia de CPU).
- **Fase 2:** Transferência do loop para OffscreenCanvas Worker (elimina interferência do React/UI).
- **Fase 3:** Shaders GLSL para Gaussian blur e transições em GPU.

### Direcionamento para Detalhes Completos:
Para consultar a arquitetura de shaders, diagramas de thread, alterações necessárias em cada arquivo e plano de validação detalhado, veja o arquivo do plano exportado:
👉 **[implementation_plan_webgl_compositor.MD](./implementation_plan_webgl_compositor.MD)**

---

## ⚠️ STATUS DO PLANO WEBGL (CRÍTICO)

> [!WARNING]
> **ESTADO ATUAL DO PLANO WEBGL:**
> - **NÃO FOI APLICADO:** Nenhuma linha de código referente à migração WebGL2 ou Worker foi implementada.
> - **NÃO FOI EXECUTADO:** O pipeline de reprodução do app continua exatamente em Canvas 2D.
> - **SEM RESPOSTA / APROVAÇÃO DO USUÁRIO:** O usuário ainda **NÃO respondeu**, **NÃO aprovou** e **NÃO tomou decisão** sobre a execução deste plano.

---

## Implementacoes Que JA Foram Concluidas Nesta Sessao

1. **GOP de 3s no Gravador:**
   - [recording-manager.ts](../../../electron/main/features/recording-manager.ts): GOP alterado para `fps * 3` (`-g 90` em 30fps / `-g 180` em 60fps) na tela e na webcam.
2. **Correcoes no Player Frontend:**
   - [Timeline.tsx](../../../src/components/editor/Timeline.tsx): `handleSeekFailure` e `release` não drenam/retomam playback enquanto `video.seeking = true`.
   - [Preview.tsx](../../../src/components/editor/Preview.tsx): Redraw de canvas liberado durante scrubbing.
3. **Script de Reparo de Vídeos:**
   - [fix_project_video.ps1](../../../fix_project_video.ps1): Re-encodou o vídeo de teste a `-g 180` / `-crf 22`, reduzindo o arquivo de 281 MB para 40.19 MB mantendo busca fluida.

## Commits Relacionados Ao Card

- Repositorio: `E:\GitHub\recordsaas-solutions\recordsaas`
- Commits realizados:
  - `c91c543` - `fix(encoder): set 3-second GOP interval for screen and webcam recording`
  - `316263c` - `fix(editor): improve seek handling and canvas redraw during timeline scrub`
  - `2cecc96` - `feat(tasks): add playback seek diagnostics and video repair script`
  - `b8ed148` - `feat(timeline): enhance zoom anchor, resize handles and region blocks`

## Validacao

- Validacoes feitas: export do plano WebGL2 para [implementation_plan_webgl_compositor.MD](./implementation_plan_webgl_compositor.MD); probe do vídeo com FFmpeg (CFR 30fps); re-encode com GOP de 3s gerando arquivo de 40.19 MB.
- Validacoes nao feitas: execução do plano WebGL (plano não aprovado nem iniciado).

## Riscos E Pendencias

- O gargalo de FPS da webcam no player do editor só será resolvido quando o plano WebGL2 for formalmente aprovado e desenvolvido.
