# Compositor WebGL2 + OffscreenCanvas Worker

Substituição do pipeline Canvas 2D por composição acelerada em GPU rodando em thread dedicada. Elimina o gargalo de CPU que causa o travamento da webcam e micro-stutters na tela.

## Background

### Estado Atual (Canvas 2D — CPU)

```
Main Thread (React + Electron renderer)
│
├── requestAnimationFrame loop
│   └── renderCanvas() → drawScene(ctx2d, ...)  ← CPU
│       ├── drawImage(screenVideo)               ← CPU decode → CPU copy
│       ├── drawImage(webcamVideo)               ← CPU decode → CPU copy
│       ├── Blur: 6x drawImage + pixel ops       ← CPU
│       └── Zoom: JS matrix → CPU transform
│
└── React render / DOM updates (compete pelo mesmo thread)
```

**Problema:** `drawImage(videoElement)` força o Chromium a:
1. Decodificar o frame de vídeo no processo de decode (GPU ou CPU)
2. **Copiar o frame decoded para a memória da CPU**
3. Fazer upload da CPU → GPU via `texImage2D` interno

Isso ocorre 30–60x por segundo **para cada vídeo**, no mesmo thread do React.

### Estado Alvo (WebGL2 + OffscreenCanvas Worker — GPU)

```
Main Thread (React + Electron renderer)
│
├── Envia estado (zoom, posição webcam, etc.) → Worker via postMessage
└── Exibe o <canvas> transferido (zero copy)

Worker Thread (renderer.worker.ts)
│
├── OffscreenCanvas com contexto WebGL2
├── requestAnimationFrame loop (worker RAF)
│   ├── texImage2D(screenVideo)    ← frame direto CPU→GPU (sem cópia extra)
│   ├── texImage2D(webcamVideo)    ← idem
│   ├── Bind shader → draw quads  ← 100% GPU
│   └── Zoom/layout: uniforms      ← GPU transforms
└── Nunca bloqueia React
```

---

## User Review Required

> [!IMPORTANT]
> Esta é uma refatoração de **média-alta complexidade** dividida em 3 fases independentes. Cada fase entrega valor por si só e pode ser validada antes de iniciar a próxima. A fase 1 já resolve a maior parte do problema de FPS da webcam.

> [!WARNING]
> O `renderer.ts` tem 1568 linhas com lógica acumulada (blur, cursor, zoom, swap, monitores flutuantes). A migração para Worker (Fase 2) requer que o estado enviado ao Worker seja serializável (sem DOM refs). Isso impõe uma separação clara entre **lógica de layout** (pode rodar no Worker) e **referências de DOM** (permanecem no main thread).

> [!IMPORTANT]
> Textura de vídeo via `texImage2D(videoElement)` só funciona se o vídeo estiver no **mesmo origin** ou CORS-habilitado. O protocolo `media://` personalizado do Electron precisa ser validado para garantir permissão de leitura de textura WebGL. Se houver restrição, a alternativa é `ImageBitmap` via `createImageBitmap(videoElement)`.

---

## Arquitetura de Shaders

O compositor WebGL2 usará **shaders minimalistas** — a complexidade fica no JS/TypeScript:

### Vertex Shader (textured quad)
```glsl
// Posiciona um quad na tela via uniformes (não precisa de VBO dinâmico)
uniform vec2 u_position;   // px, canto superior esquerdo
uniform vec2 u_size;       // px, largura/altura
uniform vec2 u_resolution; // resolução do canvas
attribute vec2 a_texCoord;
varying vec2 v_texCoord;

void main() {
  vec2 ndcPos = (u_position / u_resolution) * 2.0 - 1.0;
  vec2 ndcSize = (u_size / u_resolution) * 2.0;
  gl_Position = vec4(ndcPos + a_texCoord * ndcSize, 0, 1);
  v_texCoord = vec2(a_texCoord.x, 1.0 - a_texCoord.y); // flip Y
}
```

### Fragment Shader (textura + alpha)
```glsl
precision mediump float;
uniform sampler2D u_texture;
uniform float u_alpha;
uniform vec4 u_crop;  // sx, sy, sw, sh normalizados (0..1)
varying vec2 v_texCoord;

void main() {
  vec2 cropped = u_crop.xy + v_texCoord * u_crop.zw;
  gl_FragColor = texture2D(u_texture, cropped) * u_alpha;
}
```

---

## Proposed Changes

### Fase 1 — WebGL2 Compositor no Main Thread

> **Objetivo:** Substituir `canvas.getContext('2d')` por WebGL2, mantendo o Worker para depois.
> **Ganho:** `texImage2D` faz upload de frame de vídeo diretamente para GPU sem cópia extra de volta à CPU. Elimina o principal gargalo de FPS da webcam.
> **Risco:** Baixo. Sem mudança de threading.

---

#### [NEW] `src/lib/webgl-compositor.ts`

Módulo puro que encapsula o contexto WebGL2:

```typescript
export class WebGLCompositor {
  gl: WebGL2RenderingContext
  // Dois programas: um para vídeo (textura), um para cor sólida (background)
  videoProgram: WebGLProgram
  solidProgram: WebGLProgram
  // Cache de texturas: uma por fonte (screen, webcam, floatingMonitor-{id})
  textures: Map<string, WebGLTexture>

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas)

  // Upload de frame de vídeo para GPU (zero extra copy vs 2D drawImage)
  uploadVideoTexture(key: string, source: HTMLVideoElement | ImageBitmap): void

  // Desenha um quad texturizado (tela, webcam, monitor flutuante)
  drawTexturedQuad(opts: {
    textureKey: string
    x: number; y: number; w: number; h: number
    alpha?: number
    crop?: { x: number; y: number; w: number; h: number }
    transform?: DOMMatrix // zoom, rotação, etc.
  }): void

  // Desenha um quad de cor sólida (background)
  drawSolidQuad(color: [number, number, number, number], x: number, y: number, w: number, h: number): void

  // Blur: implementado via dois passes Gaussianos em textura offscreen
  drawBlurredRegion(region: BlurRegionSpec): void

  // Limpa o frame e prepara para nova composição
  beginFrame(): void

  // Finaliza o frame (flush / commit)
  endFrame(): void

  dispose(): void
}
```

---

#### [NEW] `src/lib/webgl-shaders.ts`

Strings GLSL compiladas:

```typescript
export const VIDEO_VERT_SHADER = `...`
export const VIDEO_FRAG_SHADER = `...`
export const SOLID_VERT_SHADER = `...`
export const SOLID_FRAG_SHADER = `...`
export const BLUR_HORIZ_FRAG_SHADER = `...`  // Fase 3
export const BLUR_VERT_FRAG_SHADER = `...`   // Fase 3
```

---

#### [MODIFY] `src/lib/renderer.ts`

Criar uma segunda assinatura pública:

```typescript
// Existente (mantido para export de vídeo — RendererPage.tsx usa canvas 2D)
export const drawScene = (ctx: CanvasRenderingContext2D, ...): void

// Novo (usado pelo Preview.tsx em modo WebGL)
export const drawSceneWebGL = (compositor: WebGLCompositor, state: RenderableState, ...): void
```

`drawSceneWebGL` replica a lógica de **layout** de `drawScene` (cálculo de posições, zoom, swap, z-index) mas substitui cada `ctx.drawImage(...)` por `compositor.drawTexturedQuad(...)`.

A lógica de layout JS permanece idêntica. Apenas as primitivas de desenho mudam.

---

#### [MODIFY] `src/components/editor/Preview.tsx`

```diff
- const ctx = canvas?.getContext('2d')
+ const compositor = useRef<WebGLCompositor | null>(null)
+ // Inicializar compositor na primeira renderização
+ if (!compositor.current && canvas) {
+   compositor.current = new WebGLCompositor(canvas)
+ }
```

```diff
- drawScene(ctx, state, video, webcamVideo, ...)
+ drawSceneWebGL(compositor.current, state, video, webcamVideo, ...)
```

A otimização `lastRenderedMainVideoFrameCountRef` é mantida — ainda evita draws redundantes.

---

### Fase 2 — OffscreenCanvas + Worker Thread

> **Objetivo:** Mover o loop de render completo para um Web Worker, liberando o main thread para React exclusivamente.
> **Ganho:** Fim definitivo de jank causado por competição com React reconciliation e IPC do Electron.
> **Pré-requisito:** Fase 1 concluída e validada.

---

#### [NEW] `src/workers/renderer.worker.ts`

```typescript
// Worker recebe o OffscreenCanvas transferido via postMessage
self.onmessage = (e) => {
  if (e.data.type === 'init') {
    const { canvas, initialState } = e.data
    compositor = new WebGLCompositor(canvas)  // OffscreenCanvas aceita WebGL2
    state = initialState
    startRenderLoop()
  }
  if (e.data.type === 'state_update') {
    // Atualiza apenas os campos do estado que mudaram (delta)
    Object.assign(state, e.data.delta)
  }
  if (e.data.type === 'video_frame') {
    // Recebe ImageBitmap (transferível, zero-copy) do frame atual
    compositor.uploadFromBitmap(e.data.key, e.data.bitmap)
    e.data.bitmap.close()
  }
}

function startRenderLoop() {
  // requestAnimationFrame não existe em Worker — usar MessageChannel trick
  // ou setTimeout(0) + performance.now() para sincronizar a 60fps
  drawSceneWebGL(compositor, state, ...)
  setTimeout(startRenderLoop, 0)
}
```

---

#### [MODIFY] `src/components/editor/Preview.tsx`

O main thread passa frames de vídeo para o Worker via `createImageBitmap`:

```typescript
// No loop rAF do main thread (já existente):
const bitmap = await createImageBitmap(videoRef.current)
workerRef.current.postMessage(
  { type: 'video_frame', key: 'screen', bitmap },
  [bitmap]  // Transferível — zero copy
)

// Transfere o canvas para o Worker na inicialização:
const offscreen = canvasRef.current.transferControlToOffscreen()
workerRef.current.postMessage({ type: 'init', canvas: offscreen, initialState: ... }, [offscreen])
```

---

#### [MODIFY] `src/lib/renderer.ts`

Garantir que `drawSceneWebGL` e todo o código de layout seja **Worker-safe** (sem `document`, sem `window`, sem `HTMLElement` diretamente). As referências de DOM são substituídas por `ImageBitmap` transferíveis.

---

### Fase 3 — Shaders Avançados

> **Objetivo:** Implementar blur, cursor overlay e transições de swap diretamente em GLSL.
> **Ganho:** Blur atual usa 6+ `drawImage` e operações de pixel em CPU. GPU Gaussian blur é ~100x mais rápido.
> **Pré-requisito:** Fase 2 concluída.

---

#### [MODIFY] `src/lib/webgl-shaders.ts`

Adicionar shaders de blur Gaussiano em dois passes (horizontal + vertical):

```glsl
// blur_frag.glsl (horizontal pass)
uniform sampler2D u_texture;
uniform float u_blurRadius;
uniform vec2 u_resolution;
// ... Kernel Gaussiano de 15 taps
```

#### [MODIFY] `src/lib/webgl-compositor.ts`

```typescript
drawBlurredRegion(opts: { x, y, w, h, radius }): void {
  // 1. Render região em framebuffer offscreen
  // 2. Aplicar blur horizontal → framebuffer intermediário
  // 3. Aplicar blur vertical → framebuffer final
  // 4. Blitar resultado na posição correta
}
```

---

## Validation Plan

### Por Fase

#### Fase 1
- Abrir editor com projeto de teste (tela + webcam).
- Confirmar que preview renderiza visualmente idêntico ao Canvas 2D atual.
- Verificar FPS via DevTools → Performance → Frame rate. Esperar: webcam ≥ 28fps constante.
- Testar: zoom regions, swap, blur regions, floating monitors, imagem de fundo.
- Testar export: `RendererPage.tsx` continua usando `drawScene` 2D — não deve ser afetado.

#### Fase 2
- Confirmar que React rendering não causa frame drops no compositor (Thread Profiler no DevTools).
- Testar `transferControlToOffscreen` no Electron/Chromium (pode ter restrições — validar antes).

#### Fase 3
- Comparar blur visual antes/depois.
- Medir tempo de render de frame com blur ativo (esperado: de ~8ms para ~0.5ms).

### Automated Tests

Não há suite de testes de renderização. Validação é visual + DevTools Performance.

### Manual Verification

```bash
# Antes de cada fase — SCC quality gate:
scc --format wide -u -a -m "recordsaas/src/lib/renderer.ts" \
    "recordsaas/src/components/editor/Preview.tsx"
```

---

## Open Questions

> [!IMPORTANT]
> **Protocolo `media://` no Electron:** O Electron usa protocolo customizado para servir os arquivos de mídia. `texImage2D(videoElement)` pode ser bloqueado por políticas CORS do WebGL. Preciso verificar o registro do protocolo antes de implementar. Se bloqueado, usamos `createImageBitmap` como intermediário (adiciona ~1ms por frame mas continua muito mais rápido que o 2D atual).

> [!IMPORTANT]
> **`RendererPage.tsx` usa `drawScene` para export de vídeo** e roda em janela separada. Esta janela não será migrada para WebGL nas Fases 1-2. A função `drawScene` original em Canvas 2D deve ser mantida intacta para export. Apenas `drawSceneWebGL` é nova.

> [!NOTE]
> `requestAnimationFrame` em Web Worker não existe nativamente. A Fase 2 precisa usar `MessageChannel` ou a API experimental `VideoFrameRequestCallback` do Chromium para sincronizar renders com o VSynk do monitor.
