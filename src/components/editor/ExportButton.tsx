// Primary button to trigger video export
import { Upload, Loader2 } from 'tabler-icons-react'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'

interface ExportButtonProps {
  onClick: () => void
  isExporting: boolean
  disabled?: boolean
}

export function ExportButton({ onClick, isExporting, disabled }: ExportButtonProps) {
  return (
    <Button
      onClick={onClick}
      disabled={isExporting || disabled}
      className={cn(
        'btn-clean relative overflow-hidden font-semibold px-5 h-9 rounded-lg',
        'bg-gradient-to-br from-primary via-primary to-primary/80',
        'text-primary-foreground shadow-lg',
        'before:absolute before:inset-0 before:bg-gradient-to-br before:from-white/20 before:via-transparent before:to-transparent',
        'before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-300',
        'after:absolute after:top-0 after:right-0 after:w-16 after:h-16 after:bg-white/30',
        'after:rounded-full after:blur-2xl after:opacity-40',
        'hover:shadow-xl hover:shadow-primary/30',
        'active:shadow-md',
        'transition-all duration-200',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-lg disabled:after:opacity-40',
      )}
    >
      <span className="relative z-10 flex items-center">
        {isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
        {isExporting ? 'Exporting...' : 'Export'}
      </span>
    </Button>
  )
}
