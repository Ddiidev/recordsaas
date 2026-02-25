import { useState, useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { EditorPage } from './pages/EditorPage'
import { RecorderPage } from './pages/RecorderPage'
import { RendererPage } from './pages/RendererPage'
import { useEditorStore } from './store/editorStore'

function App() {
  const [route, setRoute] = useState(window.location.hash)
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  const { mode } = useEditorStore(
    useShallow((state) => ({
      mode: state.mode,
    })),
  )
  const { initializeSettings } = useEditorStore.getState()

  useEffect(() => {
    initializeSettings()
  }, [initializeSettings])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches)
    }

    mediaQuery.addEventListener('change', onChange)
    return () => {
      mediaQuery.removeEventListener('change', onChange)
    }
  }, [])

  const effectiveMode = mode === 'auto' ? (systemPrefersDark ? 'dark' : 'light') : mode

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', 'ocean-blue')

    if (effectiveMode === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }

    window.electronAPI.updateTitleBarOverlay(
      effectiveMode === 'dark'
        ? { color: '#1D2025', symbolColor: '#EEEEEE' }
        : { color: '#F9FAFB', symbolColor: '#333333' },
    )
  }, [effectiveMode])

  useEffect(() => {
    const handleHashChange = () => {
      setRoute(window.location.hash)
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => {
      window.removeEventListener('hashchange', handleHashChange)
    }
  }, [])
  useEffect(() => {
    if (!window.location.hash) {
      window.location.hash = '#recorder'
    }
  }, [])

  if (route.startsWith('#renderer')) {
    return <RendererPage />
  }

  if (route.startsWith('#editor')) {
    return <EditorPage />
  }

  if (route.startsWith('#recorder')) {
    return <RecorderPage />
  }

  return <RecorderPage />
}

export default App
