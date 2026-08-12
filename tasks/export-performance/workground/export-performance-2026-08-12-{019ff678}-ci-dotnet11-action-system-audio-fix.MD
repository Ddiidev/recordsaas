# export-performance - correção do SDK .NET do helper Windows

Gerado em: 2026-08-12
Sessao/contexto: 019ff678
Tipo de registro: implementacao

## Card

Arquivo do card: nao fornecido.
Resumo:

- Corrigir a falha do job de release em `npm run setup:binaries` no Windows.
- Contexto anterior: [semantic-release-review-push](export-performance-2026-08-12-{019ff678}-semantic-release-review-push.MD).

## Pedido Do Usuario

Erro reportado no workflow:

> `NETSDK1045: The current .NET SDK does not support targeting .NET 11.0.`

Classificacao:

- Pedido implícito: corrigir a falha de build da PR e publicar a correção na branch.
- Restrição: preservar o build self-contained `win-x64` do helper.

## Interpretacao E Inferencias

- O runner `windows-2022` possui SDK `10.0.302`, mas o projeto nativo declara `net11.0-windows`.
- O target `net11.0-windows` é intencional; o problema era o workflow não instalar o SDK preview necessário.
- `actions/setup-dotnet@v5` com `dotnet-version: 11.0.x` e `dotnet-quality: preview` instala o SDK correto antes de `npm run setup:binaries`.

## Implementacao Ou Alteracao

- [release.yml](../../../.github/workflows/release.yml): adicionado setup explícito do SDK .NET 11 preview no job Windows.
- [RecordSaaS.SystemAudio.csproj](../../../native/RecordSaaS.SystemAudio/RecordSaaS.SystemAudio.csproj): preservado `net11.0-windows`.
- [AGENTS.MD](../../../AGENTS.MD): documentado o SDK preview exigido pelo helper.
- Não alterado: `scripts/ensure-binaries.mjs`, runtime `win-x64`, publish single-file, compressão ou NAudio.

## Commits Relacionados Ao Card

Repositorio: `E:\GitHub\recordsaas-solutions\recordsaas`

- Branch: `al-branch-1`
- Base/destino: `origin/main`.
- Correção atual: será registrada no commit `fix(ci): install .NET 11 preview for system audio helper` após a validação.
- Push/PR: branch já existente; aguardando o commit desta correção.

## Validacao

- `dotnet --version`: `11.0.100-preview.5.26302.115`.
- `dotnet publish` self-contained `win-x64` do projeto nativo, com output temporário: passou.
- Probe do helper publicado contra `Alto-falantes (2- Realtek(R) Audio)`: passou e retornou `48000 Hz`, 2 canais, `IeeeFloat`.
- `npx tsc --noEmit --pretty false`: passou.
- `npx eslint scripts/ensure-binaries.mjs scripts/verify-export-startup.mjs --max-warnings 0`: passou.
- `npm run verify:export-startup`: passou.
- Prettier nos arquivos alterados: passou.
- `npm run build`: passou; permaneceu apenas o aviso existente de chunk acima de 500 kB.
- `git diff --check`: passou.
- SCC nos quatro arquivos de código/configuração alterados: snapshot sem baseline anterior; classificação neutra.
- Não validado ainda: runner Windows do GitHub Actions; será o teste final após o push.

## Riscos E Pendencias

- O publish local/CI depende do restore de `NAudio.Wasapi` e do runtime pack .NET 11 preview.
- O binário versionado em `binaries/windows` não será sobrescrito durante o teste local; o output será temporário.

## Proximo Teste Esperado

- Reexecutar o job de release da PR e confirmar `setup:binaries`, a geração do helper, os artefatos Windows/Linux/macOS e a publicação da release.
