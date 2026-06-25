import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileImport, Folder, Loader2, Movie, Refresh, X } from '@icons'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'

type SavedProjectListItem = {
  name: string
  folderPath: string
  projectFilePath: string
  thumbnailPath?: string
  thumbnailUrl?: string
  recordedAt: string
  sizeBytes: number
  isLegacy: boolean
}

type ImportProjectModalProps = {
  isOpen: boolean
  isImporting: boolean
  onClose: () => void
  onImportProject: (projectFilePath: string) => void
  onImportManually: () => void
}

const formatProjectSize = (sizeBytes: number) => {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let unitIndex = 0
  let value = sizeBytes

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const precision = unitIndex === 0 || value >= 10 ? 0 : 1
  return `${value.toFixed(precision)} ${units[unitIndex]}`
}

export function ImportProjectModal({
  isOpen,
  isImporting,
  onClose,
  onImportProject,
  onImportManually,
}: ImportProjectModalProps) {
  const [projects, setProjects] = useState<SavedProjectListItem[]>([])
  const [rootPath, setRootPath] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [],
  )

  const formatProjectDate = useCallback(
    (value: string) => {
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? 'Unknown date' : dateFormatter.format(date)
    },
    [dateFormatter],
  )

  const loadProjects = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await window.electronAPI.listSavedProjects()
      if (!result.success) {
        setProjects([])
        setRootPath(result.rootPath || '')
        setError(result.error || 'Could not load saved projects.')
        return
      }

      setProjects(result.projects || [])
      setRootPath(result.rootPath || '')
    } catch (loadError) {
      console.error('Failed to load saved projects:', loadError)
      setProjects([])
      setError(loadError instanceof Error ? loadError.message : 'Could not load saved projects.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    void loadProjects()
  }, [isOpen, loadProjects])

  if (!isOpen) return null

  const isBusy = isLoading || isImporting

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-project-title"
        className="flex max-h-[calc(100vh-2rem)] w-[min(760px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
                <FileImport className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h2 id="import-project-title" className="text-sm font-semibold text-foreground">
                  Import Project
                </h2>
                <p className="mt-0.5 truncate text-xs text-muted-foreground" title={rootPath}>
                  {rootPath || 'RecordSaaS folder'}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-8 w-8 rounded-lg"
              onClick={() => void loadProjects()}
              disabled={isBusy}
              aria-label="Refresh projects"
            >
              <Refresh className={cn('h-4 w-4', isLoading && 'animate-spin')} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg"
              onClick={onClose}
              disabled={isBusy}
              aria-label="Close import project modal"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" /> Loading projects...
            </div>
          ) : error ? (
            <div className="flex min-h-64 flex-col items-center justify-center text-center">
              <Folder className="h-9 w-9 text-muted-foreground" />
              <p className="mt-3 max-w-sm text-sm text-muted-foreground">{error}</p>
            </div>
          ) : projects.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center text-center">
              <Folder className="h-9 w-9 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium text-foreground">No saved projects found</p>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                Saved projects will appear here after they are stored in the configured RecordSaaS folder.
              </p>
            </div>
          ) : (
            <div className="grid gap-2">
              {projects.map((project) => (
                <button
                  key={project.projectFilePath}
                  type="button"
                  className="group grid min-h-24 grid-cols-[132px_minmax(0,1fr)] gap-4 rounded-lg border border-border bg-background/70 p-2 text-left transition-colors hover:border-primary/50 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => onImportProject(project.projectFilePath)}
                  disabled={isImporting}
                >
                  <div className="relative h-20 overflow-hidden rounded-md border border-border bg-muted">
                    {project.thumbnailUrl ? (
                      <img
                        src={project.thumbnailUrl}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
                        <Movie className="h-7 w-7" />
                      </div>
                    )}
                    {project.isLegacy && (
                      <span className="absolute bottom-1 left-1 rounded-md border border-border/70 bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        Legacy
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 self-center">
                    <p className="truncate text-sm font-semibold text-foreground">{project.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatProjectDate(project.recordedAt)} · {formatProjectSize(project.sizeBytes)}
                    </p>
                    <p className="mt-2 truncate text-[11px] text-muted-foreground/80" title={project.folderPath}>
                      {project.folderPath}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/70 px-5 py-3">
          <button
            type="button"
            className="text-xs font-medium text-primary underline-offset-4 hover:underline disabled:pointer-events-none disabled:opacity-60"
            onClick={onImportManually}
            disabled={isBusy}
          >
            Import manually
          </button>
          {isImporting && (
            <div className="flex items-center text-xs text-muted-foreground">
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-primary" /> Opening project...
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
