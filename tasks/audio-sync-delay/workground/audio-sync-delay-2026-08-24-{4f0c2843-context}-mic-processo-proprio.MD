# audio-sync-delay - Microfone em processo FFmpeg próprio (medir o skew real em vez de assumir zero)

Gerado em: 2026-08-24
Sessao/contexto: 4f0c2843
Tipo de registro: alteracao

Documento anterior: [audio-sync-delay-2026-08-24-{4f0c2843-context}-cache-probe-fps-webcam.MD](audio-sync-delay-2026-08-24-%7B4f0c2843-context%7D-cache-probe-fps-webcam.MD)

## Card

Arquivo do card: nenhum card formal; continuação da investigação/ajuste de delay de áudio no gravador.

## Pedido Do Usuario

Pedido literal:
> O delay continua. Eu observei que no vídeo, na webcam, eu falo e o áudio acontece alguns milissegundos depois, ou 1 segundo depois; eu não tenho certeza.
>
> Eu ainda estou na tese de que é 580 milissegundos depois que o áudio começa a tocar. Olha aí o projeto, olha os logs e vê o que você consegue entender nisso.
>
> C:\Users\andre\OneDrive\Documentos\RecordSaaS\Test2ClaudeDelay

(Pedido de continuidade da mensagem anterior: "trabalhe em uma implementação e depois me diga para testar, antes de me pedir novo teste, apagues os logs atuais".)

## Interpretacao E Inferencias

- Confirmado pelo log ([logs/recordsaas-main.log](../../../logs/recordsaas-main.log) desta gravação, arquivado antes de ser apagado): os dois fixes anteriores funcionaram — release da webcam confirmado em 2ms (antes ~1000-2000ms) e probe de fps não roda mais na segunda gravação da mesma sessão do app (cache hit). Isso resolveu o "load" pós-countdown, mas **não** o delay de áudio.
- `captureSourceOffsetsMs` do projeto `Test2ClaudeDelay` (`{"screen":1,"webcam":203,"recording":1,"systemAudio":616}`) confirma de novo que `recording` (mic) segue sempre igual a `screen` — ou seja, o fix de `-thread_queue_size` no mic (rodada anterior) não resolveu, porque **não ataca a causa raiz**: `-thread_queue_size` só evita bloqueio/overflow de uma fila já cheia de pacotes de áudio esperando o muxer; não corrige a diferença de tempo que cada pipeline leva para produzir seu PRIMEIRO frame/amostra real.
- Nova hipótese, agora mais bem fundamentada: no processo `main` (tela+mic juntos), o comando real ([logs/recordsaas-main.log:1532] da gravação analisada) mostra a tela passando por `gfxcapture` (filtro lavfi proprietário/custom, compilado no `ffmpeg.exe` bundled do projeto) → `-vf hwdownload,format=bgra` → `h264_nvenc`. Essa cadeia (captura GPU + download GPU→RAM + abertura de sessão NVENC) tem um warm-up real mensurável antes do primeiro frame de fato sair. O mic (dshow puro) começa a fluir amostras quase instantaneamente. Como os dois streams vêm do MESMO processo ffmpeg e o ffmpeg, por padrão, numera o PTS de cada stream a partir de 0 relativo ao primeiro pacote recebido (sem `-use_wallclock_as_timestamps`), o resultado é: a amostra de áudio em "posição X" do arquivo corresponde a um instante real mais cedo do que o frame de vídeo na "posição X" do arquivo de tela — ou seja, o áudio gravado "adianta" o vídeo internamente, o que na reprodução alinhada aparece como **áudio atrasado em relação ao vídeo** (exatamente o que o usuário está vendo: fala aparece no vídeo, som chega depois).
- Esse mecanismo é estrutural (latência de warm-up de pipeline de GPU vs. captura de áudio crua) e por isso é **estável entre gravações** — consistente com o usuário sempre medir a mesma faixa (~580ms) em testes diferentes, mesmo com `webcam`/`systemAudio` variando de gravação pra gravação (152→203, 674→616 nos dois JSONs comparados).
- Decisão de implementação: em vez de aplicar um offset fixo "chutado" (o que o próprio comentário já existente no código rejeita explicitamente — ver [recording-manager.ts:2193-2195](../../../electron/main/features/recording-manager.ts) — "instead of a fixed, guessed audio trim"), apliquei a MESMA solução arquitetural que já existe para webcam e system-audio: colocar o mic em processo FFmpeg próprio, para que ele tenha seu PRÓPRIO sinal de "pronto" medido de verdade a cada gravação, em vez de herdar o sinal do processo de tela.

## Implementacao Ou Alteracao

[electron/main/features/recording-manager.ts](../../../electron/main/features/recording-manager.ts):

1. **Linha 716**: `FfmpegProcessRole` ganhou o membro `'mic'` (antes: `'main' | 'webcam' | 'system-audio'`).
2. **Linha 784-789** (`FFMPEG_ROLE_PRIORITY_KEYS`): `mic` mapeado para a mesma chave de prioridade de `main` (não criei uma nova opção de prioridade na UI de configurações — reaproveita o que já existe, sem tocar em `RecordingProcessPriorityKey`/`PerformanceTab.tsx`).
3. **`buildWin32SplitWebcamFfmpegSpecs`** (~linha 2565-2600): antes montava `mainArgs = [...micInputArgs, ...screenInputArgs]` (mic+tela no mesmo processo, índice de tela deslocado por causa do mic). Agora:
   - `mainArgs` contém **só** a tela (índice `0:v` fixo, antes era `hasMic ? 1 : 0`).
   - Quando há mic, um novo spec `{ role: 'mic', args: micArgs }` é adicionado, com o mic como único input daquele processo (`0:a`), usando o mesmo `appendEncodedAudioOutputArgs` que já existia.
   - `webcamArgs` inalterado.
4. **`captureSourceOffsetsMs.recording`** (~linha 2206-2211, dentro de `markRecordingReady`): mudou de `offsetFromReady('main')` (sempre igual à tela) para `offsetFromReady('mic', 'main')` — agora usa o timestamp de "pronto" real do processo `mic`, com fallback para `main` nos caminhos que ainda não fazem esse split (ver "O que não foi feito" abaixo).

### Por que isso é seguro (verificado, não assumido)
- `expectedReadyCount`, o loop de spawn/stderr/erro/close, `stopFfmpegProcess`/`takeFfmpegProcesses`, e a aplicação de prioridade já são genéricos por `role` (iteram sobre arrays, sem contar "exatamente 2 processos" em nenhum lugar) — só um lugar tinha tratamento especial por role: `run.role === 'main'` na linha ~2293, usado para acompanhar `out_time_us=` do progresso do ffmpeg (Take Mode). Isso continua correto porque `-progress pipe:2` só é adicionado pelo `appendScreenOutputArgs`, que continua exclusivamente no processo `main` (agora só com tela, mas ainda é ele quem gera esse progresso).
- Nenhuma outra parte do código dependia da mic estar dentro do processo `main`.
- `tsc --noEmit -p tsconfig.node.json` sem erros após a mudança.

### O que não foi feito
- **Não** apliquei o mesmo split de mic para o caminho SEM webcam no Windows (`buildFfmpegArgs`, usado quando `shouldSplitWin32WebcamProcess` é falso) nem para macOS/Linux — esses caminhos continuam combinando mic+tela (e mic+webcam+tela) no mesmo processo, então mantêm o mesmo bug estrutural se o usuário gravar sem webcam no Windows, ou em outra plataforma. Não toquei nisso agora porque os testes do usuário até aqui sempre incluíram webcam (é o caminho realmente exercitado); ampliar o split para esses outros casos é factível (mesmo padrão) mas fica como próximo passo caso o teste confirme que a causa raiz é essa.
- Não removi o `-thread_queue_size 4096` do mic (rodada anterior) — não atrapalha, e ainda protege contra bloqueio de fila em cenários de contenção de I/O, mesmo que não seja mais a explicação principal do delay.

## Commits Relacionados Ao Card

Nenhum commit relacionado encontrado ate este ponto.
Motivo: alterações feitas na working tree, ainda não commitadas (usuário não pediu commit).

## Validacao

- Validacoes feitas: `tsc --noEmit -p tsconfig.node.json` sem erros; revisão manual de todos os usos de `run.role`/`spec.role` no arquivo para confirmar que nada mais dependia da mic estar dentro do processo `main`.
- Validacoes nao feitas: nenhuma gravação real com esta mudança. Não é possível validar em runtime neste ambiente (sem acesso a webcam/mic físicos); depende do próximo teste do usuário.
- Motivo das validacoes nao feitas: ambiente de execução do Codex/Claude não tem acesso à câmera/microfone reais nem roda o Electron app com hardware; a validação funcional é sempre feita pelo usuário.

## Riscos E Pendencias

- Se o log da próxima gravação mostrar `captureSourceOffsetsMs.recording` **diferente** de `screen` pela primeira vez (ex.: algo como `recording: 400-700`, não mais `1`), isso confirma que a medição está funcionando E que existe mesmo um skew real mic-vs-tela — o editor já usa esse campo automaticamente ([Preview.tsx](../../../src/components/editor/Preview.tsx)), então a sincronia deveria melhorar sem o usuário precisar mexer no slider manual.
- Se `recording` continuar igual a `screen` (ou muito próximo, tipo 1-5ms), a hipótese do warm-up do encoder de tela como causa não se sustenta e a causa está em outro lugar — precisaria olhar para o lado do editor/preview (como os arquivos são lidos/decodificados na prévia) ou para o próprio arquivo final exportado (não só a prévia do editor).
- Caso a sincronia melhore mas não feche 100%, o valor residual + a mudança de rodar mic isolado já elimina a maior parte do problema estrutural; qualquer resíduo pequeno passa a ser candidato a ajuste fino, não mais um bug estrutural escondido.
- Caminho sem webcam (Windows) e macOS/Linux continuam com o bug antigo — fora do escopo testado até agora.
- Logs apagados (`recordsaas-main.log`, `recordsaas-main.old.log`) antes de pedir o próximo teste, conforme pedido.

## Proximo Teste Esperado

- Gravar um novo vídeo com webcam + mic (mesmo fluxo dos testes anteriores).
- Depois do teste, mandar o caminho do projeto salvo novamente.
- Eu vou olhar, nessa ordem: (1) `captureSourceOffsetsMs.recording` no `.json` — se mudou de `~1ms` pra um valor mensurável e plausível; (2) linhas de log com `Ready signal from mic` e `Starting FFmpeg with args` do processo `mic` — confirmar que ele realmente roda separado; (3) pedir a percepção do usuário sobre a sincronia (se sumiu, melhorou, ou não mudou).
