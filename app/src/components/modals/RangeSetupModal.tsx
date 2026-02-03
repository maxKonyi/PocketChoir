/* ============================================================
   RANGE SETUP MODAL
   
   Modal for setting the user's vocal range.
   Used for transposition suggestions and display.
   ============================================================ */

import { useState } from 'react';
import { X, Music } from 'lucide-react';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { useAppStore } from '../../stores/appStore';

/* ------------------------------------------------------------
   Note options for range selection
   ------------------------------------------------------------ */

const NOTE_OPTIONS = [
  'C2', 'D2', 'E2', 'F2', 'G2', 'A2', 'B2',
  'C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3',
  'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4',
  'C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5',
  'C6',
];

/* ------------------------------------------------------------
   Component
   ------------------------------------------------------------ */

export function RangeSetupModal() {
  // Get state and actions from store
  const isOpen = useAppStore((state) => state.isRangeSetupOpen);
  const vocalRange = useAppStore((state) => state.vocalRange);
  const setRangeSetupOpen = useAppStore((state) => state.setRangeSetupOpen);
  const setVocalRange = useAppStore((state) => state.setVocalRange);

  // Local state
  const [lowNote, setLowNote] = useState(vocalRange.lowNote);
  const [highNote, setHighNote] = useState(vocalRange.highNote);

  /**
   * Handle save.
   */
  const handleSave = () => {
    setVocalRange({ lowNote, highNote });
    setRangeSetupOpen(false);
  };

  /**
   * Handle close.
   */
  const handleClose = () => {
    // Reset to current values
    setLowNote(vocalRange.lowNote);
    setHighNote(vocalRange.highNote);
    setRangeSetupOpen(false);
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleClose}
    >
      <Panel 
        variant="solid"
        className="w-full max-w-md m-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <Music size={20} className="text-[var(--accent-primary)]" />
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              Vocal Range
            </h2>
          </div>
          <Button variant="ghost" size="icon" onClick={handleClose}>
            <X size={18} />
          </Button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-6">
          <p className="text-sm text-[var(--text-secondary)]">
            Set your comfortable singing range. This helps with transposition suggestions.
          </p>

          {/* Low note */}
          <div className="space-y-2">
            <label className="text-sm text-[var(--text-secondary)]">
              Lowest Note
            </label>
            <select
              value={lowNote}
              onChange={(e) => setLowNote(e.target.value)}
              className="
                w-full px-3 py-2
                bg-[var(--button-bg)]
                border border-[var(--border-color)]
                rounded-lg
                text-[var(--text-primary)]
              "
            >
              {NOTE_OPTIONS.map((note) => (
                <option key={note} value={note}>{note}</option>
              ))}
            </select>
          </div>

          {/* High note */}
          <div className="space-y-2">
            <label className="text-sm text-[var(--text-secondary)]">
              Highest Note
            </label>
            <select
              value={highNote}
              onChange={(e) => setHighNote(e.target.value)}
              className="
                w-full px-3 py-2
                bg-[var(--button-bg)]
                border border-[var(--border-color)]
                rounded-lg
                text-[var(--text-primary)]
              "
            >
              {NOTE_OPTIONS.map((note) => (
                <option key={note} value={note}>{note}</option>
              ))}
            </select>
          </div>

          {/* Range visualization */}
          <div className="p-4 bg-[var(--button-bg)] rounded-lg">
            <div className="text-center">
              <span className="text-2xl font-bold text-[var(--accent-primary)]">
                {lowNote}
              </span>
              <span className="text-[var(--text-muted)] mx-2">to</span>
              <span className="text-2xl font-bold text-[var(--accent-secondary)]">
                {highNote}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--border-color)] flex justify-end gap-2">
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave}>
            Save
          </Button>
        </div>
      </Panel>
    </div>
  );
}

export default RangeSetupModal;
