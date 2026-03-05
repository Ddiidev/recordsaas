# RecordSaaS (Desktop App)

Aplicativo desktop (Electron + React + TypeScript) para gravacao de tela, edicao em timeline e exportacao.

Este repositorio usa um guia tecnico canonico para manutencao por IA:
- [agent.md](./agent.md)

## Fonte Canonica de Contexto

- Arquitetura, contratos IPC, serializacao `.rsproj`, baseline de UI/UX e workflow para LLMs estao centralizados em `agent.md`.
- A pasta `docs/` foi consolidada e removida para reduzir redundancia.

## Como rodar localmente

Pre-requisito:
- Node.js LTS

Passos:
```bash
npm install
npm run dev
```

## Build

```bash
npm run dist:win
npm run dist:mac
npm run dist:linux
```

## Estrutura principal

- `electron/`: processo Main, IPC e preload
- `src/`: app Renderer (paginas, componentes, store)
- `src/store/`: estado global e slices do editor
- `src/components/ui/`: primitives de design system
- `agent.md`: checkpoint tecnico principal para contribuicoes humanas e por IA
