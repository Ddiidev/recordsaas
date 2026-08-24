# audio-sync-delay - Causa raiz medida: offsets reais a partir da duração dos arquivos

Gerado em: 2026-08-24
Sessao/contexto: 4f0c2843
Tipo de registro: alteracao

Documento anterior: [audio-sync-delay-2026-08-24-{4f0c2843-context}-mic-processo-proprio.MD](audio-sync-delay-2026-08-24-%7B4f0c2843-context%7D-mic-processo-proprio.MD)

## Card

Arquivo do card: nenhum card formal; continuação da investigação de delay de áudio no gravador.

## Pedido Do Usuario

Pedido literal:
> Continua com um delay muuuuito escroto
> Novo projeto gravado:
> C:\Users\andre\OneDrive\Documentos\RecordSaaS\Test3ClaudeDelay

## Interpretacao E Inferencias

- Até aqui as hipóteses foram tratadas por leitura de código. Nesta rodada consegui **medir** a causa, usando os três projetos de teste como dados reais.
- Método: cada processo FFmpeg recebe o pedido de parada dentro de ~4ms dos outros (log: `18.459`, `18.461`, `18.462`, `18.463`). Logo, **um arquivo que ficou mais longo é um arquivo que começou mais cedo**: `início = parada − duração`. Isso dá o instante real de início de cada fonte, sem depender de nenhuma heurística.

## Implementacao Ou Alteracao

### 1) Medição das três gravações (ffmpeg -i sobre os arquivos finais)

| Gravação | screen | webcam | mic (audio.aac) |
|---|---|---|---|
| Test1 | 17.00s | 17.50s | 18.22s |
| Test2 | 15.67s | 15.97s | 16.90s |
| Test3 | 16.27s | 16.00s | 16.19s |

Instantes reais de início (Test3): screen `2.189`, webcam `2.461`, mic `2.272`. Comparando com o spawn de cada processo (`2.033`/`2.038`/`2.043`), isso dá warm-up de 156ms (tela), 423ms (webcam) e 229ms (mic) — todos fisicamente plausíveis, o que valida o método.

### 2) Erro real de sincronia, calculado a partir desses dados

Script de verificação: [verify-sync.mjs](../../../../../../Users/andre/AppData/Local/Temp/claude/E--GitHub-recordsaas-solutions/4f0c2843-9d44-40e8-88a4-15db04c64a54/scratchpad/verify-sync.mjs) (scratchpad, descartável).

| Gravação | offsets gravados | atraso real do áudio vs webcam | vs tela |
|---|---|---|---|
| Test1 | `screen:1, webcam:152, recording:1` | **870ms** | 1217ms |
| Test2 | `screen:1, webcam:203, recording:1` | **1131ms** | 1227ms |
| Test3 | `screen:248, webcam:161, recording:0` | **350ms** | 165ms |

Ou seja: o split do mic em processo próprio (rodada anterior) reduziu bastante o erro (870→350ms), mas não corrigiu — porque os offsets continuavam vindo de fonte errada.

### 3) Causa raiz confirmada

Os `captureSourceOffsetsMs` eram derivados das mensagens de "pipeline ready" que o FFmpeg escreve no stderr ([recording-manager.ts](../../../electron/main/features/recording-manager.ts), `markRecordingReady`). Essas mensagens **disparam em momentos completamente diferentes conforme o codec e o muxer**: no Test3, a webcam sinalizou "ready" em `2.842` mas tinha começado de fato em `2.461` (380ms de diferença); o mic sinalizou em `3.024` tendo começado em `2.272` (750ms). Comparar essas marcas entre fontes não mede nada — foi isso que produziu offsets como `webcam:161, recording:0` quando a verdade era `webcam:0, recording:190`.

Também havia um bug secundário: `readyMonotonicByRole.set(...)` era chamado a cada mensagem que qualificava como "ready", então **a última vencia** em vez da primeira (visível no log: quatro linhas `Ready signal from main`).

### 4) Correções aplicadas

Todas em [electron/main/features/recording-manager.ts](../../../electron/main/features/recording-manager.ts) e [electron/main/state.ts](../../../electron/main/state.ts):

1. **`probeMediaDurationSeconds`** (novo): lê a duração de um arquivo finalizado via FFmpeg.
2. **`measureCaptureSourceStarts`** (novo): após todos os processos encerrarem, mede as durações de tela/webcam/mic e grava `início = parada − duração` em `session.captureSourceStartMonotonicMs` (campo novo em `RecordingSession`). O instante de parada é capturado uma única vez, imediatamente antes de mandar parar todos os processos, em `cleanupAndSave`.
3. **`resolveMeasuredCaptureOffsets`** (novo): reconstrói os offsets a partir desses instantes. Origem = último início (a fonte que subiu por último); offset de cada fonte = origem − seu início.
4. **`processAndSaveMetadata`**: passa a gravar os offsets medidos no `.json`, com os offsets antigos (baseados em "ready") preservados apenas como fallback caso a medição falhe. Eventos de mouse e take boundaries são re-ancorados à nova origem.
5. **Bug do "último vence"** corrigido: só a primeira marca de ready por role é registrada.

**Tentativa descartada no meio do caminho**: cheguei a implementar a medição ao vivo, lendo `time=` do stderr durante a gravação. Descartei ao verificar nos logs reais que esse valor **fica atrás do que foi realmente capturado** — cada dispositivo segura um tanto diferente em buffer, liberado só no stop (mic ~0.75s, webcam ~1.06s no Test3). Usar isso teria introduzido um novo desalinhamento em vez de corrigir. A duração do arquivo final inclui esse buffer, por isso é a medida correta.

### 5) Verificação da correção (contra os dados reais das 3 gravações)

Com os offsets medidos, a dispersão entre tela, webcam e mic vai a **0ms nas três gravações**. E há uma propriedade que cai de graça: como `offset = origem − início` e `duração = parada − início`, todas as fontes ficam com **exatamente a mesma quantidade de conteúdo depois da origem** (`parada − origem`), então nenhuma fonte é solicitada por conteúdo que ainda não tinha capturado. Medido: dispersão de 3ms, que é o jitter dos pedidos de parada.

### O que não foi feito
- **Áudio do sistema**: o arquivo sai com duração que não corresponde à gravação (Test3: `31.29s` para ~16s; Test2: `30.76s` para ~15.7s; Test1: `63.32s` para ~17s), então sua duração não serve para medir início. Ele mantém a distância para a tela que já tinha, re-ancorada na nova origem — comportamento relativo inalterado, sem regressão. Essa duração inflada é **um bug separado**, provavelmente formato/canais entre o helper C# e o `-f f32le -ar 48000 -ac 2` do FFmpeg; não investiguei porque está fora do que foi pedido e o conteúdo nesses testes era praticamente silêncio (4 kb/s).
- Caminhos sem webcam no Windows e macOS/Linux continuam com mic no mesmo processo da tela. Lá a medição de `recording` não existe e o fallback mantém a distância para a tela (comportamento atual). Segue registrado como tarefa separada.

## Commits Relacionados Ao Card

Nenhum commit relacionado encontrado ate este ponto.
Motivo: alterações na working tree, ainda não commitadas (usuário não pediu commit).

## Validacao

- Validacoes feitas: `tsc --noEmit` no processo main sem erros; verificação numérica da lógica de offsets contra os dados reais das três gravações (dispersão 0ms, conteúdo utilizável idêntico entre fontes); confirmação nos logs de que mic e webcam emitem progresso e de que os pedidos de parada ficam a ~4ms um do outro.
- Validacoes nao feitas: nenhuma gravação real com esta versão. A medição das durações roda só em tempo de execução do app.
- Motivo: não há acesso a webcam/microfone reais neste ambiente.

## Riscos E Pendencias

- A medição adiciona uma sondagem FFmpeg por arquivo ao parar a gravação (timeout de 5s cada, em paralelo). Deve ser rápido em arquivos locais, mas é um passo novo no caminho de salvar.
- Se a próxima gravação mostrar no log `[SYNC] Measured capture durations` e `[SYNC] Measured capture offsets` com valores plausíveis e a sincronia estiver correta, a causa está fechada. Se o log mostrar `No measured capture starts available`, a sondagem falhou e caímos no comportamento antigo.
- Bug separado em aberto: duração inflada do arquivo de áudio do sistema.

## Proximo Teste Esperado

- Gravar novo vídeo com webcam + mic e conferir a sincronia falando olhando para a câmera.
- No log novo, as linhas `[SYNC] Measured capture durations(s)=...` e `[SYNC] Measured capture offsets(ms)=... (provisional=...)` mostram lado a lado o que foi medido e o que o método antigo teria gravado.
- Esperado no `.json`: `captureSourceOffsetsMs` com a fonte que subiu por último em `0` e as outras com valores proporcionais à diferença de duração dos arquivos.
