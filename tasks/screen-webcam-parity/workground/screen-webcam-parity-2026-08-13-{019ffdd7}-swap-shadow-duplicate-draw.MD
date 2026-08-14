# screen-webcam-parity - sombra duplicada no Swap visivel

Gerado em: 2026-08-13
Sessao/contexto: 019ffdd7
Tipo de registro: retorno-qa

## Card

Arquivo do card: nao fornecido.
Registro anterior: [diagnostico de clone no Slide visivel](screen-webcam-parity-2026-08-13-{019ffdd7}-swap-visible-slide-clone-diagnosis.MD).

Resumo:

- Remover a sombra excessiva da moldura pequena enquanto o Swap visivel esta plenamente ativo.

## Pedido Do Usuario

Pedido literal:

> Mas agora continua o problema de sombra forte atras, veja na tela a direita onde tem meu rosto, a moldura ta com uma sombra bem maior do que e quando nao se esta no tempo de swap.

Classificacao:

- Pedido explicito: corrigir a sombra maior na moldura pequena durante o periodo do Swap.
- Restricao explicita: preservar o comportamento que ja passou no retorno anterior.

## Interpretacao E Inferencias

- Inferencia operacional: o print foi capturado no estado consolidado do Swap, depois da animacao de entrada e antes da animacao de saida.
- Motivo: nesse estado, `swapProgress >= 0.999` e o renderer desenhava os participantes-base e os dois destinos trocados nas mesmas geometrias.
- Causa confirmada: cada chamada de `drawMediaToConfig` aplica sombra e borda; duas chamadas coincidentes duplicavam a sombra da moldura direita.
- Risco da inferencia: a captura nao inclui a timeline, portanto o ponto exato da regiao nao foi lido visualmente; a composicao exibida e a condicao do renderer correspondem ao estado consolidado.

## Implementacao Ou Alteracao

- O que foi feito: `removeParticipantDraws` foi movido para o escopo compartilhado do Swap em [renderer.ts](../../../src/lib/renderer.ts).
- O que foi feito: no Swap visivel com `transition === 'none'` ou `swapProgress >= 0.999`, os draws-base de Origin e Target sao removidos antes dos dois destinos trocados serem adicionados.
- Por que foi feito: garante uma unica chamada de desenho, sombra e borda por slot no estado consolidado.
- O que nao foi feito: nao foram alterados os valores configurados de sombra, borda, padding ou radius; a animacao de `fade` durante entrada/saida nao foi reestruturada.
- Direcao visual: reparo local; identidade visual e controles existentes nao foram reclassificados nem alterados.

## Commits Relacionados Ao Card

Repositorio: `E:\GitHub\recordsaas-solutions\recordsaas`

- Branch: `main`
- Base/destino: `origin/main`
- Commits:
  - `21355cd` - `feat(editor): add one-sided swap transitions` - 2026-08-13 - funcionalidade de visibilidade do Origin, transicoes e correcao da sombra duplicada.
- Push/PR: nao enviado.

## Validacao

- Validacoes feitas:
  - Inspecao do print fornecido e da ordem de desenho no [renderer.ts](../../../src/lib/renderer.ts).
  - Revisao independente confirmou o mesmo draw duplicado e a mesma correcao minima.
  - `node --test .\src\lib\swap.test.ts` - 4 testes aprovados.
  - `npx tsc --noEmit --pretty false`.
  - ESLint focado em renderer e helpers/testes de Swap.
  - Prettier focado nos mesmos arquivos.
  - `npm run build` - concluido; somente o aviso existente de chunk maior que 500 kB.
  - `git diff --check` - sem erros; somente avisos de conversao LF/CRLF.
  - SCC no mesmo escopo antes/depois: complexidade `332`, ULOC `1177` e DRYness `0.68%` inalterados. Classificacao `Neutral`.
- Validacoes nao feitas: comparacao visual depois da correcao no frame real do Editor Electron e exportacao de video.
- Motivo das validacoes nao feitas: a captura segura da janela aberta retornou outra superficie em primeiro plano; o editor nao foi ativado para nao interromper a sessao do usuario.

## Riscos E Pendencias

- Confirmar no mesmo ponto do video que a moldura direita tem a mesma intensidade de sombra dentro e fora do trecho de Swap.
- Confirmar um trecho exportado, pois Preview e exportacao compartilham o renderer, mas o resultado final ainda nao foi observado.

## Proximo Teste Esperado

- Manter o playhead no meio da regiao do Swap, fora da duracao de entrada/saida, e comparar a moldura direita com um frame imediatamente antes da regiao.
