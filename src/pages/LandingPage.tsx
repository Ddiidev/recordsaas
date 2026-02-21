import { useState } from 'react'
import { Video, Crown, Rocket, Settings, DeviceDesktop, PlayerPlay, PlayerPause, PlayerSkipBack, PlayerSkipForward, LayoutDashboard } from 'tabler-icons-react'
import { Button } from '../components/ui/button'

export function LandingPage({ onEnterApp }: { onEnterApp: () => void }) {
  const [isPlaying, setIsPlaying] = useState(false);

  return (
    <div className="min-h-screen w-screen bg-background text-foreground flex flex-col font-sans overflow-hidden selection:bg-primary/30">
      
      {/* Header */}
      <header 
        className="h-16 flex items-center justify-between px-6 border-b border-border bg-card/50 backdrop-blur-xl z-20"
        style={{ WebkitAppRegion: 'drag' }}
      >
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center text-primary-foreground shadow-[0_0_15px_rgba(34,197,94,0.4)]">
            <Video size={18} strokeWidth={2.5} />
          </div>
          <span className="font-heading font-bold text-lg tracking-tight">Record<span className="text-primary">SaaS</span> <span className="text-primary font-black">Pro</span></span>
        </div>
        
        <div style={{ WebkitAppRegion: 'no-drag' }} className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="hidden sm:flex" onClick={onEnterApp}>
            Sign In
          </Button>
          <Button 
            className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_4px_14px_0_rgba(34,197,94,0.39)] hover:shadow-[0_6px_20px_rgba(34,197,94,0.23)] hover:-translate-y-0.5 transition-all duration-200"
          >
            <Crown size={16} className="mr-2" /> Upgrade to Pro
          </Button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col lg:flex-row h-[calc(100vh-4rem)] relative z-10 w-full max-w-7xl mx-auto">
        
        {/* Left: Hero Marketing & CTA */}
        <div className="w-full lg:w-1/3 p-8 lg:p-12 flex flex-col justify-center border-r border-border/50 bg-card/30 backdrop-blur-md relative overflow-hidden">
          
          <div className="absolute -top-[20%] -left-[20%] w-[140%] h-[140%] bg-[radial-gradient(ellipse_at_top_left,var(--color-primary)_0%,transparent_50%)] opacity-[0.05] pointer-events-none" />

          <div className="relative z-10">
            <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary mb-6 ring-1 ring-inset ring-primary/20">
              <Rocket size={14} className="mr-1.5" /> v2.0 Unleashed
            </div>
            
            <h1 className="text-4xl lg:text-5xl font-heading font-extrabold tracking-tight leading-[1.1] mb-4 text-foreground">
              Record. Edit.<br/>
              <span className="text-transparent bg-clip-text bg-gradient-to-br from-primary to-[hsl(150,100%,35%)] drop-shadow-sm">Masterpiece.</span>
            </h1>
            
            <p className="text-muted-foreground text-sm lg:text-base leading-relaxed mb-8 max-w-[280px]">
              The premium screen recorder tailored for precise creators. Capture your screen and perfect it all in one blazing fast editor.
            </p>
            
            <div className="flex flex-col gap-3">
              <Button 
                size="lg" 
                onClick={onEnterApp}
                className="w-full justify-between group shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-shadow h-14 text-base"
              >
                <span>Launch Recorder</span>
                <DeviceDesktop size={18} className="group-hover:translate-x-1 transition-transform" />
              </Button>
              <Button size="lg" variant="outline" className="w-full h-14 border-border/80 hover:bg-muted/50 text-base">
                View Features
              </Button>
            </div>
            
            <div className="mt-8 flex items-center justify-between text-xs text-muted-foreground pt-6 border-t border-border/40">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                No watermark
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                4K Export
              </div>
            </div>
          </div>
        </div>

        {/* Right: Premium Fictional Editor App UI */}
        <div className="w-full lg:w-2/3 bg-background relative flex flex-col p-6 lg:p-8">
          
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3/4 h-3/4 bg-primary/20 blur-[120px] rounded-full pointer-events-none" />

          {/* Fictional Editor Container */}
          <div className="flex-1 flex flex-col bg-card rounded-xl border border-border shadow-2xl relative z-10 overflow-hidden ring-1 ring-white/5">
            
            {/* Editor Toolbar */}
            <div className="h-10 border-b border-border bg-muted/30 flex items-center justify-between px-3">
              <div className="flex gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-destructive/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
              </div>
              <div className="flex text-xs text-muted-foreground font-medium bg-background px-3 py-1 rounded-sm border border-border/50">
                Project_Final_v3.mp4
              </div>
              <div className="flex gap-1">
                <div className="w-6 h-6 rounded bg-background border border-border flex items-center justify-center text-muted-foreground"><Settings size={12} /></div>
                <div className="w-6 h-6 rounded bg-background border border-border flex items-center justify-center text-muted-foreground"><LayoutDashboard size={12} /></div>
              </div>
            </div>

            {/* Video Preview */}
            <div className="flex-1 p-4 flex items-center justify-center bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wMykiLz48L3N2Zz4=')]">
              <div className="w-full max-w-[500px] aspect-video bg-black rounded-lg border border-border/50 shadow-2xl overflow-hidden relative group">
                {/* Simulated Video Content */}
                <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/20 via-primary/10 to-teal-500/20 mix-blend-screen" />
                <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 to-transparent" />
                
                {/* Fake Playback Controls */}
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 backdrop-blur-md px-4 py-1.5 rounded-full border border-white/10">
                  <PlayerSkipBack size={14} className="text-white hover:text-primary cursor-pointer transition-colors" />
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white cursor-pointer hover:scale-105 transition-transform" onClick={() => setIsPlaying(!isPlaying)}>
                    {isPlaying ? <PlayerPause size={14} fill="currentColor" /> : <PlayerPlay size={14} fill="currentColor" className="ml-0.5" />}
                  </div>
                  <PlayerSkipForward size={14} className="text-white hover:text-primary cursor-pointer transition-colors" />
                  <div className="text-[10px] font-mono text-white/80 ml-2">00:01:24 / 00:03:10</div>
                </div>
              </div>
            </div>

            {/* Timeline Lanes */}
            <div className="h-48 border-t border-border bg-card/80 flex flex-col text-xs">
              
              {/* Timeline Ruler */}
              <div className="h-6 border-b border-border/50 bg-muted/40 flex items-center relative">
                <div className="absolute left-[35%] top-0 bottom-0 w-px bg-primary z-20 shadow-[0_0_8px_var(--color-primary)]">
                  <div className="absolute -top-1 -left-1.5 w-3 h-3 rotate-45 bg-primary rounded-[2px]" />
                </div>
                {/* Ruler Ticks */}
                <div className="w-full h-full flex items-end opacity-40" style={{ backgroundImage: 'linear-gradient(90deg, transparent 49%, var(--color-border) 50%, transparent 51%)', backgroundSize: '20px 50%' }} />
              </div>

              {/* Lane 1: Video */}
              <div className="flex-1 border-b border-border/30 flex items-center px-2 py-1 relative">
                <div className="w-16 flex-shrink-0 text-muted-foreground font-medium flex items-center"><Video size={12} className="mr-1.5" /> V1</div>
                <div className="flex-1 h-full relative group">
                  <div className="absolute left-[5%] right-[20%] h-[80%] top-[10%] bg-blue-500/20 border border-blue-500/40 rounded flex items-center px-2 overflow-hidden hover:border-blue-500/60 transition-colors cursor-pointer">
                    <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'linear-gradient(90deg, transparent 95%, rgba(0,0,0,0.5) 100%)', backgroundSize: '40px 100%' }} />
                    <span className="text-[10px] font-medium text-blue-200 truncate">screen_record_001.mp4</span>
                  </div>
                </div>
              </div>

              {/* Lane 2: B-Roll/Overlay */}
              <div className="flex-1 border-b border-border/30 flex items-center px-2 py-1 relative">
                <div className="w-16 flex-shrink-0 text-muted-foreground font-medium flex items-center"><Video size={12} className="mr-1.5" /> V2</div>
                <div className="flex-1 h-full relative group">
                  <div className="absolute left-[40%] right-[30%] h-[80%] top-[10%] bg-purple-500/20 border border-purple-500/40 rounded flex items-center px-2 hover:border-purple-500/60 transition-colors cursor-pointer">
                    <span className="text-[10px] font-medium text-purple-200 truncate">camera_overlay.mov</span>
                  </div>
                </div>
              </div>

              {/* Lane 3: Audio */}
              <div className="flex-1 flex items-center px-2 py-1 relative">
                <div className="w-16 flex-shrink-0 text-muted-foreground font-medium flex items-center">
                   <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
                   A1
                </div>
                <div className="flex-1 h-full relative">
                  <div className="absolute left-[5%] right-[20%] h-[80%] top-[10%] bg-green-500/15 border border-green-500/30 rounded flex items-center justify-center overflow-hidden">
                    {/* Simulated Waveform */}
                    <div className="w-full h-full opacity-60 flex items-center justify-around px-1 gap-px">
                       {[...Array(40)].map((_, i) => (
                         <div key={i} className="w-[1px] bg-green-400" style={{ height: `${Math.max(20, Math.random() * 100)}%` }} />
                       ))}
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>

      </main>
    </div>
  )
}
