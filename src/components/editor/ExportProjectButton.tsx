import { Folder, Loader2 } from '@icons'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'

interface ExportProjectButtonProps {
  onClick: () => void
  isExporting: boolean
  disabled?: boolean
  isImportedProject?: boolean
}

export function ExportProjectButton({ onClick, isExporting, disabled, isImportedProject }: ExportProjectButtonProps) {
  return (
    <Button
      onClick={onClick}
      disabled={disabled || isExporting}
      variant="secondary"
      size="sm"
      className={cn(
        'btn-clean relative overflow-hidden font-semibold px-4 h-9 rounded-lg border-2',
        'border-primary/50 text-primary hover:bg-primary/10 transition-colors',
        'disabled:opacity-50 disabled:cursor-not-allowed'
      )}
    >
      <span className="relative z-10 flex items-center">
        {isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Folder className="w-4 h-4 mr-2" />}
        {isExporting ? 'Saving...' : (isImportedProject ? 'Save' : 'Export Project')}
      </span>
    </Button>
  )
}
