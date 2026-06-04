# Status de Plataformas

Documento de apoio para continuar a evolução por sistema operacional.

Escopo:
- O que já foi implementado e está funcionando hoje no Windows.
- O que ainda não tem paridade no macOS e no Linux.
- O que precisa de ajuda ou decisão técnica para fechar depois.

## O que já funciona no Windows

### Export de projetos grandes
- Export passou a ler MP4 em blocos, usando `fs:statFile` e `fs:readFileChunk` em vez de carregar o arquivo inteiro em memória.
- O fluxo de export usa `MP4Box` e `WebCodecs` de forma incremental, o que permite exportar arquivos maiores que 2 GiB.
- O pump respeita o próximo offset retornado por `MP4Box.appendBuffer` e chama `MP4Box.seek(0, true)` após `onReady`, o que corrige casos em que o `moov` fica no fim do arquivo.

### Export adaptativo
- O export adaptativo usa a largura, altura e FPS efetivos do vídeo de origem.
- Quando o FFmpeg reporta FPS médio implausivelmente baixo, mas o stream informa um `tbr` nominal saudável, o export usa o valor nominal em vez de propagar `3-4fps`.
- O FPS de export continua limitado ao que o produto suporta hoje, com teto de 60fps.

### Gravação de tela e webcam
- A gravação de tela agora força saída CFR com `-r <fps>` e `-fps_mode cfr`, evitando arquivos de tela “magros” com FPS efetivo baixo.
- A webcam deixou de herdar o encoder pesado da tela e passou a usar `libx264` com `crf`, `maxrate` e `bufsize` controlados.
- O objetivo dessa mudança foi parar de gerar webcam com múltiplos GB em gravações longas.

### Analyzer de capacidade
- O analyzer de 60fps passou a rodar um probe de 5 segundos.
- No Windows, ele tenta primeiro `ddagrab` via Desktop Duplication API e cai para `gdigrab` só se necessário.
- A UI do analyzer mostra contagem regressiva dentro do botão e spinner durante a medição.

### Diagnóstico e validação
- Existem verificadores para o reader chunked do export e para o decode via WebCodecs.
- O `AGENTS.MD` foi atualizado com as regras novas de export, gravação e analyzer.

## O que ainda não tem paridade fora do Windows

### macOS
- A gravação usa `avfoundation`, mas o analyzer ainda não tem uma prova equivalente ao `ddagrab` do Windows.
- Quando o backend específico não está disponível, o analyzer cai em heurística de CPU em vez de medir captura real.
- Não existe ainda uma validação específica para dizer, com confiança, se aquele Mac sustenta 60fps ou 120fps no caminho real de captura.
- O caminho de gravação e o caminho de export existem, mas a parte de medição de capacidade ainda precisa de trabalho para ficar confiável no mesmo nível do Windows.

### Linux
- O analyzer continua baseado em `x11grab`.
- Não há equivalente de Desktop Duplication para unificar o mesmo tipo de medição que foi adotado no Windows.
- É preciso validar melhor o comportamento em cenários reais de X11 e, se for o caso, Wayland.
- Webcam, áudio e captura de tela precisam de verificação de campo para garantir que a nova política de FPS/bitrate não degradou a experiência.

## O que precisa de ajuda ou decisão técnica

- Definir o equivalente de `ddagrab` para o macOS, se existir um caminho realista com `avfoundation` que permita probe confiável.
- Decidir se export em 120fps deve virar produto suportado de ponta a ponta ou apenas perfil de gravação.
- Se 120fps for requisito real, ajustar autorização, UI e tier de export para não ficar limitado a 60fps.
- Fazer uma matriz de teste por sistema operacional:
  - gravação curta
  - gravação longa
  - export adaptativo
  - export com webcam
  - análise de 60fps

## Próximos passos sugeridos

1. Implementar um probe real de capacidade no macOS.
2. Validar o caminho Linux com gravação longa e export adaptativo.
3. Decidir o contrato de 120fps no export.
4. Repassar a matriz de testes para cada plataforma antes de considerar a parte “fechada”.
