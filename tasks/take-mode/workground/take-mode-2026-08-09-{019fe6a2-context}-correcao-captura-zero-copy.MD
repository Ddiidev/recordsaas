# Modo Take - correcao de captura zero-copy

Gerado em: 2026-08-09
Sessao/contexto: 019fe6a2-context
Tipo de registro: alteracao

## Card

Registro anterior: [diagnostico de performance](./take-mode-2026-08-09-%7B019fe6a2-context%7D-diagnostico-performance-gravacao.MD)

Resumo:

- Remover transferencia GPU->RAM evitavel na captura Windows sem quebrar Intel, AMD, NVIDIA ou fallback CPU.

## Pedido Do Usuario

Pedido literal:

> perfeito faça isso.
> mas e quando eu escolher gravar com intel ou amd no caso de só ter esses outros? e não nvidia?

Classificacao:

- Pedido explicito: implementar rota de captura sem `hwdownload` desnecessario.
- Restricao explicita: preservar suporte para Intel, AMD e ausencia de NVIDIA.

## Interpretacao E Inferencias

- A rota zero-copy so pode ser usada quando `gfxcapture` e o encoder selecionado aceitarem superfices D3D11 de forma direta.
- Intel QSV deve usar mapeamento D3D11->QSV estritamente direto e cair para a rota estavel se o probe falhar.
- Perfil com redimensionamento continua na rota atual ate existir escalonamento hardware equivalente validado.

## Implementacao Ou Alteracao

- Criado `resolveWindowsScreenCaptureFrameTransfer` em [windows-screen-capture.ts](../../../electron/main/features/windows-screen-capture.ts).
- `gfxcapture` com NVENC ou AMF tenta superficie D3D11 direta, sem `hwdownload`.
- `gfxcapture` com QSV tenta `hwmap=derive_device=qsv:mode=read+write+direct`; `direct` impede copia silenciosa.
- Cada rota e testada com o monitor e encoder selecionados antes de iniciar a gravacao. Falha, encoder CPU, encoder desconhecido, perfil com escala ou `gdigrab` usam `hwdownload,format=bgra` ou a rota original compativel.
- [recording-manager.ts](../../../electron/main/features/recording-manager.ts) usa os filtros resolvidos e grava no log `Windows screen frame transfer: direct-d3d11`, `d3d11-to-qsv` ou `download`.
- [AGENTS.MD](../../../AGENTS.MD) documenta a regra duravel de compatibilidade.
- Nao foram alterados codec, GOP, FPS, webcam, audio ou o fallback `gdigrab`.

## Commits Relacionados Ao Card

Repositorio: `E:\GitHub\recordsaas-solutions\recordsaas`

- Branch: `main`
- Base/destino: `origin/main`
- Commits:
  - `e0ffa30` - `feat(editor): refine timeline and audio synchronization` - checkpoint anterior relacionado ao card.
- Push/PR: not pushed.

## Validacao

- Baseline SCC localizado: `windows-screen-capture.ts`, `recording-manager.ts`, `screen-encoder.ts`, `AGENTS.MD`; 4.417 linhas de codigo, complexidade 817, DRYness 0.67.
- Diagnostico anterior confirmou `gfxcapture -> hwdownload,format=bgra -> h264_nvenc` na gravacao Windows real.
- `npx tsc --noEmit --pretty false`: passou.
- `npm run build`: passou.
- `git diff --check`: passou.
- Prettier direcionado: passou apos formatacao de [windows-screen-capture.ts](../../../electron/main/features/windows-screen-capture.ts) e [recording-manager.ts](../../../electron/main/features/recording-manager.ts).
- SCC final no mesmo escopo: 4.504 linhas de codigo, complexidade 830, DRYness 0.67. Crescimento proporcional ao fallback/probe; classificacao: Neutral.
- Nao executado: QA manual Windows. O usuario e a autoridade para esse teste.

## Riscos E Pendencias

- O handle de monitor da sessao finalizada nao pode ser reutilizado para probe fora do fluxo de gravacao; a validacao direta ocorre no proximo inicio real.
- Zero-copy exige probe por combinacao captura/encoder; falha mantem a rota `hwdownload` segura.
- Esta maquina NVIDIA nao pode provar AMF/QSV em runtime sem hardware correspondente.

## Proximo Teste Esperado

- Gravar 30-60 segundos com perfil nativo, 1080p60, e confirmar no log `direct-d3d11` ou fallback explicito; comparar `dup` e responsividade.
- Para Intel/AMD: confirmar respectivamente `d3d11-to-qsv` ou `direct-d3d11`; se houver incompatibilidade, confirmar o log de fallback e gravacao valida.
