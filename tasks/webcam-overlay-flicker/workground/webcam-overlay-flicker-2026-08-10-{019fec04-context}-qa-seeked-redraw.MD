# Webcam overlay - retorno QA: frame inicial após seek

Gerado em: 2026-08-10  
Sessao/contexto: 019fec04  
Tipo de registro: retorno-qa

## Card

Arquivo do card: [retorno QA anterior](./webcam-overlay-flicker-2026-08-10-%7B019fec04-context%7D-qa-webcam-travada.MD)  
Resumo: garantir que a webcam desenhe o frame confirmado depois de seek no player.

## Pedido Do Usuario

Pedido literal:
> Continua sem reproduzir ele fica com uma imagem incial estática, já arrastei a agulha pra frente e pra tras, mas continua o mesmo frame.

Classificacao:
- Pedido explícito: webcam deve atualizar durante playback e após mover a agulha.
- Restrição explícita: usar o projeto real em `C:\Users\andre\OneDrive\Documentos\RecordSaaS\CorrigindoTabuaMareAPI` como artefato de diagnóstico.

## Interpretacao E Inferencias

- O vídeo da webcam não está corrompido: FFmpeg decodificou início e posições profundas; o teste Electron/WebCodecs decodificou amostras e confirmou que um vídeo oculto avança de `0` para aproximadamente `0,75s`.
- A webcam usava `currentTime` após scrub, porém não havia `onSeeked` para redesenhar o canvas depois que o browser disponibilizava o novo frame. Monitores flutuantes já possuem esse callback.

## Implementacao Ou Alteracao

- Adicionado `onSeeked={renderCanvas}` ao elemento de webcam em [Preview.tsx](../../src/components/editor/Preview.tsx).
- Mantido redraw contínuo quando a webcam ativa precisa compor a cena, sem depender só dos frames da tela.
- Mantida sincronização em play, seek e metadados; removida a ressincronização agressiva por frame.
- Não alterado: arquivos de projeto, MP4s, captura, FFmpeg e exportação.

## Commits Relacionados Ao Card

Repositorio: `E:\GitHub\recordsaas-solutions\recordsaas`
- Branch: `gitbutler/workspace`
- Commits: nenhum commit novo; alterações locais ainda não commitadas.
- Push/PR: not pushed.

## Validacao

- `git diff --check`: passou.
- `npx tsc --noEmit --pretty false`: passou.
- SCC localizado em `src/components/editor/Preview.tsx`: complexidade `319`, ULOC `1252`, sem crescimento estrutural relevante.
- `npm run verify:webcodecs-decode -- <webcam.mp4>`: passou; 8 frames WebCodecs decodificados e vídeo HTML oculto avançou de `0` para `0,754119s`.
- RecordSaaS em desenvolvimento: iniciado a partir de `E:\GitHub\recordsaas-solutions\recordsaas\run.bat`; processos Electron da instância nova foram observados. Interação visual no Editor continua a cargo da janela do app.
- Validação visual no Editor: pendente; requer abrir [project.rsproj](C:/Users/andre/OneDrive/Documentos/RecordSaaS/CorrigindoTabuaMareAPI/project.rsproj) no app atualizado.

## Riscos E Pendencias

- O projeto salvo usa `side-by-side`; o mesmo compositor atende `overlay`, mas ambos devem ser verificados no Electron.

## Proximo Teste Esperado

- Abrir o projeto, mover a agulha para `5:00` e confirmar que o frame da webcam muda quando o evento `seeked` chegar.
- Reproduzir por 30 segundos e confirmar animação contínua da webcam.
