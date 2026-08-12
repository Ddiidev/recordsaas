# export-performance - retorno QA da amplificacao de audio

Gerado em: 2026-08-12
Sessao/contexto: 019ff367
Tipo de registro: retorno-qa

## Card

Arquivo do card: nao fornecido.
Resumo:

- Fazer o volume acima de 100% produzir amplificacao perceptivel e consistente.
- Registro anterior: [retomada de audio amplificado no preview](export-performance-2026-08-11-{019ff367}-audio-preview-gain-resume.MD).

## Pedido Do Usuario

Pedido literal:

> Perfeito, agora nao esta silenciando, porem eu nao estou sentindo que ele esta amplificando nada; ele esta mantendo um volume igual.

Classificacao:

- Retorno de QA: o audio voltou a tocar acima de 100%, mas o ganho nao e perceptivel.
- Escopo atual: investigar e corrigir a amplificacao das faixas de audio no editor; manter a exportacao coerente quando o mesmo estado for usado.

## Interpretacao E Inferencias

- O reparo de CORS foi confirmado funcional: a faixa deixou de silenciar.
- Os logs do renderer nao registraram falha na criacao ou retomada do `AudioContext`.
- Um teste no Electron com o AAC real e o protocolo `media://` mediu razao RMS exata de `1.5x` (`+3.52 dB`); nao havia outra anulacao no preview.
- Decisao: preservar o comportamento linear de 0% a 100% e mapear a zona vermelha de 100% a 150% para 0 a `+6 dB`.
- Foram identificados dois desvios independentes na exportacao: o estado do Microphone nao era enviado e o filtro sem fade descartava ganhos acima de 100%.

## Implementacao Ou Alteracao

- Criado [audio-volume.ts](../../../src/lib/audio-volume.ts) para centralizar a curva: 100% = `1x`, 125% = `1.4125x` e 150% = `1.9953x`.
- Atualizado [Preview.tsx](../../../src/components/editor/Preview.tsx) para aplicar a curva nas faixas Microphone, Computer Audio e no audio embutido principal, preservando atenuacoes de takes, fades e Change Sound.
- Atualizado [useExportProcess.ts](../../../src/hooks/useExportProcess.ts) para enviar `volume` e `isMuted` do Microphone.
- Atualizado [export-manager.ts](../../../electron/main/features/export-manager.ts) para usar a mesma curva, aceitar os campos atuais com fallback legado e gerar `volume=` tambem quando o ganho for maior que `1`.
- Mantida a correcao CORS em [index.ts](../../../electron/main/index.ts), necessaria para o Web Audio reproduzir as faixas locais sem silencio.
- Ampliado [verify-export-startup.mjs](../../../scripts/verify-export-startup.mjs) para proteger o payload e o filtro de ganho contra regressao.

## Commits Relacionados Ao Card

Repositorio: `E:\GitHub\recordsaas-solutions\recordsaas`

- Branch: `al-branch-1`
- Base/destino: nao determinado.
- Commits relacionados:
  - `5614a0d` - `feat: extend audio volume and duplicate timeline regions` - origem do controle ate 150%.
  - `b751ef6` - `fix: preserve project background and zoom settings` - ultimo commit anterior desta sessao.
- Push/PR: nao realizado.
  - `d2e8610` - `feat(audio): add gain boost and soft peak protection` - implementação consolidada do ganho e da proteção de picos.

## Validacao

- Passaram: `npx tsc --noEmit --pretty false`; ESLint direcionado sem warnings; `npm run verify:export-startup`; `npm run build`; `git diff --check`.
- Helper compilado: 100% = `1.000000000`, 125% = `1.412537545`, 150% = `1.995262315`.
- Medicao FFmpeg no mesmo minuto do AAC real:
  - 100%: `mean_volume=-35.1 dB`, `max_volume=-9.3 dB`.
  - 150%: `mean_volume=-29.1 dB`, `max_volume=-3.3 dB`.
  - Diferenca: `+6.0 dB`.
- SCC: seis arquivos, 4.553 linhas de codigo, complexidade 560, ULOC 3.190, DRYness 0.66; sem baseline equivalente; classificacao Neutral.
- Pendente: QA auditivo na janela real do editor e uma exportacao curta pelo fluxo completo.

## Riscos E Pendencias

- Ganho acima de 0 dB pode causar clipping em faixas que ja estejam proximas de 0 dBFS.
- A diferenca auditiva final precisa ser confirmada no dispositivo de reproducao do usuario.

## Proximo Teste Esperado

- Alternar a mesma passagem entre 100% e 150% em Microphone e Computer Audio e confirmar aumento audivel sem silencio.
- Exportar um trecho curto em 100% e 150% e comparar os niveis medidos.
