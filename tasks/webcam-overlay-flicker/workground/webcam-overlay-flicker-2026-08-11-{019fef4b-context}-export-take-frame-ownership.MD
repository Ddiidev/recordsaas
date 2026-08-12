# Webcam overlay piscando - propriedade dos frames no export

Gerado em: 2026-08-11  
Sessao/contexto: 019fef4b  
Tipo de registro: retorno-qa

## Card

Arquivo do card: [WIP anterior](./webcam-overlay-flicker-2026-08-10-%7B019fec04-context%7D-qa-take-mode-companion.MD)  
Resumo:

- Corrigir a exportacao em Take Mode que alterna entre a tela sem webcam e a composicao com webcam.

## Pedido Do Usuario

Pedido literal:

> Eu exportei o video depois de levar 19 minutos para renderizar um video de 6 minutos... Quando ele exporta, ele exporta assim, piscando a tela.

Classificacao:

- Pedido explicito: corrigir o video exportado que pisca, sem depender de outra renderizacao longa para descobrir um resultado quebrado.
- Restricoes explicitas: o projeto de gravacao para reproduzir e validar e `C:\Users\andre\OneDrive\Documentos\RecordSaaS\CorrigindoTabuaDeMareAPIv2`.

## Interpretacao E Inferencias

- Inferencia operacional: o defeito esta no exportador de Take Mode, nao no arquivo de webcam nem no preview.
- Motivo: o [project.rsproj](C:/Users/andre/OneDrive/Documentos/RecordSaaS/CorrigindoTabuaDeMareAPIv2/project.rsproj) habilita Take Mode, usa takes `recording-screen`, webcam visivel e layout `side-by-side`; o [RendererPage.tsx](../../../src/pages/RendererPage.tsx) fecha frames que o provider ainda mantem como `lastFrame` ou `nextFrame`.
- Risco da inferencia: a renderizacao completa de seis minutos ainda precisa ser executada no Electron para validar visualmente todo o MP4 final.

## Implementacao Ou Alteracao

- O que foi feito: removido o fechamento por frame de `takeFrame` e `takeWebcamFrame` no compositor de Take Mode.
- O que foi feito: documentado no `VideoFrameProvider` que os frames retornados pertencem ao provider; tambem removido o fechamento indevido de frames de monitores flutuantes.
- Por que foi feito: o provider reutiliza os frames mais proximos como `lastFrame` e `nextFrame`. Fecha-los depois de desenhar deixava o proximo frame alternar para uma tela ou webcam fechada.
- Onde foi feito: [RendererPage.tsx](../../../src/pages/RendererPage.tsx).
- O que nao foi feito: nenhuma alteracao nos MP4s originais, no projeto salvo, na captura ou no codec.

## Commits Relacionados Ao Card

Repositorio: `E:\GitHub\recordsaas-solutions\recordsaas`

- Branch: `gitbutler/workspace`
- Base/destino: `gitbutler/workspace`
- Commits:
  - `73ab8a2` - `feat(recording): add take editing mode` - 2026-08-09 - introduziu o caminho de exportacao investigado.
  - Nenhum commit novo; correcao local ainda nao commitada.
- Push/PR: not pushed.

## Validacao

- Validacoes feitas:
  - Inspecao do projeto de gravacao e rastreamento do provider WebCodecs ate o compositor de Take Mode.
  - `npx tsc --noEmit --pretty false`: passou.
  - `npx eslint src/pages/RendererPage.tsx`: passou.
  - `npx prettier --check`: passou para o renderer e este WIP.
  - `git diff --check`: passou para os arquivos deste lote.
  - `npm run verify:export-startup`: passou.
  - `npm run verify:webcodecs-decode -- <MP4 exportado>`: passou; decodificou oito frames consecutivos e o video HTML oculto avancou 31 frames em aproximadamente 0,71 s.
  - SCC localizado em [RendererPage.tsx](../../../src/pages/RendererPage.tsx): snapshot atual com complexidade 344, ULOC 1070 e DRYness 0.73; classificacao Neutral, sem baseline comparavel porque o arquivo ja continha alteracoes locais de outra frente.
- Validacoes nao feitas: exportacao visual completa do projeto de seis minutos e reproducao do MP4 novo no player.
- Motivo das validacoes nao feitas: a exportacao completa leva aproximadamente 19 minutos; os checks acima confirmam a causa e o contrato de decodificacao, mas nao substituem QA visual do MP4 novo.

## Riscos E Pendencias

- A duracao de 19 minutos ainda exige uma analise de desempenho separada; este lote corrige primeiro a propriedade incorreta dos frames que quebra a imagem exportada.

## Proximo Teste Esperado

- Exportar o [project.rsproj](C:/Users/andre/OneDrive/Documentos/RecordSaaS/CorrigindoTabuaDeMareAPIv2/project.rsproj) em Take Mode e confirmar que a webcam permanece composta em frames consecutivos, inclusive nas mudancas de take.
