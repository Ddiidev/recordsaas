# Modo Take - diagnostico de desempenho durante gravacao

Gerado em: 2026-08-09
Sessao/contexto: 019fe6a2-context
Tipo de registro: retorno-qa

## Card

Registro anterior: [efeitos automaticos](./take-mode-2026-08-09-%7B019fe6a2-context%7D-retorno-qa-efeitos-automaticos.MD)

## Pedido Do Usuario

Pedido literal:

> Durante a gravação, o processo tá muito lento. O mouse, quando eu vou movendo o meu computador, fica completamente lento, travado, às vezes dá um stut. Enfim, no geral tá bem travado o computador como um todo, com essa gravação. Eu não sei se é o Filmi pega, eu não sei o que é. Eu posso deixar aqui gravando e aí você faz um diagnóstico do começo até o fim da gravação pra ver como ficou, mas tá muito lento. Isso não foi de agora, depois dessa última modificação não. Isso já vem já de um pouco antes.

Classificacao:

- Pedido explicito: diagnosticar travamento do computador e mouse durante gravacao real.
- Restricao: sintoma antecede o ultimo ajuste de Take Mode; nao atribuir causalidade sem evidencia.

## Interpretacao E Inferencias

- Diagnostico deve capturar processo Electron, FFmpeg, helper de audio, CPU/GPU/memoria/prioridade e logs durante a mesma sessao de gravacao.
- Nenhuma alteracao de encoder, prioridade ou captura sera feita sem evidencia do artefato e do perfil em execucao.

## Implementacao Ou Alteracao

- Nenhuma alteracao de codigo, configuracao ou projeto nesta rodada.
- Baseline 17:32:38–17:33:23: nenhum processo `ffmpeg` ou `recordsaas-system-audio` ativo, portanto ainda sem amostra da gravacao problematica.
- Electron principal do checkout: PID 11256, `AboveNormal`, aproximadamente 376 MB de working set no baseline. Nao e evidencia de causa sem a comparacao durante a captura.
- Leitura de WMI para linha de comando e memoria total foi negada pelo Windows; `Get-Process` e contadores de GPU permanecem disponiveis para a proxima amostra.
- Coleta real: 17:34:21–17:35:08, na gravacao manual concluida pelo usuario.
- Projeto analisado sem escrita: `C:\Users\andre\OneDrive\Documentos\RecordSaaS\RecordSaaS-2026-08-09-20-35`.
- Projeto confirma: tela `1920x1080`, `requestedScreenFps=60`, backend `gfxcapture`, Take Mode ativo, webcam, microfone e audio do sistema ativos; duracao fonte `52.35 s`.
- Pipeline real da tela: `gfxcapture` -> `-vf hwdownload,format=bgra` -> `h264_nvenc`, em `60 fps`. Ha download GPU->RAM antes do NVENC, portanto nao e caminho GPU direto.
- Prioridade efetiva: FFmpeg principal `low`/Windows priority `19` (Idle), webcam `low`/`10` (BelowNormal) e audio do sistema `low`/`19` (Idle).
- Amostra durante gravacao: FFmpeg principal PID 18124 com aproximadamente `334 MB` de working set; webcam PID 30952 com aproximadamente `156 MB`; helper de audio aproximadamente `64 MB`.
- GPU do FFmpeg principal: Video Encode entre `12%` e `32.4%`; engines 3D entre aproximadamente `5%` e `30%`. Nao ha evidencia de encoder NVENC saturado.
- Log final do FFmpeg principal: `3141` frames em `52.35 s`, `60 fps`, `dup=713`, `drop=0`, `speed=0.999x`. Cerca de 22.7% dos frames de saida foram duplicados para manter CFR; isto explica arquivo final liso sem provar fluidez da captura ao vivo.
- Artefato real: tela `2209 kb/s`; webcam `1006 kb/s`, `1280x720`, `15 fps`. Escrita sustentada total abaixo de aproximadamente `0.5 MB/s`; disco nao aparece como gargalo de escrita.

## Commits Relacionados Ao Card

Repositorio: `E:\GitHub\recordsaas-solutions\recordsaas`

- Branch: `main`
- Base/destino: `origin/main`
- Commits:
  - `e0ffa30` - `feat(editor): refine timeline and audio synchronization` - checkpoint anterior; nao contem este diagnostico.
- Push/PR: not pushed.

## Validacao

- Arquivo final liso, conforme relato do usuario: evidencia contra corrupcao/ritmo final do encode, mas nao elimina saturacao em tempo real de captura/GPU/I-O.
- Leitura do projeto, metadata e arquivos reais concluida.
- Log de FFmpeg e amostra de processos/GPU coletados durante a mesma sessao manual.
- Nenhuma validacao de correcao: esta rodada e somente diagnostico.

## Riscos E Pendencias

- Causa principal sustentada: transferencia GPU->RAM por frame em `gfxcapture` antes da re-subida ao NVENC, combinada com `1080p/60`, webcam CPU e audio simultaneos.
- A contribuicao isolada de webcam, audio e MouseTracker ainda requer A/B; o monitor nao fornece contador de I/O por processo neste ambiente.
- A prioridade `low` pode aumentar duplicacao de frames; elevar para `high` sem A/B pode piorar responsividade do desktop. Primeiro teste deve ser `normal`.

## Proximo Teste Esperado

- Antes de mudar codigo: A/B de 30 s, mesmo monitor/conteudo, em `60 fps` e `30 fps`, prioridade `normal`, mantendo webcam e audio ativos; medir `dup` e responsividade.
- Depois: A/B com webcam desligada. So entao alterar a cadeia de captura para evitar `hwdownload` se a compatibilidade do encoder for preservada.
