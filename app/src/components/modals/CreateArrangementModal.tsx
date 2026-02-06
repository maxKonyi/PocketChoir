/* ============================================================
   CREATE ARRANGEMENT MODAL
   
   Modal for creating a new arrangement in Create mode.
   Allows setting: title, tempo, key, time signature, bars, voices
   ============================================================ */

import { useState } from 'react';
import { X, Plus, Trash2, Music } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import type { Arrangement, ScaleType } from '../../types';

/* ------------------------------------------------------------
   Constants
   ------------------------------------------------------------ */

// Available keys for selection
const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Available scales
const SCALES: ScaleType[] = ['major', 'minor', 'dorian', 'mixolydian'];

// Default voice colors (neon palette)
const VOICE_COLORS = [
  '#ff6b9d', // Pink
  '#4ecdc4', // Cyan
  '#ffe66d', // Yellow
  '#ff8c42', // Orange
  '#a78bfa', // Purple
  '#34d399', // Green
];

/* ------------------------------------------------------------
   Types
   ------------------------------------------------------------ */

interface DraftVoice {
  id: string;
  name: string;
  color: string;
}

/* ------------------------------------------------------------
   Component
   ------------------------------------------------------------ */

export function CreateArrangementModal() {
  // Get state and actions from store
  const isOpen = useAppStore((state) => state.mode === 'create' && state.isCreateModalOpen);
  const setCreateModalOpen = useAppStore((state) => state.setCreateModalOpen);
  const setArrangement = useAppStore((state) => state.setArrangement);
  const setMode = useAppStore((state) => state.setMode);

  // Form state
  const [title, setTitle] = useState('New Arrangement');
  const [tempo, setTempo] = useState(80);
  const [tonic, setTonic] = useState('C');
  const [scale, setScale] = useState<ScaleType>('major');
  const [bars, setBars] = useState(4);
  const [timeSigNum, setTimeSigNum] = useState(4);
  const [timeSigDen, setTimeSigDen] = useState(4);
  const [voices, setVoices] = useState<DraftVoice[]>([
    { id: 'v1', name: 'Voice 1', color: VOICE_COLORS[0] },
  ]);

  // Don't render if not open
  if (!isOpen) return null;

  /**
   * Add a new voice to the arrangement.
   */
  const handleAddVoice = () => {
    if (voices.length >= 6) return; // Max 6 voices
    
    const newId = `v${voices.length + 1}`;
    const newColor = VOICE_COLORS[voices.length % VOICE_COLORS.length];
    
    setVoices([
      ...voices,
      { id: newId, name: `Voice ${voices.length + 1}`, color: newColor },
    ]);
  };

  /**
   * Remove a voice from the arrangement.
   */
  const handleRemoveVoice = (id: string) => {
    if (voices.length <= 1) return; // Must have at least 1 voice
    setVoices(voices.filter((v) => v.id !== id));
  };

  /**
   * Update a voice's name.
   */
  const handleVoiceNameChange = (id: string, name: string) => {
    setVoices(voices.map((v) => (v.id === id ? { ...v, name } : v)));
  };

  /**
   * Create the arrangement and start editing.
   */
  const handleCreate = () => {
    // Generate unique ID
    const id = `arr_custom_${Date.now()}`;
    
    // Create empty arrangement with specified parameters
    const arrangement: Arrangement = {
      id,
      title,
      description: 'Custom arrangement',
      tempo,
      timeSig: { numerator: timeSigNum, denominator: timeSigDen },
      bars,
      tonic,
      scale,
      difficulty: 1,
      tags: ['custom'],
      voices: voices.map((v) => ({
        id: v.id,
        name: v.name,
        color: v.color,
        nodes: [], // Start with no nodes - user will add them
      })),
      // Start with no chord blocks in Create mode.
      // The Grid will show an "Enable Chord Track" prompt that can populate defaults.
      chords: [],
    };

    // Set the arrangement and close modal
    setArrangement(arrangement);
    setCreateModalOpen(false);
  };

  /**
   * Cancel and close modal.
   */
  const handleCancel = () => {
    setCreateModalOpen(false);
    setMode('play');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center animate-[fadeInUp_0.2s_ease-out]"
      role="dialog"
      aria-modal="true"
      aria-label="Create Arrangement"
    >
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-md"
        onClick={handleCancel}
      />

      {/* Modal */}
      <div className="
        relative z-10 w-full max-w-lg
        bg-[var(--bg-secondary)]/95 backdrop-blur-xl rounded-2xl
        border border-[var(--border-color)]
        shadow-[0_20px_60px_rgba(0,0,0,0.5)]
        animate-[fadeInUp_0.3s_ease-out]
      ">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <Music className="text-[var(--accent-primary)]" size={20} />
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              Create New Arrangement
            </h2>
          </div>
          <button
            onClick={handleCancel}
            className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Title */}
          <div>
            <label className="block text-sm text-[var(--text-secondary)] mb-1">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="
                w-full px-3 py-2 rounded-lg
                bg-[var(--button-bg)] text-[var(--text-primary)]
                border border-[var(--border-color)]
                focus:outline-none focus:border-[var(--accent-primary)]
              "
            />
          </div>

          {/* Tempo and Key row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-1">
                Tempo (BPM)
              </label>
              <input
                type="number"
                value={tempo}
                onChange={(e) => setTempo(Math.max(40, Math.min(200, parseInt(e.target.value) || 80)))}
                className="
                  w-full px-3 py-2 rounded-lg
                  bg-[var(--button-bg)] text-[var(--text-primary)]
                  border border-[var(--border-color)]
                  focus:outline-none focus:border-[var(--accent-primary)]
                "
              />
            </div>
            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-1">
                Key
              </label>
              <div className="flex gap-2">
                <select
                  value={tonic}
                  onChange={(e) => setTonic(e.target.value)}
                  className="
                    flex-1 px-3 py-2 rounded-lg
                    bg-[var(--button-bg)] text-[var(--text-primary)]
                    border border-[var(--border-color)]
                    cursor-pointer
                  "
                >
                  {KEYS.map((key) => (
                    <option key={key} value={key}>{key}</option>
                  ))}
                </select>
                <select
                  value={scale}
                  onChange={(e) => setScale(e.target.value as ScaleType)}
                  className="
                    flex-1 px-3 py-2 rounded-lg
                    bg-[var(--button-bg)] text-[var(--text-primary)]
                    border border-[var(--border-color)]
                    cursor-pointer
                  "
                >
                  {SCALES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Bars and Time Signature */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-1">
                Number of Bars
              </label>
              <input
                type="number"
                value={bars}
                onChange={(e) => setBars(Math.max(1, Math.min(32, parseInt(e.target.value) || 4)))}
                className="
                  w-full px-3 py-2 rounded-lg
                  bg-[var(--button-bg)] text-[var(--text-primary)]
                  border border-[var(--border-color)]
                  focus:outline-none focus:border-[var(--accent-primary)]
                "
              />
            </div>
            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-1">
                Time Signature
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={timeSigNum}
                  onChange={(e) => setTimeSigNum(parseInt(e.target.value))}
                  className="
                    w-16 px-3 py-2 rounded-lg
                    bg-[var(--button-bg)] text-[var(--text-primary)]
                    border border-[var(--border-color)]
                    cursor-pointer
                  "
                >
                  {[2, 3, 4, 5, 6, 7].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <span className="text-[var(--text-muted)]">/</span>
                <select
                  value={timeSigDen}
                  onChange={(e) => setTimeSigDen(parseInt(e.target.value))}
                  className="
                    w-16 px-3 py-2 rounded-lg
                    bg-[var(--button-bg)] text-[var(--text-primary)]
                    border border-[var(--border-color)]
                    cursor-pointer
                  "
                >
                  {[2, 4, 8].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Voices */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-[var(--text-secondary)]">
                Voices ({voices.length}/6)
              </label>
              <button
                onClick={handleAddVoice}
                disabled={voices.length >= 6}
                className="
                  flex items-center gap-1 px-2 py-1 rounded-lg text-xs
                  bg-[var(--accent-primary)] text-white
                  hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed
                "
              >
                <Plus size={12} />
                Add Voice
              </button>
            </div>
            
            <div className="space-y-2">
              {voices.map((voice) => (
                <div 
                  key={voice.id}
                  className="flex items-center gap-2 p-2 rounded-lg bg-white/5"
                >
                  {/* Color indicator */}
                  <div 
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: voice.color }}
                  />
                  
                  {/* Name input */}
                  <input
                    type="text"
                    value={voice.name}
                    onChange={(e) => handleVoiceNameChange(voice.id, e.target.value)}
                    className="
                      flex-1 px-2 py-1 rounded
                      bg-transparent text-[var(--text-primary)] text-sm
                      border border-transparent
                      focus:outline-none focus:border-[var(--border-color)]
                    "
                  />
                  
                  {/* Delete button */}
                  <button
                    onClick={() => handleRemoveVoice(voice.id)}
                    disabled={voices.length <= 1}
                    className="
                      p-1 rounded text-[var(--text-muted)]
                      hover:text-red-400 hover:bg-red-500/10
                      disabled:opacity-30 disabled:cursor-not-allowed
                    "
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-[var(--border-color)]">
          <button
            onClick={handleCancel}
            className="
              px-4 py-2 rounded-lg
              bg-[var(--button-bg)] text-[var(--text-secondary)]
              hover:bg-[var(--button-bg-hover)] hover:text-[var(--text-primary)]
            "
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            className="
              px-4 py-2 rounded-lg
              bg-[var(--accent-primary)] text-white
              hover:brightness-110
            "
          >
            Create & Edit
          </button>
        </div>
      </div>
    </div>
  );
}

export default CreateArrangementModal;
