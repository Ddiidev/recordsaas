# export-performance - correção de qualidade do ganho alto

Gerado em: 2026-08-12
Sessao/contexto: 019ff678
Tipo de registro: implementacao

## Card

Arquivo do card: nao fornecido.
Resumo:

- Corrigir o áudio “estourado” percebido quando Microphone ou Computer Audio usa `+24 dB`.
- Trabalho derivado do retorno QA registrado em [audio-gain-functional-qa](export-performance-2026-08-12-{019ff678}-audio-gain-functional-qa.MD).

## Pedido Do Usuario

Pedido literal:

> Trabalhe em uma correção para isso.

Contexto QA já confirmado:

> Percebi que quando aumento para 24db o áudio fica meio estourado.
> e não tem nada haver com o meu fone aqui... porque o volume do pc ta em 50% só.
> O que acha que pode ser, meio que ele perde um pouco da qualidade de áudio...

Classificacao:

- Pedido explícito: implementar correção no RecordSaaS Desktop.
- Restrição: preservar o ganho real acima de 100%; não tratar reduzir o volume do Windows como solução.

## Interpretacao E Inferencias

- `+24 dB` equivale a `15,849x`; no Microphone medido, o pico bruto de `-9,3 dBFS` chega a aproximadamente `+14,7 dBFS` antes da contenção.
- A perda de qualidade vinha da combinação do compressor de razão `20:1`, hard clip de preview e limiter rápido no export. A saída do Windows em 50% acontece depois desse processamento.
- A correção deve reduzir achatamento/pumping e aliasing sem remover o boost solicitado; clipping residual deve continuar protegido antes da saída e do AAC.

## Implementacao Ou Alteracao

- Preview em [preview-audio.ts](../../../src/lib/preview-audio.ts):
  - compressor master com threshold `-12 dB`, knee `18 dB`, razão `8:1` e release `200 ms`;
  - substituição do hard clip por curva soft-clip acima de `-2,5 dB`, teto `-1,5 dB`;
  - `WaveShaper` com oversampling `4x`.
- Export em [export-manager.ts](../../../electron/main/features/export-manager.ts):
  - compressor FFmpeg paralelo (`mix=0.5`), knee `6`, razão `8:1` e release `250 ms` antes do limiter lookahead;
  - limiter preserva `5 dB` de headroom pré-AAC e usa ataque/release mais longos (`10/250 ms`);
  - material boosted recebe a compressão uma vez; o master mix usa somente o limiter lookahead para evitar dupla compressão.
- Invariantes atualizadas em [verify-export-startup.mjs](../../../scripts/verify-export-startup.mjs).
- Regra arquitetural atualizada em [AGENTS.MD](../../../AGENTS.MD).
- O que não foi alterado: curva de ganho `0..+24 dB`, payload IPC, captura WASAPI e volume físico do Windows.

## Commits Relacionados Ao Card

Repositorio: `E:\GitHub\recordsaas-solutions\recordsaas`

- Branch: `al-branch-1`
- Base/destino: nao determinado; branch sem upstream configurado.
- Commits:
  - `5614a0d` - `feat: extend audio volume and duplicate timeline regions` - `2026-08-11` - introduziu o controle até 150%.
  - `7e4ba02` - `docs: record export QA fixes` - `2026-08-11` - documentação do fluxo de exportação relacionada.
  - `d2e8610` - `feat(audio): add gain boost and soft peak protection` - implementação do compressor soft-knee e limiter lookahead.
- Push/PR: nenhum push executado nesta sessão.

## Validacao

- Passaram: `npx tsc --noEmit --pretty false`, ESLint focado com `--max-warnings 0`, `npm run verify:export-startup`, Prettier, `npm run build` e `git diff --check`.
- FFmpeg com os arquivos reais e a nova cadeia:
  - Microphone final AAC: `125%` = `mean=-24,4 dB`, `peak=-4,8 dBFS`; `150%` = `mean=-19,3 dB`, `peak=-2,3 dBFS`.
  - Computer Audio isolado após `+24 dB`: `mean=-47,3 dB`, `peak=-29,4 dBFS`; ganho permanece efetivo sem clipping.
  - Mix Microphone + Computer Audio em `150%`, com limiter somente no master: `mean=-19,3 dB`, `peak=-2,4 dBFS`; não houve silêncio.
- SCC no escopo alterado: 4 arquivos, complexidade `145`, ULOC `1798`, DRYness `0,68`; sem baseline equivalente no mesmo recorte.
- Não validado: audição manual dentro da janela completa do editor e reprodução em dispositivo físico; os números acima não substituem essa QA.

## Riscos E Pendencias

- Compressão continua necessária quando a fonte já está próxima de `0 dBFS`; `+24 dB` não pode ser ganho linear sem ultrapassar o teto digital.
- AAC pode criar picos intersample depois do limiter; o headroom pré-encode permanece intencional.
- Computer Audio bruto ainda é muito baixo e precisa de diagnóstico de captura separado se continuar sem conteúdo.

## Proximo Teste Esperado

- Comparar no mesmo trecho 100%, 125% e 150% no preview e no export.
- Confirmar que `+24 dB` fica mais alto sem o estalo/achatamento percebido na implementação anterior.
