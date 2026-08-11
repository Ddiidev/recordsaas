# Webcam overlay piscando - correção de ressincronização

Gerado em: 2026-08-10  
Sessao/contexto: 019fec04  
Tipo de registro: implementacao

## Card

Arquivo do card: não informado; registro criado para o defeito reportado diretamente.  
Resumo: eliminar o pisca-pisca da webcam no layout `overlay` durante playback.

## Pedido Do Usuario

Pedido literal:
> No modo de gravação em que a webcam fica em overlay, ela fica piscando o overlay.

Classificacao:
- Pedido explicito: corrigir o overlay da webcam que pisca.
- Restricoes explicitas: preservar o comportamento atual.

## Interpretacao E Inferencias

- Inferencia operacional: o sintoma ocorre no preview/editor durante playback, no caminho de composição da webcam.
- Motivo: `Preview.tsx` forçava seeks frequentes no elemento oculto da webcam quando o drift passava de `0,12s`.
- Risco da inferencia: teste funcional em runtime com uma gravação real ainda é necessário.

## Implementacao Ou Alteracao

- O que foi feito: aumentada a tolerância de drift de playback para `0,5s`.
- O que foi feito: substituída a atribuição direta de `currentTime` por `queueMediaSeek`, evitando seeks sobrepostos e mantendo a fila existente.
- Por que foi feito: seeks agressivos podem deixar o frame da webcam vazio por instantes e causar o pisca-pisca do overlay.
- Onde foi feito: [Preview.tsx](../../src/components/editor/Preview.tsx)
- O que não foi feito: nenhuma alteração na captura FFmpeg, codec, layout persistido ou exportação.

## Commits Relacionados Ao Card

Repositorio: `E:\GitHub\recordsaas-solutions\recordsaas`
- Branch: `gitbutler/workspace`
- Base/destino: `gitbutler/workspace`
- Commits:
  - Nenhum commit novo; alteração local ainda não commitada.
  - `73ab8a2` - `feat(recording): add take editing mode` - 2026-08-09 - commit anterior relacionado ao fluxo de preview/gravação, já presente na base.
- Push/PR: not pushed

## Validacao

- Validações feitas: inspeção estática do loop de composição, `git diff --check`, `npx tsc --noEmit --pretty false` passou e SCC localizado em `src/components/editor/Preview.tsx`.
- Validações não feitas: reprodução manual com gravação real e teste de build/runtime Electron.
- Motivo: o sintoma depende de reprodução visual no runtime Electron.

## Riscos E Pendencias

- Se a gravação tiver offset fixo maior que `0,5s`, a tolerância pode manter o overlay estável sem corrigir esse offset durante playback; o sync de seek/pausa permanece ativo.
- Confirmar visualmente reprodução contínua em `overlay` e `side-by-side`.

## Proximo Teste Esperado

- Abrir uma gravação com webcam, selecionar `overlay`, reproduzir por pelo menos 30 segundos e verificar se o overlay não pisca.
- Executar `npx tsc --noEmit --pretty false` e validação SCC dos arquivos tocados.
