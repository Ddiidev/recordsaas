# screen-webcam-parity - diagnostico de clone no Slide visivel

Gerado em: 2026-08-13
Sessao/contexto: 019ffdd7
Tipo de registro: retorno-qa / diagnostico

## Card

Arquivo do card: nao fornecido.
Registro anterior: [swap-origin-hidden-transitions.MD](screen-webcam-parity-2026-08-13-{019ffdd7}-swap-origin-hidden-transitions.MD).

## Pedido Do Usuario

Pedido literal:

> Veja o antes e o depois para provar que realmente existe uma sombra muito grossa ao redor da tela principal.

> Existe uma tela por tras. Ela nao move de lugar, e como se criasse um clone.

Classificacao:

- Pedido explicito: confirmar visualmente a existencia do clone e identificar a causa antes de corrigir.
- Escopo: `Swap (Slide)` normal, com Origin e Target visiveis.

## Evidencia E Diagnostico

- Antes do Slide: ha uma unica Tela principal no slot grande da esquerda.
- Durante o Slide: o print em `03:44.97` mostra a Tela principal estatica no slot original e uma segunda instancia da mesma tela em movimento sobre ela.
- Depois do Slide: a instancia extra desaparece e a Tela principal permanece somente no slot final.
- Causa confirmada em [renderer.ts](../../../src/lib/renderer.ts): o caminho de `slide` e `scale` acrescenta dois draws animados sem remover os draws-base de Origin e Target.
- Cada draw chama `drawMediaToConfig`, que tambem desenha `shadowBlur` e `borderWidth`; por isso as duas instancias acumulam sombra e borda enquanto se sobrepoem, produzindo o contorno escuro/espesso.
- O defeito nao pertence ao caminho `target-only` de Origin oculto. As capturas demonstram o Swap normal com ambos os participantes visiveis.

## Implementacao Ou Alteracao

- Nenhuma alteracao de codigo neste diagnostico.
- Correcao proposta, pendente de autorizacao: durante `slide` e `scale` visiveis, remover os draws-base dos dois participantes e desenhar somente os dois frames interpolados. No inicio eles coincidem com os slots originais; no fim, com os slots trocados.
- `fade` deve permanecer no fluxo proprio, pois a sobreposicao com alpha e intencional nesse efeito.

## Validacao

- Inspecao visual dos tres prints fornecidos pelo usuario.
- Inspecao estatica da ordem de desenho e de `drawMediaToConfig` em [renderer.ts](../../../src/lib/renderer.ts).
- Nao houve teste de Electron, exportacao ou alteracao de codigo nesta etapa.

## Proximo Teste Esperado

- Depois da correcao, revisar o mesmo ponto `03:44.97` no Editor Electron: deve existir apenas uma instancia da Tela principal em cada instante do Slide/Scale, sem sombra ou borda duplicada.
