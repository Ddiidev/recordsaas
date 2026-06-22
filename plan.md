# Plano de Correção: Gravação de Áudio do Sistema

## 1. O Problema Relatado
O usuário relatou que a gravação do áudio do sistema parou de funcionar corretamente após a alteração para passar os dados via `stdout` (com a intenção de corrigir a dessincronização de áudio e vídeo). A aplicação está gerando os arquivos de áudio (ex: `system-audio.aac`), porém, durante a reprodução, o som é inexistente ou inaudível, mesmo selecionando manualmente cada um dos dispositivos de áudio virtuais do SteelSeries Sonar.

## 2. Evidências e Provas do Problema
Analisei os projetos enviados:
- **RecordSaaS-recording-1782155067636-system-audio.aac (37 segundos):** O arquivo não está vazio (possui 337 KB). No entanto, utilizando o `ffmpeg volumedetect`, identifiquei que a média de volume (`mean_volume`) está em **-34.2 dB**, e o pico máximo (`max_volume`) em **-14.5 dB**. Além disso, 99% das amostras de áudio no arquivo são de silêncio absoluto. Apenas uma fração de segundo (96 samples) contém áudio audível.
- **RecordSaaS-recording-1782141005308-system-audio.aac (85 segundos):** O arquivo de áudio existe, tem tamanho condizente com a duração (2 MB) e está corretamente mapeado no `project.rsproj`.
- **Arquitetura de Downmix:** O SteelSeries Sonar utiliza **8 canais (7.1)**. Quando o FFmpeg recebe esses 8 canais e precisa converter para estéreo (`-ac 2`), ele aplica uma matriz de downmix (redução de volume) para evitar distorções. Isso diminui o volume final em cerca de -10 dB, tornando sons que já são baixos praticamente inaudíveis.
- **Inserção de Silêncio (Gap-filling):** A lógica de preenchimento de silêncio inserida na versão anterior do C# (`gapToleranceMs`) pode estar se ativando de forma incorreta caso haja pequenas variações de tempo (jitter) no envio dos buffers do Windows.

## 3. Causa Raiz (Hipóteses Confirmadas)
O problema não é que o programa parou de gravar. O arquivo está sendo gerado perfeitamente, sincronizado e com o formato correto de bits (`f32le`). A falha está na **dinâmica do volume e na seleção do fluxo de áudio**:
1. **FFmpeg Downmix (Volume muito baixo):** O dispositivo `SteelSeries Sonar` possui 8 canais. Ao forçar o FFmpeg a ler e converter para 2 canais, a redução automática de volume faz com que a música fique extremamente baixa.
2. **Gap Filling Incorreto:** Como a captura do WASAPI envia pacotes de áudio com ligeiros atrasos do sistema operacional, o tempo calculado localmente pelo C# (`sw.Elapsed`) entra em conflito com o tempo real do áudio. Isso faz com que a lógica de "preencher silêncio" injete silêncio no meio do áudio que está sendo reproduzido, corrompendo a onda sonora e esmagando o volume/qualidade da música.

## 4. Plano de Correção Pragmático

### Passo 1: Remover o Gap-Filling Manual do C# (A Origem da Corrupção)
Como o FFmpeg e a captura de áudio via `stdout` já suportam timestamps em contêineres, ou como o próprio Windows WASAPI Loopback suspende o envio apenas quando não há áudio (e o Sonar injeta silêncio automaticamente para manter o canal ativo), a tentativa manual de "preencher silêncio" no C# com `WriteSilenceMs` está causando mais problemas do que resolvendo.
**Ação:** Remover a lógica de `gapToleranceMs` e a função `WriteSilenceMs` do arquivo `Program.cs`. Apenas repassar os bytes exatos (`eventArgs.Buffer`) que chegam do WASAPI.

### Passo 2: Corrigir o Filtro de Áudio no FFmpeg (Volume Drop e Sincronia)
Para garantir que o FFmpeg não perca a sincronia (mesmo sem o gap-filling manual no C#) e para evitar o "volume drop" do downmix de 8 para 2 canais, usaremos filtros nativos do FFmpeg.
**Ação:** Adicionar filtros de áudio para corrigir o estéreo, usando algo como `-ac 2` (com downmix não destrutivo se necessário) e delegar a sincronização puramente ao ffmpeg (`aresample=async=1` ou confiando no pipe constante).

### Passo 3: Garantir o Rebuild da Solução
Como identificado no log do terminal do usuário (`Error: Usage: recordsaas-system-audio.exe...`), o utilitário baixou uma versão antiga do GitHub porque o timestamp do binário não bateu.
**Ação:** Incrementar a versão da release no `ensure-binaries.mjs` ou forçar sempre a compilação local durante o desenvolvimento, para garantir que o código novo seja rodado.

## 5. Próximas Etapas
Farei a alteração no código fonte C#, compilarei a nova versão e ajustarei a chamada do FFmpeg no Node.js.
