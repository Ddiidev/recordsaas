# export-performance - ganho funcional acima de 100%

Gerado em: 2026-08-12
Sessao/contexto: 019ff678
Tipo de registro: retorno-qa

## Card

Arquivo do card: nao fornecido.
Resumo:

- Fazer Microphone e Computer Audio aumentarem efetivamente os decibeis acima de 100%.
- Registro anterior: [retorno QA da amplificacao de audio](export-performance-2026-08-12-{019ff367}-audio-amplification-qa-return.MD).

## Pedido Do Usuario

Pedido literal:

> Hoje o volume do microfone, o computer use, ele só aumenta até 100%. Na verdade, quando ele passa de 100%, ele fica em silêncio.
>
> A minha última tentativa de corrigir isso parou o silêncio, porém, mesmo que aumente acima disso, ele não aumenta os decibéis do áudio do microfone ou do computador que seja.
>
> Eu preciso que isso funcione, na verdade. Eu preciso do volume acima de 100% quando necessário; eu preciso aumentar os decibéis porque, às vezes, o áudio que eu gravo no meu microfone fica muito baixo, então, quando eu precisar, eu gostaria de que ele ficasse mais alto.

Esclarecimentos posteriores:

> Do que você ta falando o que tem haver com o VLC? Estou falando do RecordSaaS Desktop.
> E sobre o mute, eu não mutei o pc durante o teste.
> Eu uso a áudio padrão do pc "Alto-falantes (2- Realtek(R) Audio)" e microfone é um que se chama "Grupo de microfones 2- Tecnologia Intel@ Smart Sound para microfones digitais"

> é fui eu que descartei no gitbutler, eu descartei pois não funciona mesmo assim.
> ele não aumentava realmente o volumen.
> Preciso que melhore esse sistema, pois não funciona hoje ainda mesmo com essas modificações ai que você ta restaurando.

Retorno QA posterior:

> Percebi que quando aumento para 24db o áudio fica meio estourado.
> e não tem nada haver com o meu fone aqui... porque o volume do pc ta em 50% só.
> O que acha que pode ser, meio que ele perde um pouco da qualidade de áudio...

Classificacao:

- Pedido explícito: resolver funcionalmente a amplificação acima de 100% para Microphone e Computer Audio no RecordSaaS Desktop.
- Restrição confirmada: não tratar a tentativa anterior de `+6 dB` como solução; ela foi descartada intencionalmente após reprovação de QA.
- Dispositivos informados: saída Realtek padrão e grupo de microfones Intel Smart Sound.

## Interpretacao E Inferencias

- A tentativa descartada mapeava 150% para apenas `+6 dB`. Ela também era atenuada pelo `amix` padrão da exportação: com duas faixas, a normalização implícita removia aproximadamente `6 dB`.
- O payload de exportação não enviava `volume`/`isMuted` atuais do Microphone; o fallback fazia o microfone exportar em `1x`.
- O filtro FFmpeg sem fade descartava ganhos acima de `1`.
- O preview precisava de CORS para `media://`, um único limiter depois da soma e um teto final; limiters separados não protegiam Microphone + Computer Audio simultâneos.
- O Computer Audio bruto analisado contém sinal, mas está extremamente baixo: `mean=-71,3 dB`, `max=-53,4 dB`. A amplificação agora funciona; a captura quase ausente continua sendo um problema separado da fonte.
- O estalo/estouro em `+24 dB` é compatível com ganho digital extremo seguido de compressão/limitação: `+24 dB` equivale a `15,849x`; no Microphone medido, um pico bruto de `-9,3 dBFS` chega a aproximadamente `+14,7 dBFS` antes do limiter. Isso achata transientes e pode alterar o timbre.
- O volume de saída do Windows em `50%` ocorre depois desse processamento digital e não desfaz clipping, compressão ou overshoot criado antes da saída.
- O Computer Audio isolado medido em `-53,5 dB` de pico ainda fica em aproximadamente `-29,5 dB` após `+24 dB`; portanto, a distorção percebida nesse cenário não deve ser atribuída automaticamente à faixa do computador sem isolar as fontes.

## Implementacao Ou Alteracao

- Curva compartilhada em [audio-volume.ts](../../../src/lib/audio-volume.ts):
  - até 100%: comportamento linear existente;
  - 125%: `+12 dB` (`3,981x`);
  - 150%: `+24 dB` (`15,849x`).
- Preview:
  - [preview-audio.ts](../../../src/lib/preview-audio.ts) concentra o grafo Web Audio;
  - todas as fontes ativas convergem em um master compressor e peak guard de `-5 dB` quando Microphone ou Computer Audio está acima de 100%;
  - [Preview.tsx](../../../src/components/editor/Preview.tsx) aplica a mesma curva após multiplicadores de Change Sound, fades e takes;
  - imported takes entram no mesmo barramento; `media://` e elementos locais usam CORS.
- Exportação:
  - [useExportProcess.ts](../../../src/hooks/useExportProcess.ts) envia `volume` e `isMuted` atuais do Microphone;
  - [export-manager.ts](../../../electron/main/features/export-manager.ts) mantém fallback legado, aplica ganho acima de `1`, preserva fades por frame e limita depois da concatenação;
  - todas as faixas são misturadas uma vez com `amix normalize=0` e limiter master;
  - intermediários de processamento, sync e takes usam FLAC; AAC é codificado uma vez no caminho final;
  - limiter usa `5 dB` de headroom antes do AAC para conter picos reais após encode.
- UI em [AudioSettings.tsx](../../../src/components/editor/sidepanel/AudioSettings.tsx): mostra percentual e dB; botão máximo explicita `+24 dB`.
- [verify-export-startup.mjs](../../../scripts/verify-export-startup.mjs) protege payload, curva, mix, limiter, FLAC, fade e barramento master.
- [AGENTS.MD](../../../AGENTS.MD) registra o contrato de áudio atualizado.

## Commits Relacionados Ao Card

Repositorio: `E:\GitHub\recordsaas-solutions\recordsaas`

- Branch: `al-branch-1`
- Base/destino: nao determinado; branch sem upstream configurado.
- Commits:
  - `5614a0d` - `feat: extend audio volume and duplicate timeline regions` - `2026-08-11` - introduziu o controle ate 150%.
  - `b751ef6` - `fix: preserve project background and zoom settings` - `2026-08-11` - estado anterior usado pelos WIPs desta rodada.
  - `7e4ba02` - `docs: record export QA fixes` - `2026-08-11` - documentacao recente relacionada ao fluxo de exportacao.
- Tentativa não commitada de `+6 dB`: descartada intencionalmente pelo usuário no GitButler e superada por esta implementação de `+24 dB` com limiter/mix corrigidos.
- `d2e8610` - `feat(audio): add gain boost and soft peak protection` - implementação consolidada do ganho, mix e proteção de picos.
- Push/PR: nenhum push executado nesta sessao; branch sem upstream configurado.

## Validacao

- Arquivos reais usados:
  - projeto `CorrigindoTabuaDeMareAPIv2`;
  - Microphone `RecordSaaS-recording-1786411875358-audio.aac`;
  - Computer Audio `RecordSaaS-recording-1786411875358-system-audio.aac`;
  - trecho comum de 60 segundos a partir de `t=60`.
- Electron/Chromium real com `media://`, sem saída física nos alto-falantes:
  - Microphone: 100% `-32,4 dB RMS`; 125% `-19,5 dB`; 150% `-10,8 dB`;
  - pico em 125%/150%: `-5,0 dB`;
  - duas fontes simultâneas em 150%: `-9,2 dB RMS`, pico `-5,0 dB`;
  - nenhum silêncio e `AudioContext` funcional.
- Exportação FFmpeg real, intermediários FLAC e mix AAC final:
  - mix 100%: `mean=-35,1 dB`, `max=-9,3 dB`, `true peak=-9,3 dBTP`;
  - mix 125%: `mean=-23,5 dB`, `max=-4,7 dB`, `true peak=-4,7 dBTP`;
  - mix 150%: `mean=-17,8 dB`, `max=-2,1 dB`, `true peak=-2,1 dBTP`;
  - Computer Audio isolado: 100% `-71,3/-53,5 dB`, 125% `-59,3/-41,4 dB`, 150% `-47,3/-29,4 dB`; ganho exato de `+12/+24 dB`.
- Passaram: TypeScript, ESLint focado, Prettier, `verify:export-startup`, build completo e `git diff --check`.
- SCC: baseline anterior do escopo principal tinha complexidade `556`, ULOC `3159`, DRYness `0,66`; escopo final ampliado para oito arquivos tem complexidade `577`, ULOC `3479`, DRYness `0,66`. Crescimento proporcional à curva, UI, master bus, limiter/mix e invariantes; infraestrutura do preview extraída para módulo próprio. Classificação: Neutral; sem refatoração adicional necessária.
- Não validado: interação manual e audição física dentro da janela completa do editor, nem exportação acionada pela UI com o projeto inteiro.

## Riscos E Pendencias

- A captura bruta de Computer Audio analisada está quase ausente; `+24 dB` aumenta o sinal exatamente, mas não reconstrói conteúdo que não foi capturado. Investigar o helper de captura/dispositivo separadamente se novos arquivos mantiverem níveis próximos de `-70 dB`.
- O `AudioContext` e os nodes do preview são globais e não têm descarte explícito ao trocar muitos projetos/fontes na mesma sessão; risco de retenção de grafos em sessão longa.
- O peak guard do preview usa hard clip somente depois do compressor; sob limitação extrema pode introduzir distorção, preferível a clipping no dispositivo.
- `+24 dB` não preserva a dinâmica original quando a fonte já está próxima de `0 dBFS`: a proteção evita o clipping bruto, mas a compressão/limitação intensa e a codificação AAC podem produzir a perda de qualidade percebida. Uma correção de qualidade exigirá limiter true-peak/mais suave e/ou headroom/ganho máximo configurável, não apenas aumentar o volume de saída.
- Corrigir `amix normalize=0` muda exportações antigas com múltiplas faixas mesmo em 100%; é intencional para evitar perda de `6 dB` e descontinuidade ao cruzar 100%.
- Fades de Change Sound agora são contínuos no export; requer QA específico com região e fade no fluxo completo.
- Nenhum commit ou push foi solicitado/executado.

## Proximo Teste Esperado

- Reiniciar totalmente o RecordSaaS Desktop, abrir o mesmo projeto e comparar a mesma passagem em 100%, 125% e 150%.
- Exportar um trecho curto nesses três níveis e confirmar visual/auditivamente o resultado medido.
- Gravar novo Computer Audio e medir o bruto; se continuar perto de `-70 dB`, abrir diagnóstico separado da captura Windows.
