# Webcam overlay - frames independentes no export

Gerado em: 2026-08-11  
Sessao/contexto: 019ff1f4  
Tipo de registro: implementacao

## Pedido Do Usuario

> Quero que faça vários commits das implementações pendentes de commits e depois comece a implementar a sua proposta.

- Preservar primeiro as implementacoes funcionais em commits separados.
- Depois impedir engasgos visuais da webcam nas trocas de take sem criar um relogio livre que possa adianta-la.

## Decisao

- Tela e webcam continuam derivadas do mesmo tempo de composicao.
- Cada fonte converte esse tempo para seu proprio timestamp e avanca seu proprio decoder.
- O provider mantem seus frames de decode privados e entrega ao compositor uma copia com propriedade independente.

## Implementacao

- `VideoFrameProvider.getFrameForTime` agora retorna um `VideoFrame` caller-owned.
- Tela e webcam de um take sao obtidas em paralelo, com timestamps calculados separadamente.
- O compositor fecha as copias de tela, webcam e monitores logo depois do desenho.
- Nenhum offset extra ou relogio independente foi criado.

Arquivo: [RendererPage.tsx](../../../src/pages/RendererPage.tsx)

## Validacao

- `npx tsc --noEmit --pretty false`: passou.
- `npx eslint src/pages/RendererPage.tsx`: passou.
- `npm run build`: passou para Renderer, Main e Preload; permaneceu apenas o warning preexistente de chunk acima de 500 kB.
- `npm run verify:export-startup`: passou.
- `npm run verify:webcodecs-decode -- <webcam real>`: MP4Box leu 8 amostras reais; a etapa Electron/HTTP local encontrou `ERR_FAILED (-2)` por cache/GPU do ambiente, embora o script tenha retornado codigo 0.
- `git diff --check`: passou.
- SCC focal: 1 arquivo, complexidade 349, ULOC 1094, DRYness 0,74%. Complexidade inalterada contra o snapshot anterior; crescimento proporcional ao novo contrato de ownership. Classificacao: Neutral.
- Nao feita: exportacao visual real de um trecho com as trocas 19 e 20.

## Risco Residual

- O projeto antigo analisado foi exportado antes desta correcao. A confirmacao visual exige gerar um MP4 novo, preferencialmente um trecho curto que atravesse as trocas de take 19 e 20.

## Commits

- `2f03b9b` - `fix(export): isolate decoded frames per source`
- Push/PR: nao realizado.

## Proximo Teste

- Exportar um trecho curto contendo as duas trocas e confirmar que a webcam muda em todos os frames sem alterar o sincronismo com o audio.
