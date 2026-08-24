# audio-sync-delay - Análise de delay de áudio no gravador (webcam release / countdown / JSON de sync)

Gerado em: 2026-08-24
Sessao/contexto: 4f0c2843
Tipo de registro: contexto

## Card

Arquivo do card: não há card formal aberto para este item; task criada ad-hoc a partir de relato direto do usuário.
Resumo:
- Usuário relata delay perceptível de áudio em relação ao vídeo nas gravações do Record SAS.
- Sem PR/branch dedicado ainda. Este documento é puramente de investigação/análise, sem implementação.

## Pedido Do Usuario

Pedido literal:
> Atualmente, no gravador do Record SAS, ele está com um delay no áudio. O que eu presumo é que ele conta 3, 2, 1 e, para começar mesmo, ele precisa primeiro desvincular a webcam ali para depois poder realmente iniciar a gravação da webcam. Porque se tiver dois aplicativos utilizando a webcam ao mesmo tempo, em algumas webcams ou em algumas configurações do Windows, ele pode dar conflito. Então ele precisa desse time. Mas aí eu acredito que, nesse time, a gravação já começou ou algo do tipo; eu não tenho certeza, isso é só uma especulação minha, na verdade. Pode seguir para uma análise mais profunda.
>
> Segundo ponto é que eu acho que tem cerca de uns 580 milissegundos, enfim, é na casa dos 500 a 600 milissegundos eu acredito de demora, porque eu editei um vídeo e eu consigo, através de uma configuração de sincronia de áudio no modo editor, editar e colocar 580 milissegundos de sincronia para frente e ele funcionou perfeitamente. Então eu acho que deve ser esse o tempo. Não tenho certeza, então é preciso dar uma analisada.
>
> Mas já foi ajustado algo parecido anteriormente, que era o seguinte: era para todos começarem a gravar assim que pudessem, porém, no arquivo JSON que tem todas as informações na gravação (ele iria estar .json), iria estar a informação de quando de fato todos começaram ao mesmo tempo. Então é isso. Precisa analisar e amarrar todos os pontos corretamente.

Classificacao:
- Pedido explicito: analisar a fundo o delay de áudio, confirmar/refutar as hipóteses do usuário (unbind de webcam causando o delay; ~580ms; mecanismo de JSON com timestamps reais já existente), e amarrar os pontos.
- Restricoes explicitas: nenhuma correção de código pedida ainda — só análise ("pode seguir para uma análise mais profunda", "precisa analisar e amarrar todos os pontos corretamente").

## Interpretacao E Inferencias

- Inferencia operacional: tratado como investigação read-only via subagente Explore, sem alterar código.
- Motivo: pedido do usuário foi explicitamente de análise, não de implementação.
- Risco da inferencia: baixo — nenhuma mudança de comportamento foi feita nesta sessão.

## Implementacao Ou Alteracao

Nenhuma implementação realizada. Análise estática do código de gravação e do editor.

### Achados principais

**1. Fluxo de start de gravação (visão geral):**
- Countdown 3,2,1 controlado em [RecorderPage.tsx](../../../src/pages/RecorderPage.tsx) (`runPreparationCountdown`, `handleStart`, `startRecordingAfterPreparation`).
- Ao fim da contagem, `startRecordingAfterPreparation()` chama `releaseWebcamPreview()` (renderer) e depois IPC `startRecording` → main process.
- Main process (`startRecording` em [recording-manager.ts](../../../electron/main/features/recording-manager.ts)) pede novamente liberação da webcam via `requestRecorderWebcamRelease()`, resolve args de tela/mic/webcam, e chama `startActualRecording(...)`.
- `startActualRecording` faz spawn de processos FFmpeg separados (tela+mic num processo `role: 'main'`, webcam em `role: 'webcam'`, áudio de sistema em processo/pipe à parte). Cada processo sinaliza "pronto" via stderr; só quando todos sinalizam, `captureOriginMonotonicMs` é fixado e `captureSourceOffsetsMs` (offset de pré-roll por fonte) é calculado e gravado.

**2. Hipótese do usuário sobre "unbind da webcam" — parcialmente confirmada, mas não é a causa do delay de áudio:**
- Existe sim uma etapa de liberação/"unbind" da webcam antes do start real, e ela é **duplicada**:
  - Chamada 1 (proativa): [RecorderPage.tsx:595](../../../src/pages/RecorderPage.tsx) via `releaseWebcamPreview()`.
  - Chamada 2 (reativa, pedida pelo main process): [recording-manager.ts:2641-2643](../../../electron/main/features/recording-manager.ts) (`requestRecorderWebcamRelease`) → listener em [RecorderPage.tsx:488-496](../../../src/pages/RecorderPage.tsx) chama `releaseWebcamPreview()` de novo.
  - Cada chamada aplica um `setTimeout` fixo de `WEBCAM_RELEASE_DELAY_MS = 1000ms` ([RecorderPage.tsx:50](../../../src/pages/RecorderPage.tsx)), mesmo quando não há mais nada a liberar na segunda chamada.
  - **Impacto real:** até ~2000ms de delay fixo/redundante entre fim do countdown e o início do processamento de start — mas esse delay acontece **antes** de qualquer processo FFmpeg nascer, então atrasa tela+mic+webcam de forma uniforme. Não deveria causar dessincronia relativa entre áudio e vídeo, só atraso do início "de fato" da gravação em relação ao countdown visual (pode fazer perder os primeiros segundos de fala/ação — problema real, mas diferente do relatado).

**3. Nenhum valor fixo de 500-600ms/580ms encontrado ligado a webcam/countdown/áudio.**
- Únicos delays fixos relevantes ao caminho de start: `WEBCAM_RELEASE_DELAY_MS = 1000ms` (duplicado, ver item 2).
- Outros `setTimeout(..., 500)` encontrados em [recording-manager.ts](../../../electron/main/features/recording-manager.ts) (linhas ~3222, 3662, 3922, 4360) são **pós-gravação** (fechamento de janela "saving"), não relacionados ao delay de sincronismo relatado.

**4. Mecanismo de JSON com timestamps reais — já existe, mas incompleto para o caso mic vs. tela:**
- Campo `captureSourceOffsetsMs` (montado em [recording-manager.ts:2177-2182](../../../electron/main/features/recording-manager.ts)) já registra, por role de processo FFmpeg (`screen`, `webcam`, `recording`, `systemAudio`), o pré-roll relativo até todos ficarem prontos. Esse é exatamente o mecanismo que o usuário lembrava de já ter sido ajustado antes (confirmado por commits `e0ffa30` "feat(editor): refine timeline and audio synchronization", 2026-08-09, e `4122b8b` "Fix: Improve webcam recording and timeline audio sync", 2026-07-18 — ver seção de commits).
- **Lacuna:** o campo `recording` (áudio do microfone) recebe **o mesmo valor** de `screen`, porque mic e tela são capturados **dentro do mesmo processo FFmpeg** (`role: 'main'`, [recording-manager.ts:2545-2547](../../../electron/main/features/recording-manager.ts)). O sinal de "pronto" é por processo, não por stream interno — logo, o offset entre o áudio do mic e o vídeo de tela dentro do mesmo processo é **assumido como zero**, nunca medido.
- O editor tem um campo manual `recordingSyncOffsetMs` ([projectSlice.ts:1157](../../../src/store/slices/projectSlice.ts), aplicado em [Preview.tsx](../../../src/components/editor/Preview.tsx) e [export-manager.ts](../../../electron/main/features/export-manager.ts)) que começa em `0` e só muda se o usuário ajustar manualmente o slider em [AudioSettings.tsx](../../../src/components/editor/sidepanel/AudioSettings.tsx) — foi exatamente esse slider que o usuário usou para testar +580ms manualmente.

**5. Hipótese de causa raiz mais fundamentada (não comprovada por runtime, só por leitura estática):**
- A entrada da webcam recebe `-thread_queue_size`/`-rtbufsize` explícitos via `appendWin32DshowWebcamBufferOptions` (~[recording-manager.ts:1015-1022](../../../electron/main/features/recording-manager.ts)).
- A entrada do microfone (`micInputArgs`, [recording-manager.ts:2746](../../../electron/main/features/recording-manager.ts)) **não recebe** o mesmo ajuste de buffer.
- Essa assimetria de configuração DirectShow é uma causa plausível de latência de inicialização sistemática do áudio em relação ao vídeo de tela, dentro do mesmo processo FFmpeg — consistente com um offset estável de ~500-600ms que uma correção manual fixa resolve "perfeitamente" (como o usuário observou).
- **Não comprovado por logs/execução real nesta sessão** — seria necessário rodar uma gravação e inspecionar stderr do FFmpeg em busca de mensagens de bloqueio de thread/buffer para confirmar.

### O que não foi feito
- Nenhuma alteração de código.
- Nenhum teste/build/execução da aplicação.
- Não foi confirmado por logs de runtime a causa raiz (item 5) — é a hipótese mais bem sustentada pela leitura estática, não um fato comprovado.

### Pontos exatos para fix futuro (candidatos, não implementados)
- [recording-manager.ts:2746](../../../electron/main/features/recording-manager.ts) — adicionar `-thread_queue_size` (e possivelmente buffer size) à entrada do microfone via dshow, espelhando o que já existe para webcam.
- [recording-manager.ts:2177-2182](../../../electron/main/features/recording-manager.ts) — `markRecordingReady`: hoje `recording: offsetFromReady('main')` é forçado igual a `screen`; para medir offset real entre áudio e vídeo dentro do mesmo processo seria necessário instrumentar timestamps por stream no FFmpeg, não só o sinal de "processo pronto".
- [RecorderPage.tsx:50](../../../src/pages/RecorderPage.tsx) e [RecorderPage.tsx:488-496](../../../src/pages/RecorderPage.tsx) — eliminar a segunda chamada redundante de `releaseWebcamPreview()` (com seu `setTimeout` de 1000ms) quando a webcam já foi liberada pela primeira chamada.
- [recording-manager.ts:2641-2643](../../../electron/main/features/recording-manager.ts) (`requestRecorderWebcamRelease`) — reavaliar necessidade desse segundo handshake dado que o renderer já libera a webcam proativamente antes do IPC `startRecording`.

## Commits Relacionados Ao Card

Repositorio: recordsaas
- Branch: não determinado nesta análise (busca feita com `--all`)
- Commits relevantes encontrados por histórico (relacionados ao mecanismo de sync já existente, não a este delay específico):
  - `e0ffa3041db3367b0314b94abbcf5fa6e38537ab` - `feat(editor): refine timeline and audio synchronization` - 2026-08-09 - implementou/refinou o mecanismo de sincronia de timeline/áudio no editor; provável origem parcial do `captureSourceOffsetsMs`/sliders de sync manual.
  - `4122b8b9ae31054b00e6e9a76c25f297f5453990` - `Fix: Improve webcam recording and timeline audio sync` - 2026-07-18 - ajuste anterior de gravação de webcam e sync de áudio na timeline; correlato à lembrança do usuário sobre "algo parecido ajustado antes".
  - `c07765f8ff39a14c9f9acafe0cd486df4aa1baf3` - `perf: remove async/await from render pipeline and reduce webcam syncs (#5)` - 2026-02-22 - reduz syncs de webcam no pipeline de render; contexto histórico do fluxo de webcam.
- Push/PR: não aplicável — nenhum commit novo criado nesta sessão.

## Validacao

- Validacoes feitas: leitura completa e por blocos de [recording-manager.ts](../../../electron/main/features/recording-manager.ts) (4389 linhas), leitura de [RecorderPage.tsx](../../../src/pages/RecorderPage.tsx), [projectSlice.ts](../../../src/store/slices/projectSlice.ts), [Preview.tsx](../../../src/components/editor/Preview.tsx), [AudioSettings.tsx](../../../src/components/editor/sidepanel/AudioSettings.tsx), [export-manager.ts](../../../electron/main/features/export-manager.ts); busca por valores hardcoded de delay; busca de histórico git por commits relacionados.
- Validacoes nao feitas: nenhuma execução real da gravação, nenhuma inspeção de stderr do FFmpeg em runtime, nenhuma medição empírica do offset real mic-vs-tela.
- Motivo das validacoes nao feitas: pedido do usuário foi apenas de análise estática nesta etapa ("pode seguir para uma análise mais profunda" / "precisa analisar e amarrar todos os pontos").

## Riscos E Pendencias

- A hipótese de causa raiz (assimetria de `-thread_queue_size` entre webcam e mic) não está comprovada por execução real — pode haver outro fator concorrente (ex.: driver de áudio específico, latência de DirectShow variável por hardware).
- O delay duplicado de `WEBCAM_RELEASE_DELAY_MS` (item 2) é um problema real e separado (atraso uniforme de início, não dessincronia), que pode ser corrigido independentemente da causa raiz do delay de áudio.
- Qualquer fix nos offsets de `captureSourceOffsetsMs.recording` precisa considerar compatibilidade com projetos/JSONs já gravados (campo `recordingSyncOffsetMs` manual do usuário não deve ser sobrescrito/duplicado).

## Proximo Teste Esperado

- Gravar um vídeo curto com webcam + mic, inspecionar o `.json` de metadados gerado (`captureSourceOffsetsMs.recording` vs `screen`) para confirmar que hoje são sempre iguais.
- Se possível, capturar stderr do FFmpeg durante uma gravação real para procurar mensagens de bloqueio/latência de thread do dispositivo de áudio (dshow) e assim confirmar ou refutar a hipótese de causa raiz do item 5 antes de implementar qualquer fix.
