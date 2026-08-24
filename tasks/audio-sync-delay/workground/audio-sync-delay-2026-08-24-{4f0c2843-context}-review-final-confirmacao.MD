# audio-sync-delay - Review final: confirmação medida da correção

Gerado em: 2026-08-24
Sessao/contexto: 4f0c2843
Tipo de registro: contexto

Documento anterior: [audio-sync-delay-2026-08-24-{4f0c2843-context}-causa-raiz-medida-offsets-reais.MD](audio-sync-delay-2026-08-24-%7B4f0c2843-context%7D-causa-raiz-medida-offsets-reais.MD)

## Card

Arquivo do card: nenhum card formal. Encerramento da investigação de delay de áudio no gravador.

## Pedido Do Usuario

Pedido literal:
> Parece que agora funcionou, eu vi bem sincrono, o que você fez? faça uma última review!
> C:\Users\andre\OneDrive\Documentos\RecordSaaS\Test4ClaudeDelay

Classificacao:
- Pedido explicito: explicar o que foi feito e fazer uma review final das mudanças.

## Confirmacao Medida (Test4)

Primeira gravação produzida já com os offsets medidos.

Durações reais: `screen 11.48s`, `webcam 10.83s`, `mic 11.24s`. Pedidos de parada: `23.413`, `23.416`, `23.418`.
Instantes reais de início derivados: `screen 11.933`, `webcam 12.586`, `mic 12.178`.

O novo código registrou os dois conjuntos lado a lado no log ([logs/recordsaas-main.log](../../../logs/recordsaas-main.log), linha 955):

```
[SYNC] Measured capture offsets(ms)={"screen":650,"webcam":0,"recording":410,"systemAudio":607}
                       (provisional={"screen":772,"webcam":143,"recording":1,"systemAudio":729})
```

| | atraso do áudio vs webcam | vs tela | dispersão total |
|---|---|---|---|
| método antigo (o que teria sido gravado) | **550ms** | 526ms | 550ms |
| método novo (o que foi gravado) | **-2ms** | -5ms | **5ms** |

Os 550ms do método antigo batem com a estimativa original do usuário (~580ms, obtida empiricamente pelo slider do editor) — o que fecha o diagnóstico de ponta a ponta.

Conferência independente: os valores que o app gravou (`650/0/410`) batem com o que as durações implicam (`653/0/408`) dentro de 2-3ms.

## Review Das Mudancas

Revisão feita sobre o diff completo em [recording-manager.ts](../../../electron/main/features/recording-manager.ts), [state.ts](../../../electron/main/state.ts) e [RecorderPage.tsx](../../../src/pages/RecorderPage.tsx).

### Verificado como correto

1. **Direção do shift dos take boundaries**: boundaries são marcados ao vivo como `pts − offsetProvisórioDaTela`; o correto é `pts − offsetMedidoDaTela`. O código soma `(provisório − medido)`, que é a diferença exata. Conferido com os números do Test4: `(772−650)/1000 = +0.122s`. Correto.
2. **Eventos de mouse**: já usavam `captureOriginMonotonicMs`, que agora resolve para a origem medida — re-ancoragem automática, sem código extra.
3. **Gravação sem microfone**: `audioPath` indefinido, `recording` cai no fallback relativo e herda o offset da tela. Sem arquivo de áudio para alinhar, é inócuo.
4. **Gravação sem webcam**: mesma lógica, inócuo.
5. **Clamp do editor**: `parseCaptureSourceOffsetsMs` limita a ±10000ms ([projectSlice.ts:110](../../../src/store/slices/projectSlice.ts)); os valores gravados (0-650ms) estão bem dentro.
6. **Risco de correção dupla**: o `recordingSyncOffsetMs` manual (que o usuário usou para testar os 580ms) é lido do arquivo de projeto e não é escrito pelo gravador, nem persiste em perfil de gravação — novas gravações começam em `0`. Sem sobreposição com a correção automática.
7. **`probeMediaDurationSeconds` ignora o exit code**: intencional. `ffmpeg -i arquivo` sem saída termina com código 1, mas imprime a duração no stderr, que é o que se lê.
8. **Ordem de execução**: a medição roda em `cleanupAndSave`, depois que todos os processos encerraram e antes de `processAndSaveMetadata`. Arquivos já finalizados. `cleanupAndDiscard` não mede, e não precisa: descarta tudo.

### Descoberta durante a review: o split do mic deixou de ser requisito

A medição olha para os **arquivos**, não para os processos. Então o offset do mic é recuperado corretamente mesmo quando o mic compartilha processo com a tela — o que cobre gravação sem webcam no Windows e macOS/Linux, que eu tinha deixado registrados como pendência. Confirmado retroativamente: no Test1/Test2 (mic junto da tela) o arquivo de áudio saiu 1.22s mais longo que o da tela, e a medição por duração teria capturado exatamente esse desvio. A tarefa separada que eu tinha aberto para replicar o split nesses caminhos foi retirada por ficar obsoleta. O split continua útil (reduz o pré-roll descartado: no Test3 o desvio caiu de 1220ms para 80ms), mas não é mais questão de correção.

### Residuais conhecidos (nenhum bloqueante)

1. **~5ms de resíduo**: o instante de parada é capturado uma vez só, mas os processos recebem o stop ao longo de ~5ms. Está muito abaixo do limiar perceptível de sincronismo A/V (~20-40ms) e é o que sobrou no Test4. Registrar o instante por processo eliminaria, mas não compensa a complexidade.
2. **`sourceDuration` subestima o fim em ~0.3s**: usa `takeLastPtsSeconds` (progresso reportado pela tela), que fica atrás da duração final por causa do flush de buffer. É comportamento pré-existente, e erra para o lado seguro (linha do tempo mais curta que o conteúdo disponível, nunca o contrário). Minha mudança já melhorou um pouco esse valor, mas não o tornei exato para não mexer em algo que passou a funcionar.
3. **Áudio do sistema com duração inflada** (Test4: `27.13s` para ~10.8s de gravação): bug separado, provavelmente formato/canais entre o helper C# e o `-f f32le -ar 48000 -ac 2` do FFmpeg. O offset dele mantém a distância para a tela que já tinha, então não regrediu. Nos testes o conteúdo era quase silêncio (4 kb/s), por isso nunca apareceu como sintoma.

## Commits Relacionados Ao Card

Nenhum commit relacionado encontrado ate este ponto.
Motivo: alterações permanecem na working tree; o usuário não pediu commit.

Arquivos alterados nesta investigação:
- [electron/main/features/recording-manager.ts](../../../electron/main/features/recording-manager.ts)
- [electron/main/state.ts](../../../electron/main/state.ts)
- [src/pages/RecorderPage.tsx](../../../src/pages/RecorderPage.tsx)

## Validacao

- Validacoes feitas: `tsc --noEmit` limpo no renderer e no processo main; conferência numérica dos offsets gravados no Test4 contra a verdade derivada das durações (batem em 2-3ms); verificação da dispersão resultante (5ms, contra 550ms do método antigo); revisão dos consumidores no editor (clamp, offset manual, ausência de correção dupla); revisão dos caminhos sem mic e sem webcam.
- Validacoes nao feitas: nenhum teste automatizado foi adicionado; a validação funcional continua sendo a percepção do usuário mais a conferência dos números do log/JSON.
- Motivo: não há suíte de testes cobrindo o pipeline de gravação, e o comportamento depende de hardware real de captura.

## Riscos E Pendencias

- Os três residuais listados acima.
- Nada commitado ainda.

## Proximo Teste Esperado

- Nenhum teste pendente para o delay de áudio: confirmado por percepção do usuário e por medição.
- Se algum dia a sincronia voltar a parecer errada, o primeiro lugar a olhar é a linha `[SYNC] Measured capture offsets(ms)=... (provisional=...)` do log, que mostra o medido e o antigo lado a lado, mais `[SYNC] Measured capture durations(s)=...`.
