# audio-sync-delay - Cache do probe de fps/tamanho da webcam (2º blink do LED / latência residual)

Gerado em: 2026-08-24
Sessao/contexto: 4f0c2843
Tipo de registro: alteracao

Documento anterior: [audio-sync-delay-2026-08-24-{4f0c2843-context}-fix-webcam-release-e-mic-buffer.MD](audio-sync-delay-2026-08-24-%7B4f0c2843-context%7D-fix-webcam-release-e-mic-buffer.MD)

## Card

Arquivo do card: nenhum card formal; continuação da investigação/ajuste de delay de áudio e "engasgo" no gravador.

## Pedido Do Usuario

Pedido literal:
> ok, então trabalhe em uma implementação e depois me diga para testar, antes de me pedir novo teste, apagues os logs atuais para eu conseguir gerar novoso logs zerados.

Classificacao:
- Pedido explicito: continuar implementando (não só analisar) antes de pedir novo teste; apagar os logs atuais antes de pedir o próximo teste.
- Inferido: dar continuidade aos pontos já identificados no log da gravação anterior que ainda não tinham sido corrigidos (o probe de fps da webcam, que reabre o dispositivo e é a causa mais provável do 1º/2º blink do LED e de parte da latência entre a confirmação do release e o início real da gravação).

## Interpretacao E Inferencias

- Inferencia operacional: no log da gravação `Test1ClaudeDelay`, a linha `Webcam rejected requested 60fps; using 30fps instead.` (03:56:51.066) vem de `probeWin32DshowWebcamInput` ([recording-manager.ts:1055-1097](../../../electron/main/features/recording-manager.ts)), que **spawna um processo ffmpeg real** para abrir a webcam por `-t 0.2` (200ms) e testar se aquela combinação de fps/tamanho funciona. Isso roda **toda vez que uma gravação começa**, mesmo que o mesmo device com o mesmo perfil já tenha sido testado segundos antes — reabrindo fisicamente o dispositivo (LED) e adicionando latência no caminho crítico, depois que o release da webcam já foi confirmado.
- Motivo: não havia nenhum cache para esse probe (diferente do probe de rota de encoder de tela, que já tem [`gfxEncoderTransferCache`](../../../electron/main/features/windows-screen-capture.ts) em `windows-screen-capture.ts:33` e só roda uma vez por sessão do app).
- Risco da inferencia: baixo/médio — cache com TTL de 5 minutos, então no pior caso (device trocado fisicamente por outro com o mesmo nome dentro da janela de cache) o app usaria uma config testada com o device anterior; aceitável dado que isso já seria incomum e o TTL limita o tempo de exposição.

## Implementacao Ou Alteracao

[electron/main/features/recording-manager.ts:1099-1135](../../../electron/main/features/recording-manager.ts) (`resolveWebcamInputOptions`): adicionado cache em memória (`win32WebcamProbeCache`, `Map`) keyed por `deviceLabel::fps::tamanho`, com TTL de 5 minutos (`WIN32_WEBCAM_PROBE_CACHE_TTL_MS`). Na primeira chamada para uma combinação device+fps+tamanho, o probe real roda normalmente (abre a webcam por 200ms, como antes); nas chamadas seguintes dentro do TTL, o resultado é reaproveitado sem reabrir o dispositivo — elimina o 1º blink do LED e a latência associada em gravações repetidas com a mesma webcam/perfil (que é exatamente o fluxo de teste atual: gravar, ajustar, gravar de novo).

O que não foi feito: não toquei no probe de rota de encoder de tela (NVENC→download fallback) porque ele já tem cache próprio (`gfxEncoderTransferCache`) e só roda uma vez por sessão do app, não por gravação — não é fonte de latência repetida.

### Resumo cumulativo de todas as alterações desta task (3 commits ainda não feitos)
1. [src/pages/RecorderPage.tsx](../../../src/pages/RecorderPage.tsx) — release da webcam começa junto com o início do countdown, não só depois dele.
2. [src/pages/RecorderPage.tsx](../../../src/pages/RecorderPage.tsx) — segunda chamada de release (pedida pelo main process) não espera mais 1000ms à toa se o device já tinha sido liberado.
3. [electron/main/features/recording-manager.ts](../../../electron/main/features/recording-manager.ts) — `-thread_queue_size 4096` na entrada dshow do microfone (tentativa de corrigir o skew de áudio).
4. [electron/main/features/recording-manager.ts](../../../electron/main/features/recording-manager.ts) — cache do probe de fps/tamanho da webcam (elimina reabertura redundante do device a cada gravação).

## Commits Relacionados Ao Card

Nenhum commit relacionado encontrado ate este ponto.
Motivo: alterações feitas na working tree, ainda não commitadas (usuário não pediu commit).

## Validacao

- Validacoes feitas: `tsc --noEmit` no processo main (`tsconfig.node.json`) após a mudança do cache — sem erros.
- Validacoes nao feitas: nenhuma gravação real com o cache aplicado.
- Motivo das validacoes nao feitas: aguardando o usuário gravar o próximo teste.

## Riscos E Pendencias

- TTL do cache do probe de webcam é uma escolha arbitrária (5 min) — se causar algum comportamento estranho ao trocar de webcam rapidamente, vale revisar.
- Continua pendente confirmar se o `-thread_queue_size` no mic realmente resolveu (ou reduziu) o delay de áudio percebido — só um novo teste real confirma.
- Logs apagados (`recordsaas-main.log`, `recordsaas-main.old.log`) antes de pedir o próximo teste, conforme pedido.

## Proximo Teste Esperado

- Gravar um novo vídeo com webcam + mic.
- Observar: (a) se o "load" pós-countdown sumiu, (b) se ainda há blink duplo do LED ou só um blink (ou nenhum, se o cache já tiver sido aquecido por uma gravação anterior nesta mesma sessão do app), (c) se o delay de áudio mudou de magnitude.
- Depois do teste, enviar o caminho do projeto salvo (como da vez anterior) para eu inspecionar `captureSourceOffsetsMs` no `.json` e o `recordsaas-main.log` gerado.
