# export-performance - correção da validação headless do helper Windows

Gerado em: 2026-08-12
Sessao/contexto: 019ff678
Tipo de registro: retorno-qa

## Card

Arquivo do card: nao fornecido.
Contexto anterior: [correção do SDK .NET 11](export-performance-2026-08-12-{019ff678}-ci-dotnet11-action-system-audio-fix.MD).

Resumo:

- Corrigir a falha do GitHub Actions após o SDK .NET 11 ter sido instalado corretamente.

## Pedido Do Usuario

Pedido literal:

> use o gh para olhar as actions que deram erro. não está correto ainda

Classificacao:

- Pedido explícito: inspecionar os erros reais das Actions e corrigir o problema restante.
- Restrição: corrigir diretamente na `main`, já que a PR anterior foi mergeada.

## Interpretacao E Inferencias

- O run `31635917204` confirmou que o SDK .NET 11 foi resolvido.
- A falha ocorreu em `npm run setup:binaries` com `No render device found.` durante `--probe`.
- O runner `windows-2022` é headless; validar a existência de hardware de áudio durante o empacotamento é incorreto.

## Implementacao Ou Alteracao

- [Program.cs](../../../native/RecordSaaS.SystemAudio/Program.cs): adicionado `--version`, validação que não depende de dispositivo de áudio.
- [ensure-binaries.mjs](../../../scripts/ensure-binaries.mjs): reutilização e validação pós-publish passam a usar `--version`; `--probe` continua reservado à detecção real em runtime.
- [verify-export-startup.mjs](../../../scripts/verify-export-startup.mjs): proteção estrutural para a validação headless-safe.
- Não alterado: captura WASAPI, seleção de dispositivo, target `net11.0-windows` ou fluxo de release fora da validação do helper.

## Commits Relacionados Ao Card

Repositorio: `E:\GitHub\recordsaas-solutions\recordsaas`

- Branch: `main`
- Base/destino: `origin/main`.
- Commit anterior relacionado: `13ea7c6` - instalação do SDK .NET 11 preview.
- `d6621f4` - `fix(ci): validate Windows audio helper without hardware` - 2026-08-12 - corrige a validação headless e publica o helper atualizado.
- Push/PR: commit publicado diretamente em `origin/main` após rebase sobre `v2.7.3`.

## Validacao

- Feita: inspeção via `gh run view 31635917204 --log-failed`.
- Feita: confirmação de que o erro atual é exclusivamente `No render device found.` após o publish.
- `gh run view 31635917204 --log-failed`: confirmou o erro `No render device found.` após o publish.
- `dotnet publish` self-contained `win-x64` com SDK `11.0.100-preview.5.26302.115`: passou.
- Helper publicado com `--version`: passou sem depender de hardware de áudio.
- `RECORDSAAS_FORCE_DOTNET_HELPER_BUILD=1 npm run setup:binaries`: passou.
- `npx tsc --noEmit --pretty false`: passou.
- `npx eslint scripts/ensure-binaries.mjs scripts/verify-export-startup.mjs --max-warnings 0`: passou.
- `npm run verify:export-startup`: passou.
- Prettier nos scripts alterados: passou.
- `npm run build`: passou; permaneceu apenas o aviso existente de chunks acima de 500 kB.
- `git diff --check`: passou.
- SCC nos três arquivos de código alterados: snapshot sem baseline anterior; classificação neutra.
- Pendente: nova execução da Action após o push.

## Riscos E Pendencias

- A Action ainda precisa confirmar o build completo após a alteração.
- `--probe` continua podendo falhar corretamente em runtime se o usuário não tiver um dispositivo de saída; isso não bloqueia o empacotamento.

## Proximo Teste Esperado

- Publicar na `main`; confirmar no `gh run` que `setup:binaries` avança para o build Windows.
