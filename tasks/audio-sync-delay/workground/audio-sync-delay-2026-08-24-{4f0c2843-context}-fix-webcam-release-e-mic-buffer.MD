# audio-sync-delay - Fix do "load" pós-countdown (release duplicado) + tentativa de fix do skew de áudio (buffer do mic)

Gerado em: 2026-08-24
Sessao/contexto: 4f0c2843
Tipo de registro: alteracao

Documento anterior: [audio-sync-delay-2026-08-24-{4f0c2843-context}-analise-delay-audio-webcam.MD](audio-sync-delay-2026-08-24-%7B4f0c2843-context%7D-analise-delay-audio-webcam.MD)

## Card

Arquivo do card: nenhum card formal; continuação da investigação ad-hoc de delay de áudio no gravador.
Resumo:
- Usuário gravou um vídeo de teste (`Test1ClaudeDelay`) após o primeiro ajuste (start do release da webcam já no início do countdown) e reportou: (a) delay de áudio continua, (b) após o countdown 3,2,1 terminar, a tela ainda fica em "load" antes de começar a gravar de fato, (c) o LED da webcam pisca uma ou duas vezes antes de ficar realmente ativo — como um "engasgo".

## Pedido Do Usuario

Pedido literal:
> Pronto gravei e ainda continua com delay, veja aqui o projeto salvo: C:\Users\andre\OneDrive\Documentos\RecordSaaS\Test1ClaudeDelay
>
> Algo que eu notei também é que termina o countdown, 3, 2, 1, e ao invés de a tela já sumir imediatamente, ele continua em load. Ali a webcam aparentemente já foi descarregada, mas ele continua em load.
>
> Eu vejo que o led aqui da minha webcam pisca uma ou duas vezes, aí depois ele fica realmente ativo, como se estivesse gravando agora. Então é como se ele desse um engasgo ali naquele momento a gravação; não sei qual motivo, mas é isso que acontece.
>
> Enfim, não consegui analisar melhor isso. Olha os logs, olha o projeto como ficou.

Classificacao:
- Pedido explicito: analisar o projeto gravado + logs, explicar o "load" pós-countdown e o duplo blink do LED.
- Pedido implicito (inferido do histórico da conversa/task anterior): corrigir o que for identificado, já que o usuário vem pedindo ajustes incrementais desde a mensagem anterior ("Depois ajuste o seguinte...").

## Interpretacao E Inferencias

- Inferencia operacional: com evidência de log suficientemente clara (timestamps exatos batendo com `WEBCAM_RELEASE_DELAY_MS`), tratei o "load pós-countdown" como o mesmo mecanismo de release da webcam, só que a **segunda** chamada (feita pelo main process via IPC `recorder:release-webcam`), que eu não tinha eliminado no ajuste anterior. Apliquei o fix diretamente em vez de só reportar, dado o padrão da conversa (usuário pedindo ajustes diretos, não só análise).
- Motivo: log mostra `Requesting recorder window to release webcam preview before recording.` às 03:56:48.023 e `Recorder window confirmed webcam release.` às 03:56:49.029 — exatamente 1006ms, batendo com `WEBCAM_RELEASE_DELAY_MS = 1000`. Isso acontece **depois** do countdown (a primeira liberação, feita durante o countdown, já tinha terminado antes mesmo do IPC `startRecording` ser enviado).
- Risco da inferencia: média — a causa raiz do delay de ÁUDIO (item separado do "load visual") é uma hipótese fundamentada em log real desta gravação, mas não comprovada por medição de conteúdo (waveform/frame). Deixei isso explícito abaixo.

## Implementacao Ou Alteracao

### 1) Log antigo apagado (pedido do usuário)
- Removidos [logs/recordsaas-main.log](../../../logs/recordsaas-main.log) e `recordsaas-main.old.log` antes da gravação de teste, e novamente após analisar esta gravação, para a próxima gravação vir limpa.

### 2) Achados da gravação de teste (`Test1ClaudeDelay`)

JSON de metadados (`RecordSaaS-recording-1787554612019.json`, campo `captureSourceOffsetsMs`):
```json
{"screen":1,"webcam":152,"recording":1,"systemAudio":674}
```
- `recording` (mic) = 1ms, igual a `screen` — ou seja, o mecanismo de offset automático **não está compensando nada** entre mic e tela (confirma o que já tinha sido identificado na análise anterior: o offset é herdado do processo `main` como um todo, não medido por stream).

Log ([logs/recordsaas-main.log](../../../logs/recordsaas-main.log), timestamps desta gravação):
- `03:56:48.023` — main process pede release da webcam (`requestRecorderWebcamRelease`).
- `03:56:49.029` — renderer confirma (exatos 1006ms depois → **este é o "load" que o usuário vê após o countdown**, e é a SEGUNDA chamada de release, redundante, que eu não tinha eliminado no ajuste anterior).
- `03:56:51.066` — `Webcam rejected requested 60fps; using 30fps instead.` — probe de capacidade da webcam (abre/fecha o dispositivo rapidamente para testar fps) → **provável causa do primeiro "blink" do LED**.
- `03:56:52.011` — probe interno de rota de encode de tela falha na rota NVENC direta (`OpenEncodeSessionEx failed: no encode device`) e cai para rota "download"; isso é um probe descartável, não é o processo real de gravação, então não afeta o áudio/vídeo gravado.
- `03:56:52.030-52.060` — os 3 processos FFmpeg reais (`main`=tela+mic, `webcam`, `system-audio`) são de fato spawnados → **provável causa do segundo "blink" do LED** (o processo `webcam` real abre o dispositivo de novo, depois do probe de fps já ter aberto e fechado).
- `03:56:53.040` — todos os 3 processos sinalizam "pronto"; offsets calculados e gravados.

Comando real do processo `main` (tela + mic), linha do log:
```
-f dshow -i audio=Grupo de microfones (...) -f lavfi -i gfxcapture=... -map 1:v -c:v h264_nvenc ... screen.mp4 -map 0:a -c:a aac ... audio.aac
```
**Confirmado**: a entrada de áudio do microfone (`-f dshow -i audio=...`) não tinha nenhum `-thread_queue_size`/`-rtbufsize`, diferente da entrada da webcam que já tinha `-thread_queue_size 1024 -rtbufsize 512M` ([recording-manager.ts:2771-2772](../../../electron/main/features/recording-manager.ts)). Isso confirma, com evidência de log real (não só leitura estática), a hipótese 5 do documento anterior.

### 3) Fix aplicado — eliminar o "load" duplicado pós-countdown

[src/pages/RecorderPage.tsx](../../../src/pages/RecorderPage.tsx), função `releaseWebcamPreview` (~linha 218-227): agora só aplica o `setTimeout(WEBCAM_RELEASE_DELAY_MS)` se havia de fato um stream de webcam ativo para liberar (`hadActiveStream = webcamStreamRef.current !== null` antes do teardown). Como a primeira liberação (disparada no início do countdown, ajuste da sessão anterior) já termina antes do IPC `startRecording` ser enviado, a segunda chamada (disparada pelo main process via `recorder:release-webcam`) agora encontra o stream já nulo e retorna imediatamente, sem esperar outro 1000ms.

**O que não foi feito**: não removi o handshake `requestRecorderWebcamRelease` em si ([recording-manager.ts:1543-1578](../../../electron/main/features/recording-manager.ts)) — ele continua existindo como uma segunda confirmação/timeout de segurança (3000ms), mas agora não deveria mais adicionar delay perceptível na prática, já que o release real já aconteceu antes.

### 4) Fix experimental — possível causa raiz do skew de áudio

[electron/main/features/recording-manager.ts:792-797](../../../electron/main/features/recording-manager.ts): adicionada constante `WIN32_DSHOW_MIC_THREAD_QUEUE_SIZE = '4096'`.

[electron/main/features/recording-manager.ts:2746](../../../electron/main/features/recording-manager.ts): entrada do mic no Windows agora inclui `-thread_queue_size 4096`, espelhando o tratamento que a webcam já recebe:
```
antes: -f dshow -i audio=${mic.deviceLabel}
depois: -f dshow -thread_queue_size 4096 -i audio=${mic.deviceLabel}
```

**Por que**: sem `-thread_queue_size`, o ffmpeg usa a fila padrão de 8 pacotes para a thread de captura do dshow. Quando essa captura de áudio compartilha processo com uma pipeline de vídeo mais pesada (`gfxcapture` + `hwdownload` + `nvenc`, que tem warm-up), a thread de áudio pode enfileirar/atrasar no início enquanto a pipeline de vídeo ainda está inicializando — produzindo um atraso sistemático e relativamente estável entre o primeiro frame de vídeo e a primeira amostra de áudio, compatível com os ~500-600ms que o usuário mediu manualmente. Este é o mecanismo mais provável, mas **não foi confirmado por medição de conteúdo** (waveform/clap-test), só por leitura do comportamento conhecido do ffmpeg + evidência do log real desta gravação.

## Commits Relacionados Ao Card

Nenhum commit relacionado encontrado ate este ponto.
Motivo: alterações feitas na working tree, ainda não commitadas (usuário não pediu commit).

## Validacao

- Validacoes feitas: `tsc --noEmit` no renderer (`tsconfig.json`) e no processo main (`tsconfig.node.json`) — sem erros em ambos, via `recordsaas/node_modules/.bin/tsc`.
- Validacoes nao feitas: nenhuma gravação real feita após este segundo ajuste (fix do release duplicado + thread_queue_size do mic). Nenhuma medição de waveform/skew real de áudio-vídeo.
- Motivo das validacoes nao feitas: aguardando o usuário gravar um novo vídeo de teste para eu inspecionar logs/JSON atualizados.

## Riscos E Pendencias

- O fix do `thread_queue_size` do mic é uma hipótese bem fundamentada mas não é garantia — se o delay persistir exatamente igual após o próximo teste, a causa está em outro lugar (ex.: driver de áudio específico, latência de outro estágio do pipeline, ou algo do lado do editor/preview).
- Se o delay mudar de magnitude mas não zerar, isso ajuda a isolar se o `thread_queue_size` é parte da causa ou não.
- O offset automático `captureSourceOffsetsMs.recording` continua sempre igual a `screen` (não mede o skew real dentro do processo `main`) — se o fix do buffer não resolver sozinho, o próximo passo seria instrumentar a medição real desse skew (ex.: parsing de timestamps por stream no stderr do ffmpeg) em vez de depender só de configuração de buffer.
- Nenhuma alteração foi commitada.

## Proximo Teste Esperado

- Gravar um novo vídeo de teste (webcam + mic) com os dois fixes aplicados.
- Verificar no log novo: tempo entre o request de release e a confirmação (deve ser ~0ms agora, não mais ~1000ms) e se ainda há os dois "blinks" do LED (o probe de fps em `03:56:51.066` ainda deve acontecer — não foi tocado neste ajuste — então um blink residual é esperado; o que deveria sumir é o atraso de "load" antes disso).
- Verificar percepção de sincronia de áudio; se ainda houver delay perceptível, comparar se a magnitude mudou em relação aos ~580ms medidos manualmente antes, para confirmar se o `thread_queue_size` do mic teve efeito parcial, total ou nenhum.
