# Plano de Execucao - Timeline com Multiplas Lanes

## Objetivo
- Implementar lanes na timeline com suporte a:
- Criar/remover multiplas lanes.
- Mover itens horizontalmente (comportamento atual preservado).
- Mover itens verticalmente entre lanes.
- Precedencia visual/funcional por lane: lane mais acima sobrepoe lanes abaixo.

## Regras Funcionais (Nao Negociaveis)
- [ ] Drag horizontal atual continua funcionando sem regressao.
- [ ] Drag vertical entre lanes funciona para `zoom`, `cut` e `speed`.
- [ ] Itens em lanes superiores vencem conflitos de sobreposicao.
- [ ] Sem quebrar export/render/preview existentes.

## Fase 1 - Modelagem de Dados e Estado
- [ ] Criar tipo `TimelineLane` (ex.: `id`, `name`, `order`, `visible`, `locked`).
- [ ] Adicionar `timelineLanes` no `TimelineState`.
- [ ] Adicionar `laneId` (ou `laneOrder`) em `ZoomRegion`, `CutRegion`, `SpeedRegion`.
- [ ] Definir lane padrao para novos itens.
- [ ] Migrar itens existentes para lane padrao ao carregar projeto antigo.
- [ ] Atualizar actions no slice da timeline:
- [ ] `addLane`, `removeLane`, `reorderLane`, `renameLane`.
- [ ] `moveRegionToLane(regionId, laneId)`.
- [ ] Ajustar recalc de `zIndex` para considerar:
- [ ] Prioridade de lane (mais acima = maior prioridade).
- [ ] Regra secundaria atual (duracao/selecionado), sem perda de UX.

## Fase 2 - Renderizacao da Timeline por Lane
- [ ] Refatorar `Timeline.tsx` para renderizar trilhas por `timelineLanes`.
- [ ] Renderizar areas/drop-zones por lane (grid vertical claro).
- [ ] Exibir controles de lane (add/remove/reorder) no UI da timeline.
- [ ] Manter playhead, ruler e trims funcionando em toda a altura.
- [ ] Garantir que selecao/highlight do item continue correta apos mudar de lane.

## Fase 3 - Interacao (Drag Horizontal + Vertical)
- [ ] Estender `useTimelineInteraction.ts` para capturar eixo Y durante drag.
- [ ] Durante `move`, resolver lane alvo com base na posicao vertical do mouse.
- [ ] Aplicar preview visual de lane alvo durante o drag (ghost/placeholder).
- [ ] No `mouseup`, persistir:
- [ ] `startTime` (regra horizontal atual).
- [ ] `laneId` (se mudou verticalmente).
- [ ] Nao permitir mover para lane bloqueada/invisivel (se habilitado no modelo).
- [ ] Garantir que resize (`resize-left/right`) continue apenas horizontal.

## Fase 4 - Precedencia e Resolucao de Conflitos
- [ ] Criar utilitario unico para ordenar/regra de precedencia entre regioes ativas.
- [ ] Aplicar utilitario no preview/render:
- [ ] `src/lib/transform.ts` (escolha de zoom ativo).
- [ ] `src/lib/renderer.ts` (composicao final).
- [ ] `src/pages/Preview.tsx` e fluxo de export quando houver conflito.
- [ ] Definir regra explicita para empate:
- [ ] Lane superior vence.
- [ ] Se mesma lane, usar `zIndex`/ordem existente.

## Fase 5 - Compatibilidade e Persistencia
- [ ] Atualizar leitura/escrita de projeto para salvar `timelineLanes` e `laneId`.
- [ ] Backward compatibility:
- [ ] Projeto sem lane -> inicializar lane default automaticamente.
- [ ] Garantir undo/redo (zundo) incluindo mudancas de lane e de itens entre lanes.

## Fase 6 - QA (Checklist de Teste)
- [ ] Criar 3+ lanes.
- [ ] Adicionar `zoom/cut/speed` em lanes diferentes.
- [ ] Arrastar horizontalmente em cada lane sem regressao.
- [ ] Arrastar verticalmente entre lanes mantendo tempo.
- [ ] Sobrepor 2+ regioes no mesmo intervalo e validar precedencia da lane superior.
- [ ] Validar selecao, delete, undo/redo apos mover lane/item.
- [ ] Validar preview em tempo real.
- [ ] Validar export final com resultado coerente com a precedencia.

## Fase 7 - Entrega
- [ ] PR 1: modelo + store + migracao.
- [ ] PR 2: UI de lanes + renderizacao.
- [ ] PR 3: drag vertical + precedencia em preview/export.
- [ ] PR 4: testes de regressao + limpeza tecnica.

## Riscos e Mitigacoes
- [ ] Risco: conflito entre regra antiga de `zIndex` e nova prioridade por lane.
- [ ] Mitigar centralizando ordenacao em utilitario unico compartilhado.
- [ ] Risco: divergencia entre timeline visual e export.
- [ ] Mitigar usando a mesma regra de precedencia no preview e no export.
