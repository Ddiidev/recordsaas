# RecordSaaS

O **RecordSaaS** é uma ferramenta robusta, de código aberto, para gravação e edição de captura de tela, projetada para uso pessoal e corporativo. Desenvolvido a partir de modificações customizadas para otimizar drasticamente a experiência do usuário e a performance.

Este software é um fork profundamente aprimorado do projeto original [ScreenArc](https://github.com/tamnguyenvan/screenarc).

## O que há de Novo no RecordSaaS?
Introduzimos funcionalidades exclusivas transformando este fork em uma versão avançada:
* **Timeline Profissional com Múltiplas Faixas (*Lanes*):** Adição de suporte a múltiplas faixas na linha de tempo, garantindo controle avançado para composições e edições visuais ricas.
* **Projetos Salvos para Edição Tardia:** Agora é possível salvar o estado do seu projeto e retomar a edição ou o trabalho de captura num momento futuro.
* **Internacionalização (Multi-língua):** Suporte global ativo, permitindo a tradução fácil para diferentes idiomas.
* **Renderização Otimizada por Hardware:** Aceleração massiva utilizando os recursos de processamento gráfico do seu hardware, resultando em exportações extremamente mais consistentes e rápidas.
* **Desfoque (Blur) Nativo no Editor:** Adição ágil do efeito de desfoque sobre áreas sensíveis durante as edições das cenas.

## Funcionalidades Principais (Herança Base)
* **Captura Flexível:** Grave sua tela cheia, uma janela específica ou uma área personalizada com suporte contínuo a vários monitores.
* **Sobreposição de Webcam:** Adicione um toque pessoal incluindo o feed simultâneo da sua câmera na gravação.
* **Rastreamento Cinematográfico:** Habilita efeito suave de zoom-in ou panorâmica acompanhando de forma inteligente o clique e o movimento do mouse, mantendo a ação em destaque.
* **Editor Poderoso:** Linha do tempo visual baseada para corte fluído, além de customização de molduras, fundos (cores lisas, gradientes ou papéis de parede) e adição de sombras.
* **Proporções de Aspecto Instantâneas:** Alterne entre 16:9 (YouTube), 9:16 (Shorts/TikTok) e 1:1 (Instagram Feed) com um único clique.
* **Sistema Predefinido (Presets):** Salve seus estilos favoritos para aplicá-los instantaneamente em projetos futuros, garantindo consistência.
* **Exportação de Alta Qualidade:** Exporte sua obra-prima como arquivo dinâmico (MP4) ou formato web de rápida distribuição (GIF), com resoluções de até 2K.

## Adquira a Versão Comercial & Suporte
Se você está buscando implementar o RecordSaaS na sua empresa, obter acesso a recursos exclusivos ou contratar nosso suporte especializado e consultoria para implantação, entre em contato para conhecermos melhor o contexto da sua operação e as necessidades do seu time. Eleve a captura de tela na sua companhia com a segurança e a customização da versão *enterprise*.

---

## Como Rodar Localmente (Versão Open Source)

O RecordSaaS foi construído utilizando Node.js e pode ser executado ou empacotado para o seu sistema operacional favorito facilmente.

### Pré-requisitos
- [Node.js](https://nodejs.org/en/) (versão LTS recomendada).

### Passos Gerais
O processo inicial é o mesmo, independentemente de onde você esteja rodando (Windows, macOS ou Linux):

1. Clone o repositório ou faça o download dos arquivos:
   ```bash
   git clone https://github.com/Ddiidev/recordsaas.git
   cd recordsaas
   ```

2. Instale as dependências executando:
   ```bash
   npm install
   ```

3. Para **iniciar a aplicação** no modo desenvolvedor local:
   ```bash
   npm run dev
   ```

### Empacotamento para Produção (Build)
Caso deseje criar um executável do aplicativo para a sua máquina (e não apenas rodá-lo via linha de comando):

* **No Windows:**
  ```bash
  npm run build:win
  ```
  *(Os instaladores gerados estarão na pasta correspondente de output)*

* **No macOS:**
  ```bash
  npm run build:mac
  ```

* **No Linux (AppImage / dep):**
  ```bash
  npm run build:linux
  ```

*O processo de compilação pode levar alguns minutos com base no hardware do seu dispositivo.*
