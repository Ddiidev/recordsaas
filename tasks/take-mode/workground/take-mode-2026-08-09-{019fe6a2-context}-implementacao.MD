# Modo Take — implementação

- Data de início: 2026-08-09
- Repositório: `E:\GitHub\recordsaas-solutions\recordsaas`
- Branch: `main`
- Base inicial: `e0ffa30` (`feat(editor): refine timeline and audio synchronization`)
- Estado inicial: árvore limpa; `main` 66 commits à frente de `origin/main`
- Commit/push da feature: nenhum; não criar sem novo pedido

## Pedido literal

> Eu queria fazer algumas edições no RecordsSaaS Desktop para ele ter um modo de take. Hoje é uma gravação contínua; eu não consigo nem ao menos editar o vídeo principal. Eu consigo adicionar coisas, adicionar áudio, enfim, entre outras coisas que foram adicionadas posteriormente por mim, mas não consigo pegar uma parte, um trecho daquele vídeo e editar.
>
> Eu gostaria de ter um modo de edição, como um modo take, onde eu escolho qual vídeo para o take 1, o take 2, o take 3 e assim por diante. Durante a gravação, teria um modo de gravação de takes também. O corte de um take para o outro eu faria com uma tecla de atalho como Ctrl + Shift + F12, por exemplo. Aí ele corta e aquilo é um take.
>
> Depois, ele coloca todos os takes separados em uma timeline separada acima daquela timeline que já é utilizada hoje. Essa timeline separada, que fica mais acima, mais próximo ao player, entre o player e a timeline, seria take 1, take 2, tudo coladinho, obviamente com padding esquerda e direita para não ficar muito junto, e eu conseguiria dar zoom tudo direitinho.
>
> Nela, em cada take, eu consigo editar, ajustar e fazer o que eu quiser. Se eu não gostar de um take, eu simplesmente deleto e mantenho outro, vou ajustando os takes. Eu preciso também que eu consiga adicionar transições entre um take e outro. Isso é também importante. Acho que é isso.

Pedido de execução aprovado em 2026-08-09:

> PLEASE IMPLEMENT THIS PLAN: Plano — Modo Take no RecordSaaS Desktop

Pedido posterior, executado antes desta feature:

> faça commit do que tem hoje uncommited

Resultado: checkpoint `e0ffa30`, incluindo todos os 25 arquivos então pendentes. O snapshot possui uma falha TypeScript preexistente: [`Preview.tsx`](../../../src/components/editor/Preview.tsx) referencia `isTimelineScrubbing`, ausente em `EditorStore`.

## Escopo aprovado

- Modo opcional baseado em EDL. Gravação física permanece contínua.
- `Ctrl+Shift+F12` marca fronteira sem reiniciar FFmpeg; fallback no tray.
- Faixa de takes de 64 px acima da timeline existente, usando o mesmo zoom, scroll e playhead.
- Fontes: tela, webcam e vídeo importado.
- Operações: split, trim, reorder, duplicate, replace, rename e delete com ripple.
- Transições visuais e áudio cut/crossfade.
- Timeline inferior permanece em tempo final absoluto; regiões não acompanham operações de take.
- Preview, persistência e export passam a entender tempo composto.
- Legado sem novos campos permanece com comportamento atual.

## Decisões e contratos

- Ordem de `takes` é canônica. Inícios no destino são derivados.
- Sem transição significa corte seco.
- Transição padrão 0,3 s; faixa 0,1–2 s; limite de metade de cada take adjacente.
- Sobreposição de transição reduz a duração final.
- Áudio de sessão inicia com cut; áudio embutido inicia com crossfade. Ajustável por fronteira.
- `sourceDuration`: duração física. `duration`: duração final da composição.
- `currentTime`: tempo composto, nunca autoridade direta de `HTMLVideoElement.currentTime`.
- Cadeia: tempo exportado → Cut/Speed → composição de takes → fonte.
- Campos `.rsproj`: `takeModeEnabled`, `sourceDuration`, `takes`, `takeTransitions`.
- `TakeTrack` oculto durante edição temporária de asset.
- Efeitos e regiões além da duração final ficam armazenados, mas recortados no preview/export.
- `Cut` continua não-ripple na Content Root.
- Sem retarget silencioso de transições após duplicate/reorder/delete.
- Último take não pode ser excluído.
- UI em inglês, identidade atual, sem biblioteca visual nova.

## Contexto preservado

- Checkpoint anterior à feature: `e0ffa30`.
- Alterações já existentes preservadas: Content Root, split, áudio, offsets de sync, export, lanes, zoom e resize.
- Sem stash, reset, troca de branch ou push.
- Engram indisponível nesta sessão; este WIP é a trilha principal.

## Plano de execução

- [x] Capturar baseline visual e SCC localizado.
- [x] Implementar modelo EDL, normalização, operações e testes puros.
- [x] Integrar persistência, legado, undo/redo e edição temporária.
- [x] Integrar gravação, PTS, atalho global, tray e lifecycle.
- [x] Implementar `TakeTrack`, seleção, inspector e atalhos de edição.
- [x] Tornar preview/scrub/frame-step composição-aware, incluindo transições.
- [x] Integrar composição e áudio de takes no export FFmpeg.
- [x] Implementar preparação/proxy de vídeo importado.
- [x] Atualizar [`AGENTS.MD`](../../../AGENTS.MD) conforme comportamento real.
- [x] Executar gates estáticos, build, startup export, SCC final e QA Windows possível.

## Baseline e validações

### Antes da feature

- `git diff --check`: passou no snapshot `e0ffa30`.
- `npx tsc --noEmit --pretty false`: falhou antes da feature em [`Preview.tsx`](../../../src/components/editor/Preview.tsx), propriedade `isTimelineScrubbing` ausente em `EditorStore`.
- SCC localizado, 6 arquivos centrais: 10.071 linhas; 9.151 linhas de código; complexidade 1.681; ULOC 6.215; DRYness 0,62% conforme saída da ferramenta.
- Baseline visual real: [`runtime-recorder.png`](./runtime-recorder.png) e [`runtime-editor-legacy.png`](./runtime-editor-legacy.png).

## Evidências de implementação

- Contratos e operações EDL: [`src/types/index.ts`](../../../src/types/index.ts), [`src/lib/takes.ts`](../../../src/lib/takes.ts), [`src/lib/takes.test.ts`](../../../src/lib/takes.test.ts).
- Persistência/undo/legado/asset edit: [`src/store/slices/projectSlice.ts`](../../../src/store/slices/projectSlice.ts) e [`src/store/editorStore.ts`](../../../src/store/editorStore.ts).
- Gravação: toggle persistente; `recording:start.takeModeEnabled`; PTS `out_time_us` + `performance.now()`; mínimo `max(0,1 s, 2 frames)`; GOP 2 s; atalho global; conflito tray/cancel; tray `Mark Take`; unregister em todos os encerramentos.
- Editor: faixa sticky de 64 px no scroll temporal; seleção exclusiva; trim; split/delete/duplicate/reorder/rename; inspector em General; replace tela/webcam/importado; chips e cinco transições.
- Preview: relógio composto; fontes tela/webcam/importado; dois canvases de transição; áudio de sessão/source/none; timeline inferior em segundos finais.
- Importação: `media:prepare-take-video`, progresso/cancelamento/cleanup; proxy CFR H.264, GOP 2 s, áudio opcional e metadados.
- Export: providers lazy por take; fontes A/B durante transição; EDL de mic/PC/áudio embutido; cut/crossfade; Cut/Speed/Change Sound aplicados após a composição de áudio.
- Runtime Windows: editor legado preservado; toggle gera um take inicial; `S` gerou três takes; inspector abriu; chips `Cut` abriram Dissolve, Fade to Black, Slide Left, Slide Right e Zoom. Evidência: [`runtime-editor-three-takes.png`](./runtime-editor-three-takes.png).
- Gravação Windows real: Take Mode ligado; FFmpeg leu `out_time_us`; `Ctrl+Shift+F12` gerou fronteira PTS `0,2237875`; metadata final trouxe `takeModeEnabled=true`, `sourceDuration=4,783333`, `takeBoundaries=[0,2237875]`; editor abriu dois takes de `0,22 s` e `4,56 s`.

### Gates finais

- `node --test src/lib/takes.test.ts`: 10/10 passaram.
- `npx tsc --noEmit --pretty false`: passou.
- ESLint direcionado em todos os arquivos tocados: passou com zero warnings.
- Prettier direcionado: aplicado; `git diff --check`: passou antes da atualização final do WIP e deve ser repetido no fechamento.
- `npm run build`: passou; aviso conhecido de chunk renderer acima de 500 kB.
- `npm run verify:export-startup`: passou após tornar o marcador do verificador compatível com a chamada multilinha formatada.
- SCC comparável, mesmos 6 arquivos centrais: 12.248 linhas; 11.183 linhas de código; complexidade 2.240; ULOC 7.762; DRYness 0,63. Crescimento proporcional à feature transversal, mas arquivos centrais continuam grandes; lógica EDL pura e UI nova foram separadas.
- SCC incluindo 3 arquivos novos principais: 13.114 linhas; 11.993 linhas de código; complexidade 2.383; ULOC 8.351; DRYness 0,64.

## Riscos e pendências

- Grande alteração transversal: gravador, IPC, store, timeline, preview, decodificação, áudio e export.
- Hotkey global confirmou uma marca real. Repetição de múltiplas marcas na mesma gravação ainda precisa de QA manual dedicado; a automação sintética produziu somente uma fronteira.
- Tray `Mark Take` e fluxo de conflito/cancelamento foram validados estaticamente, não clicados no QA.
- Export real com probe/decode integral e aferição A/V nas fronteiras não foi executado; build e verificador de startup passaram.
- Proxy de importado, source sem áudio, save/reopen `.rsproj`, light/dark e zoom tocando ainda precisam de QA manual.
- macOS/Linux somente validação estática neste ambiente.
- Fontes antigas/importadas podem exigir proxy CFR/GOP seekável.
- Nenhum commit da feature autorizado.

## Commits relacionados

- `e0ffa30` — checkpoint solicitado pelo usuário antes do Modo Take; não contém implementação desta feature.
- Modo Take: nenhum commit.
