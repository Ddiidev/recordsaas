# export-performance - QA comparacao da exportacao de 9 min

Gerado em: 2026-08-11
Sessao/contexto: 019ff367
Tipo de registro: retorno-qa

## Card

Arquivo do card: nao fornecido.
Resumo:
- Comparar a exportacao anterior de 18 min com a nova exportacao apos reuso de providers/canvas.
- Registro anterior: [reuso de take providers](export-performance-2026-08-11-{019ff367}-reuso-take-providers.MD).

## Pedido Do Usuario

Pedido literal:
> agora sim ficou absurdo!! de 18min caiu para 9min de renderizacao!
>
> comparar com o antigo.

Classificacao:
- Pedido explicito: comparar qualidade/resultado do video novo com o antigo.
- Restricoes explicitas: usuario fara revisao visual final antes de decidir continuidade.

## Interpretacao E Inferencias

- Inferencia operacional: SSIM/PSNR e hashes de streams fornecem comparacao tecnica, mas nao substituem revisao humana dos cortes.
- Motivo: poucos frames nos limites de take possuem divergencia visual maior, embora o resultado agregado seja praticamente identico.
- Risco da inferencia: a revisao visual precisa conferir especificamente 147,92-148,07 s, 149,62-149,68 s e 294,07-294,22 s.

## Implementacao Ou Alteracao

- O que foi feito: nenhuma nova alteracao; analise completa dos dois MP4s e do log do experimento.
- Por que foi feito: validar que o ganho nao degradou a entrega.
- Onde foi feito: [video antigo](C:/Users/andre/OneDrive/Documentos/RecordSaaS/CorrigindoTabuaDeMareAPIv2/RecordSaaS-2026-08-12-01-10-08.mp4), [video novo](C:/Users/andre/OneDrive/Documentos/RecordSaaS/CorrigindoTabuaDeMareAPIv2/RecordSaaS-2026-08-12-02-05-29.mp4), [export-performance.jsonl](C:/Users/andre/AppData/Roaming/recordsaas/logs/export-experiment/export-performance.jsonl).
- O que nao foi feito: nenhuma mudanca adicional em codigo, codec, FPS, bitrate ou audio.

## Commits Relacionados Ao Card

Repositorio: `E:\GitHub\recordsaas-solutions\recordsaas`
- Branch: `al-branch-1`
- Base/destino: nao determinado.
- Commits:
  - `b64d5b2` - `chore: checkpoint pending RecordSaaS work` - base da instrumentacao.
  - `6aedef6` - `fix(export): isolate decoded frames per source` - contexto do ownership de frames.
  - `2ea1924` - `perf: reuse take decoders during export` - otimizacao comparada nesta QA.
- Push/PR: nao realizado.

## Validacao

- Novo: 566,881 s (9:26,881); anterior: 1.107,566 s (18:27,566). Reducao total: 48,8%; renderer: 1.016,731 s -> 475,240 s (53,3%).
- Novo: `created=2`, `reused=46592`, `resetForBackwardSeek=0`, `active=2`, `canvasCreated=1`.
- Ambos: 6:28,28, 1920x1080, 60 fps, H.264 Constrained Baseline, AAC 48 kHz.
- Audio: hash de pacotes AAC identico (`a14c11a0f27f74564f9e2f36387c6772`).
- Video: SSIM `0,998104`; PSNR medio `38,627 dB`; 23.023/23.297 frames acima de 40 dB; 93 frames abaixo de 20 dB, concentrados nos limites de takes indicados.
- Validacoes nao feitas: revisao visual humana integral, em especial nos limites indicados.
- Motivo das validacoes nao feitas: criterio perceptivo/conteudo pertence ao usuario.

## Riscos E Pendencias

- Pacotes de video nao sao byte-identicos (esperado para WebCodecs); diferenca agregada muito baixa.
- Confirmar visualmente os tres intervalos antes de consolidar a otimizacao.

## Proximo Teste Esperado

- Revisar os intervalos `147,92-148,07 s`, `149,62-149,68 s` e `294,07-294,22 s` no video novo; se corretos, considerar a otimizacao aprovada.
