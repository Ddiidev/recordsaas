# playback-seek - Diagnostico de playback e timeline lentos

Gerado em: 2026-08-06
Sessao/contexto: 019fd7b6-context
Tipo de registro: contexto

## Card

Arquivo do card: nao fornecido.
Resumo:
- Diagnosticar editor reproduzindo frame a frame e demorando para iniciar no projeto `ReportandoBugV`.

## Pedido Do Usuario

Pedido literal:
> Durante a edicao, a reproducao do video e o movimento da agulha na timeline estao extremamente lentos, travados e demorando a comecar.

Classificacao:
- Pedido explicito: investigar projeto real informado pelo usuario.
- Restricoes explicitas: nenhuma alteracao ou reparo solicitado nesta etapa.

## Interpretacao E Inferencias

- Inferencia operacional: diagnostico somente, artefatos em modo leitura.
- Motivo: pedido descreveu defeito e forneceu caminho, sem pedir implementacao.
- Risco da inferencia: correcao e recuperacao do projeto permanecem pendentes.

## Implementacao Ou Alteracao

- O que foi feito: inspecao de estrutura, metadados, timestamps, frames, keyframes, decode e seek; auditoria estatica do hot path do editor e dos argumentos de gravacao.
- Por que foi feito: separar arquivo defeituoso, custo de decoder e regressao no renderer.
- Onde foi feito: [projeto afetado](C:/Users/andre/OneDrive/Documentos/RecordSaaS/ReportandoBugV), [screen-encoder.ts](../../../electron/main/features/screen-encoder.ts), [recording-manager.ts](../../../electron/main/features/recording-manager.ts), [Preview.tsx](../../../src/components/editor/Preview.tsx), [Timeline.tsx](../../../src/components/editor/Timeline.tsx).
- O que nao foi feito: nenhuma alteracao de codigo, midia ou `.rsproj`; nenhum commit, push ou PR.

## Causa Confirmada

- Tela: H.264 NVENC, 1920x1080, CFR 60fps, 588,366667 s, 35.302 frames, timestamps monotonicamente corretos.
- Defeito: somente um keyframe/IDR, em `t=0`, no video inteiro.
- Evidencia direta: seek em 563 s levou 81,942 s; webcam no mesmo ponto levou 0,193 s.
- Codigo: configuracao NVENC e montagem do output nao passam `-g` nem outro limite explicito de GOP.
- Efeito: seek da timeline perto do fim precisa decodificar a tela desde o inicio; Play apos scrub demora e pode aparentar reproducao frame a frame.
- MP4 finalizado e decodificavel; `moov` existe. Nao e corrupcao de finalizacao.

## Achados Secundarios

- Webcam: 1280x720, ~30fps, GOP ~8,33 s; seek funcional, mas intervalo ainda longo para edicao.
- Audio de microfone: decodifica limpo; ~0,83 s menor que a tela.
- Audio do computador: ultimo pacote ADTS corrompido e ~7,03 s menor que a tela; track mutada no projeto, portanto nao explica o travamento principal.
- Projeto: 19.465 eventos, 48 regioes de zoom, `timelineZoom=8`; custo secundario, sem explicar a curva linear do seek.
- Perfil customizado pediu 60fps embora a analise salva recomende 30fps; arquivo de tela ainda ficou CFR 60 exato.
- Mudancas locais nao commitadas de timeline tratam zoom e handles; nao alteram decoder, playback ou canvas.

## Commits Relacionados Ao Card

Repositorio: `E:\GitHub\recordsaas-solutions\recordsaas`
- Branch: `main`
- Base/destino: `main`
- Commits:
  - `6d6c080` - `fix: stabilize adaptive screen and system audio recording` - 2026-06-19 - introduziu a definicao NVENC atual sem GOP explicito.
- Push/PR: nenhum; somente analise.

## Validacao

- Validacoes feitas: probe FFmpeg; contagem de 35.302 frames; verificacao de PTS/duracao; decode integral; enumeracao de keyframes; benchmark de seek; auditoria de `Preview.tsx`, `Timeline.tsx`, protocolo `media://`, `screen-encoder.ts` e `recording-manager.ts`.
- Validacoes nao feitas: reproducao interativa no Electron; app estava fechado ao fim da coleta. Nenhum build executado.
- Motivo das validacoes nao feitas: causa de seek confirmada diretamente no artefato; etapa autorizada era diagnostico.

## Riscos E Pendencias

- Gravacoes novas continuam vulneraveis enquanto output nao tiver GOP limitado.
- Projeto atual continua lento; remux nao resolve. Reparacao exige reencode da tela preservando o original e referencias do projeto.
- Fix minimo candidato: GOP maximo de dois segundos para tela; aplicar tambem a webcam apos resolver FPS efetivo. Validar NVENC, Generic e perfis 30/60/120fps.
- Revalidar audio do computador separadamente; defeito secundario real.

## Proximo Teste Esperado

- Corrigir GOP; gravar 2-3 minutos; confirmar intervalo maximo entre keyframes <=2,1 s; testar scrub perto do fim com inicio de playback em menos de 0,5-1 s.
- Gerar copia reencodada do video de tela atual, sem sobrescrever original, e comparar seek/editor antes de trocar a referencia do projeto.
