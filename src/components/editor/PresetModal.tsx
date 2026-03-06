import { useState, useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useEditorStore } from '../../store/editorStore'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { PresetPreview } from './PresetPreview'
import type { Preset } from '../../types'
import { cn } from '../../lib/utils'
import { Plus, Trash, Check, Lock, Rectangle, BoxPadding, BorderRadius, Shadow, BorderAll } from '@icons'

interface PresetModalProps {
  isOpen: boolean
  onClose: () => void
}

export function PresetModal({ isOpen, onClose }: PresetModalProps) {
  const { presets, activePresetId, applyPreset, saveCurrentStyleAsPreset, deletePreset, updatePresetName } =
    useEditorStore(
      useShallow((state) => ({
        presets: state.presets,
        activePresetId: state.activePresetId,
        applyPreset: state.applyPreset,
        saveCurrentStyleAsPreset: state.saveCurrentStyleAsPreset,
        deletePreset: state.deletePreset,
        updatePresetName: state.updatePresetName,
      })),
    )

  const [previewId, setPreviewId] = useState<string | null>(activePresetId)
  const [newPresetName, setNewPresetName] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  // Reset previewId when modal is opened or active preset changes
  useEffect(() => {
    if (isOpen) {
      setPreviewId(activePresetId)
    }
  }, [isOpen, activePresetId])

  const defaultPreset = Object.values(presets).find((p) => p.isDefault)

  useEffect(() => {
    if (isOpen && !activePresetId && defaultPreset) {
      setPreviewId(defaultPreset.id)
    }
  }, [isOpen, activePresetId, defaultPreset])

  if (!isOpen) return null

  const presetList = Object.values(presets)
  const previewPreset = previewId ? presets[previewId] : defaultPreset || null

  const handleSaveNew = () => {
    if (newPresetName.trim()) {
      saveCurrentStyleAsPreset(newPresetName.trim())
      setNewPresetName('')
    }
  }

  const handleDoubleClick = (preset: Preset) => {
    if (!preset.isDefault) {
      setEditingId(preset.id)
      setEditingName(preset.name)
    }
  }

  const handleRename = () => {
    if (editingId && editingName.trim()) {
      updatePresetName(editingId, editingName.trim())
    }
    setEditingId(null)
    setEditingName('')
  }

  const cancelRename = () => {
    setEditingId(null)
    setEditingName('')
  }

  const handleSelect = () => {
    if (previewId) {
      applyPreset(previewId)
      onClose()
    }
  }

  const handleDelete = (idToDelete: string) => {
    deletePreset(idToDelete)
    if (previewId === idToDelete) {
      setPreviewId(defaultPreset?.id || null)
    }
  }

  return (
    <div className="modal-backdrop z-50 flex items-center justify-center backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="w-full max-w-5xl h-[85vh] max-h-[800px] flex flex-col m-4 shadow-2xl rounded-xl bg-card border border-border overflow-hidden relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative p-6 border-b border-border flex-shrink-0 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent">
          {window.process?.platform !== 'darwin' && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="absolute top-4 right-4 w-8 h-8 rounded-lg text-muted-foreground hover:bg-destructive hover:text-white transition-colors z-50"
            >
              <span className="sr-only">Close</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </Button>
          )}
          <h2 className="text-xl font-bold text-foreground mb-1">Manage Presets</h2>
          <p className="text-sm text-muted-foreground">Select, create, or delete your frame style presets.</p>
        </div>

        <div className="flex-1 flex flex-row overflow-hidden">
          <div className="w-1/3 border-r border-border p-5 flex flex-col bg-muted/20">
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-2 custom-scrollbar">
              {presetList.map((p) =>
                editingId === p.id ? (
                  <div key={p.id} className="p-1">
                    <Input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={handleRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename()
                        if (e.key === 'Escape') cancelRename()
                      }}
                      autoFocus
                      className="h-10"
                    />
                  </div>
                ) : (
                  <button
                    key={p.id}
                    onClick={() => setPreviewId(p.id)}
                    onDoubleClick={() => handleDoubleClick(p)}
                    className={cn(
                      'w-full text-left px-4 py-3 rounded-lg flex items-center justify-between transition-all duration-200',
                      previewId === p.id
                        ? 'bg-primary/15 text-primary shadow-sm border border-primary/20'
                        : 'text-foreground hover:bg-accent/60 hover:shadow-sm',
                    )}
                  >
                    <span className="font-medium flex items-center gap-2">
                      {p.name}
                      {p.isDefault && <Lock className="w-3.5 h-3.5 text-muted-foreground" />}
                    </span>
                    {activePresetId === p.id && <Check className="w-4 h-4 text-primary" />}
                  </button>
                ),
              )}
            </div>
            <div className="pt-4 border-t border-border mt-3 space-y-2">
              <Input
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                placeholder="New preset name..."
                className="h-10"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newPresetName.trim()) handleSaveNew()
                }}
              />
              <Button
                size="sm"
                onClick={handleSaveNew}
                disabled={!newPresetName.trim()}
                className="w-full h-10 font-medium shadow-sm"
              >
                <Plus className="w-4 h-4 mr-2" /> Save Current Style
              </Button>
            </div>
          </div>

          <div className="w-2/3 p-6 bg-background flex flex-col">
            {previewPreset ? (
              <div className="w-full flex flex-col h-full">
                <div className="flex items-center justify-between mb-5 flex-shrink-0">
                  <h3 className="text-lg text-foreground font-semibold flex items-center gap-2.5">
                    {previewPreset.name}
                    {previewPreset.isDefault && <Lock className="w-4 h-4 text-muted-foreground" />}
                  </h3>
                  {!previewPreset.isDefault && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(previewPreset.id)}
                      className="h-9 shadow-sm"
                    >
                      <Trash className="w-4 h-4 mr-2" /> Delete
                    </Button>
                  )}
                </div>

                <div className="flex-1 flex items-center justify-center min-h-0 p-4">
                  <PresetPreview
                    styles={previewPreset.styles}
                    aspectRatio={previewPreset.aspectRatio}
                    isWebcamVisible={previewPreset.isWebcamVisible}
                    webcamLayout={previewPreset.webcamLayout}
                    webcamPosition={previewPreset.webcamPosition}
                    webcamStyles={previewPreset.webcamStyles}
                  />
                </div>

                <div className="flex-shrink-0 flex items-center justify-center flex-wrap gap-x-6 gap-y-2 mt-5 pt-5 border-t border-border/30">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
                    <Rectangle className="w-4 h-4" />
                    <span>{previewPreset.aspectRatio}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
                    <BoxPadding className="w-4 h-4" />
                    <span>{previewPreset.styles.padding}%</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
                    <BorderRadius className="w-4 h-4" />
                    <span>{previewPreset.styles.borderRadius}px</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
                    <Shadow className="w-4 h-4" />
                    <span>{previewPreset.styles.shadowBlur}px</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
                    <BorderAll className="w-4 h-4" />
                    <span>{previewPreset.styles.borderWidth}px</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-muted-foreground">Select a preset to preview</p>
              </div>
            )}
          </div>
        </div>

        <div className="p-5 border-t border-border flex justify-end gap-3 flex-shrink-0 bg-card">
          <Button variant="secondary" onClick={onClose} className="h-10 px-6 shadow-sm">
            Cancel
          </Button>
          <Button onClick={handleSelect} disabled={!previewId} className="h-10 px-6 font-medium shadow-sm">
            Select Preset
          </Button>
        </div>
      </div>
    </div>
  )
}
