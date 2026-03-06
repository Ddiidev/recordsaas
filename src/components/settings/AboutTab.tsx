import { useState, useEffect } from 'react'
import { Button } from '../ui/button'
import { BrandGithub } from '@icons'

export function AboutTab() {
  const [appVersion, setAppVersion] = useState('...')

  useEffect(() => {
    // Fetch the app version from the main process
    window.electronAPI.getVersion().then((version) => {
      setAppVersion(version)
    })
  }, [])

  const openLink = (url: string) => {
    window.electronAPI.openExternal(url)
  }

  return (
    <div className="p-8 text-center flex flex-col items-center justify-center h-full">
      <img src="media://recordsaas-appicon.png" alt="RecordSaaS Logo" className="w-24 h-24 mb-4 rounded-3xl shadow-lg" />
      <h2 className="text-2xl font-bold text-foreground">Record<span className="text-primary">SaaS</span></h2>
      <p className="text-sm text-muted-foreground mb-6">Version {appVersion}</p>

      <div className="text-sm text-foreground space-y-4">
        <div>
          <p className="font-semibold text-primary text-base">Modified by André Luiz</p>
          <p className="text-xs text-muted-foreground mt-1">
            Original creation with ❤️ by Tam Nguyen.
          </p>
        </div>
        <p className="text-sm max-w-sm mx-auto">
          A modern screen recorder and editor designed to be simple and powerful.
        </p>
      </div>

      <div className="mt-8 flex flex-col items-center gap-3 w-full max-w-[240px] px-4">
        <Button className="w-full shadow-sm" onClick={() => openLink('https://github.com/Ddiidev/recordsaas')}>
          <BrandGithub className="w-4 h-4 mr-2" />
          André Luiz's Repository
        </Button>
        <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground hover:text-foreground" onClick={() => openLink('https://github.com/tamnguyenvan/screenarc')}>
          <BrandGithub className="w-3 h-3 mr-2" />
          Original Repository
        </Button>
      </div>

      <p className="absolute bottom-4 text-xs text-muted-foreground opacity-60">Built with Electron, React, and TypeScript.</p>
    </div>
  )
}
