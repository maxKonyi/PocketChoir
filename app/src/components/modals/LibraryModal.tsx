/* ============================================================
   LIBRARY MODAL COMPONENT
   
   Modal for selecting an arrangement from the library.
   Shows available arrangements with basic info.
   ============================================================ */

import { X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { useAppStore } from '../../stores/appStore';
import { sampleArrangements } from '../../data/arrangements';
import type { Arrangement } from '../../types';

/* ------------------------------------------------------------
   Arrangement Card Component
   ------------------------------------------------------------ */

interface ArrangementCardProps {
  arrangement: Arrangement;
  isSelected: boolean;
  onSelect: () => void;
}

function ArrangementCard({ arrangement, isSelected, onSelect }: ArrangementCardProps) {
  return (
    <button
      onClick={onSelect}
      className={`
        w-full p-4 text-left rounded-[var(--radius-md)]
        border transition-all duration-[var(--transition-fast)]
        ${isSelected 
          ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10' 
          : 'border-[var(--border-color)] bg-[var(--button-bg)] hover:bg-[var(--button-bg-hover)]'
        }
      `}
    >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-medium text-[var(--text-primary)]">
            {arrangement.title}
          </h3>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            {arrangement.description}
          </p>
        </div>
        
        {/* Difficulty indicator */}
        <div className="flex gap-0.5">
          {[1, 2, 3, 4, 5].map((level) => (
            <div
              key={level}
              className={`
                w-2 h-2 rounded-full
                ${level <= (arrangement.difficulty || 1) 
                  ? 'bg-[var(--accent-primary)]' 
                  : 'bg-[var(--button-bg)]'
                }
              `}
            />
          ))}
        </div>
      </div>
      
      {/* Metadata */}
      <div className="flex gap-4 mt-3 text-xs text-[var(--text-muted)]">
        <span>{arrangement.voices.length} voices</span>
        <span>{arrangement.bars} bars</span>
        <span>{arrangement.tempo} BPM</span>
        <span>Key: {arrangement.tonic}</span>
      </div>
      
      {/* Voice colors preview */}
      <div className="flex gap-1 mt-2">
        {arrangement.voices.map((voice) => (
          <div
            key={voice.id}
            className="w-4 h-1 rounded-full"
            style={{ backgroundColor: voice.color }}
            title={voice.name}
          />
        ))}
      </div>
    </button>
  );
}

/* ------------------------------------------------------------
   Main Modal Component
   ------------------------------------------------------------ */

export function LibraryModal() {
  // Get state and actions from store
  const isOpen = useAppStore((state) => state.isLibraryOpen);
  const currentArrangement = useAppStore((state) => state.arrangement);
  const setLibraryOpen = useAppStore((state) => state.setLibraryOpen);
  const setArrangement = useAppStore((state) => state.setArrangement);

  if (!isOpen) return null;

  /**
   * Handle selecting an arrangement.
   */
  const handleSelect = (arrangement: Arrangement) => {
    setArrangement(arrangement);
    setLibraryOpen(false);
  };

  /**
   * Handle closing the modal.
   */
  const handleClose = () => {
    setLibraryOpen(false);
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md animate-[fadeInUp_0.2s_ease-out]"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label="Select Arrangement"
    >
      <Panel 
        variant="solid"
        className="w-full max-w-2xl max-h-[80vh] m-4 flex flex-col animate-[fadeInUp_0.3s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Select Arrangement
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
          >
            <X size={18} />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid gap-3">
            {sampleArrangements.map((arrangement) => (
              <ArrangementCard
                key={arrangement.id}
                arrangement={arrangement}
                isSelected={currentArrangement?.id === arrangement.id}
                onSelect={() => handleSelect(arrangement)}
              />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--border-color)] text-xs text-[var(--text-muted)]">
          {sampleArrangements.length} arrangements available
        </div>
      </Panel>
    </div>
  );
}

export default LibraryModal;
