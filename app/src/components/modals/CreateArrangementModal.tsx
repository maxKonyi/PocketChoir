/* ============================================================
   CREATE ARRANGEMENT MODAL
   
   Modal for creating a new arrangement in Create mode.
   Allows setting: title, tempo, key, time signature, bars, voices
   ============================================================ */

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { X, Plus, Trash2, Music, Upload, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useAppStore, MAX_VOICES } from '../../stores/appStore';
import type { Arrangement, Node, ScaleType } from '../../types';
import { DEFAULT_VOICE_COLORS } from '../../utils/colors';
import { parseMidiFileToPreview, type MidiImportPreview } from '../../utils/midiImport';

/* ------------------------------------------------------------
   Constants
   ------------------------------------------------------------ */

// Available keys for selection
const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Available scales
const SCALES: ScaleType[] = ['major', 'minor', 'dorian', 'mixolydian', 'chromatic'];

// Default voice colors (neon palette)
const VOICE_COLORS = DEFAULT_VOICE_COLORS.map((entry) => entry.color);

/* ------------------------------------------------------------
   Types
   ------------------------------------------------------------ */

interface DraftVoice {
  id: string;
  name: string;
  color: string;
  nodes: Node[];
}

/* ------------------------------------------------------------
   Component
   ------------------------------------------------------------ */

export function CreateArrangementModal() {
  // Get state and actions from store
  const isOpen = useAppStore((state) => state.mode === 'create' && state.isCreateModalOpen);
  const createModalMode = useAppStore((state) => state.createModalMode);
  const arrangement = useAppStore((state) => state.arrangement);
  const setCreateModalOpen = useAppStore((state) => state.setCreateModalOpen);
  const setArrangement = useAppStore((state) => state.setArrangement);
  const updateArrangementParams = useAppStore((state) => state.updateArrangementParams);
  const setMode = useAppStore((state) => state.setMode);

  const isEditing = createModalMode === 'edit' && !!arrangement;

  // Form state
  const [title, setTitle] = useState('New Arrangement');
  const [description, setDescription] = useState('');
  const [difficulty, setDifficulty] = useState(1);
  const [tempoText, setTempoText] = useState('80');
  const [tonic, setTonic] = useState('C');
  const [scale, setScale] = useState<ScaleType>('major');
  const [bars, setBars] = useState(4);
  const [timeSigNum, setTimeSigNum] = useState(4);
  const [timeSigDen, setTimeSigDen] = useState(4);
  const [voices, setVoices] = useState<DraftVoice[]>([
    { id: 'v1', name: 'Voice 1', color: VOICE_COLORS[0], nodes: [] },
  ]);
  const [midiPreview, setMidiPreview] = useState<MidiImportPreview | null>(null);
  const [midiSelectedTracks, setMidiSelectedTracks] = useState<number[]>([]);
  const [isParsingMidi, setIsParsingMidi] = useState(false);
  const [isMidiReviewOpen, setIsMidiReviewOpen] = useState(false);
  const [midiError, setMidiError] = useState<string | null>(null);
  const [hasImportedMidiVoices, setHasImportedMidiVoices] = useState(false);

  const midiInputRef = useRef<HTMLInputElement | null>(null);

  // When the modal opens, initialize the form:
  // - Create mode: use defaults
  // - Edit mode: pre-fill from the current arrangement
  useEffect(() => {
    if (!isOpen) return;

    if (isEditing && arrangement) {
      setTitle(arrangement.title);
      setDescription(arrangement.description || '');
      setDifficulty(arrangement.difficulty || 1);
      setTempoText(String(arrangement.tempo));
      setTonic(arrangement.tonic);
      setScale(arrangement.scale);
      setBars(arrangement.bars);
      setTimeSigNum(arrangement.timeSig.numerator);
      setTimeSigDen(arrangement.timeSig.denominator);

      // We keep the voices UI in sync so the form always reflects the arrangement,
      // even though editing voices is not the main goal of the "edit params" flow.
      setVoices(arrangement.voices.map((v) => ({ id: v.id, name: v.name, color: v.color, nodes: [...v.nodes] })));
      return;
    }

    // Defaults for creating a new arrangement
    setTitle('New Arrangement');
    setDescription('');
    setDifficulty(1);
    setTempoText('80');
    setTonic('C');
    setScale('major');
    setBars(4);
    setTimeSigNum(4);
    setTimeSigDen(4);
    setVoices([{ id: 'v1', name: 'Voice 1', color: VOICE_COLORS[0], nodes: [] }]);
    setMidiPreview(null);
    setMidiSelectedTracks([]);
    setIsParsingMidi(false);
    setIsMidiReviewOpen(false);
    setMidiError(null);
    setHasImportedMidiVoices(false);

    if (midiInputRef.current) {
      midiInputRef.current.value = '';
    }
  }, [isOpen, isEditing, arrangement?.id]);

  /**
   * Parse + clamp tempo text into a valid BPM number.
   * We do this on blur and on save/create so the input doesn't "fight" the user's typing.
   */
  const parseTempo = (text: string, fallback: number) => {
    const n = parseInt(text, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(40, Math.min(240, n));
  };

  // Don't render if not open
  if (!isOpen) return null;

  /**
   * Add a new voice to the arrangement.
   */
  const handleAddVoice = () => {
    if (voices.length >= MAX_VOICES) return; // Max 6 voices

    const newId = `v${voices.length + 1}`;
    const newColor = VOICE_COLORS[voices.length % VOICE_COLORS.length];

    setVoices([
      ...voices,
      { id: newId, name: `Voice ${voices.length + 1}`, color: newColor, nodes: [] },
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

  const handleMidiFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setMidiError(null);
    setIsParsingMidi(true);

    try {
      const preview = await parseMidiFileToPreview(file);
      const defaultSelected = preview.tracks
        .filter((track) => track.selectedByDefault)
        .map((track) => track.trackIndex);

      setMidiPreview(preview);
      setMidiSelectedTracks(defaultSelected);
      setIsMidiReviewOpen(true);

      // Helpful defaults after MIDI parse, so user starts from the source file's timing.
      setTempoText(String(preview.tempoBpm));
      setBars(preview.totalBars);
      setTimeSigNum(preview.timeSigNumerator);
      setTimeSigDen(preview.timeSigDenominator);
      setTonic(preview.tonic);
      setScale(preview.scale);

      if (title.trim() === '' || title.trim() === 'New Arrangement') {
        setTitle(preview.titleSuggestion);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not parse this MIDI file.';
      setMidiError(message);
      setMidiPreview(null);
      setMidiSelectedTracks([]);
      setIsMidiReviewOpen(false);
    } finally {
      setIsParsingMidi(false);
    }
  };

  const handleToggleMidiTrack = (trackIndex: number) => {
    const isSelected = midiSelectedTracks.includes(trackIndex);

    if (isSelected) {
      setMidiSelectedTracks(midiSelectedTracks.filter((index) => index !== trackIndex));
      return;
    }

    if (midiSelectedTracks.length >= MAX_VOICES) {
      setMidiError('You can select up to 6 tracks. Deselect one first.');
      return;
    }

    setMidiSelectedTracks([...midiSelectedTracks, trackIndex]);
    setMidiError(null);
  };

  const handleConfirmMidiImport = () => {
    if (!midiPreview) return;

    const selectedTracks = midiPreview.tracks
      .filter((track) => track.importable && midiSelectedTracks.includes(track.trackIndex))
      .slice(0, MAX_VOICES);

    if (selectedTracks.length === 0) {
      setMidiError('Select at least one importable track.');
      return;
    }

    const importedVoices: DraftVoice[] = selectedTracks.map((track, index) => ({
      id: `v${index + 1}`,
      name: track.name || `Voice ${index + 1}`,
      color: VOICE_COLORS[index % VOICE_COLORS.length],
      nodes: [...track.nodes],
    }));

    setVoices(importedVoices);
    setHasImportedMidiVoices(true);
    setIsMidiReviewOpen(false);
  };

  /**
   * Create the arrangement and start editing.
   */
  const handleCreate = () => {
    // Generate unique ID
    const id = `arr_custom_${Date.now()}`;

    const tempo = parseTempo(tempoText, 80);

    // Create empty arrangement with specified parameters
    const arrangement: Arrangement = {
      id,
      title,
      description,
      tempo,
      timeSig: { numerator: timeSigNum, denominator: timeSigDen },
      bars,
      tonic,
      scale,
      difficulty,
      tags: hasImportedMidiVoices ? ['custom', 'midi-import'] : ['custom'],
      voices: voices.map((v) => ({
        id: v.id,
        name: v.name,
        color: v.color,
        // Keep only nodes within the selected arrangement length.
        nodes: v.nodes
          .filter((node) => node.t16 <= bars * timeSigNum * 4)
          .sort((a, b) => a.t16 - b.t16),
      })),
      // Start with no chord blocks in Create mode.
      // The Grid will show an "Enable Chord Track" prompt that can populate defaults.
      chords: [],
    };

    // Set the arrangement and close modal
    setArrangement(arrangement);
    setCreateModalOpen(false);
  };

  const handleSaveEdits = () => {
    if (!arrangement) return;

    const tempo = parseTempo(tempoText, arrangement.tempo);

    updateArrangementParams({
      title,
      description,
      difficulty,
      tempo,
      tonic,
      scale,
      bars,
      timeSig: { numerator: timeSigNum, denominator: timeSigDen },
    });

    setCreateModalOpen(false);
  };

  /**
   * Cancel and close modal.
   */
  const handleCancel = () => {
    setCreateModalOpen(false);

    // If the user is canceling a *new* arrangement, we exit Create mode.
    // If they were just editing params, we keep them in Create mode.
    if (!isEditing) {
      setMode('play');
    }
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
              {isEditing ? 'Edit Arrangement' : 'Create New Arrangement'}
            </h2>
          </div>

          {/* MIDI upload (Create mode only) */}
          {!isEditing && (
            <div className="rounded-xl border border-[var(--border-color)] bg-white/5 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-[var(--text-primary)] font-medium">Import from MIDI (.mid)</p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Upload a monophonic-per-track MIDI and map tracks into voices.
                  </p>
                </div>
                <button
                  onClick={() => midiInputRef.current?.click()}
                  disabled={isParsingMidi}
                  className="
                    inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                    bg-[var(--accent-primary)] text-white
                    hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed
                  "
                >
                  <Upload size={13} />
                  {isParsingMidi ? 'Parsing...' : 'Upload MIDI'}
                </button>
              </div>

              <input
                ref={midiInputRef}
                type="file"
                accept=".mid,.midi,audio/midi,audio/x-midi"
                onChange={(e) => { void handleMidiFileSelected(e); }}
                className="hidden"
              />

              {midiPreview && (
                <div className="text-xs text-[var(--text-secondary)] bg-black/20 rounded-lg px-2.5 py-2">
                  <p>
                    Loaded: <span className="text-[var(--text-primary)]">{midiPreview.fileName}</span>
                  </p>
                  <p>
                    Selected tracks: <span className="text-[var(--text-primary)]">{voices.length}</span>
                  </p>
                </div>
              )}

              {midiError && (
                <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-2">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{midiError}</span>
                </div>
              )}
            </div>
          )}
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

          <div className="grid grid-cols-2 gap-4">
            {/* Description */}
            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-1">
                Description
              </label>
              <input
                type="text"
                value={description}
                maxLength={60}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
                className="
                  w-full px-3 py-2 rounded-lg
                  bg-[var(--button-bg)] text-[var(--text-primary)]
                  border border-[var(--border-color)]
                  focus:outline-none focus:border-[var(--accent-primary)]
                "
              />
            </div>

            {/* Difficulty */}
            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-1">
                Difficulty
              </label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(parseInt(e.target.value, 10))}
                className="
                  w-full px-3 py-2 rounded-lg
                  bg-[var(--button-bg)] text-[var(--text-primary)]
                  border border-[var(--border-color)]
                  cursor-pointer
                "
              >
                {[1, 2, 3, 4, 5].map((level) => (
                  <option key={level} value={level}>{level} - {['Novice', 'Beginner', 'Intermediate', 'Advanced', 'Expert'][level - 1]}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Tempo and Key row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[var(--text-secondary)] mb-1">
                Tempo (BPM)
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={tempoText}
                onChange={(e) => setTempoText(e.target.value)}
                onBlur={() => {
                  const fallback = arrangement?.tempo ?? 80;
                  setTempoText(String(parseTempo(tempoText, fallback)));
                }}
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
          {!isEditing && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-[var(--text-secondary)]">
                  Voices ({voices.length}/{MAX_VOICES})
                </label>
                <button
                  onClick={handleAddVoice}
                  disabled={voices.length >= MAX_VOICES}
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
          )}
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
            onClick={isEditing ? handleSaveEdits : handleCreate}
            className="
              px-4 py-2 rounded-lg
              bg-[var(--accent-primary)] text-white
              hover:brightness-110
            "
          >
            {isEditing ? 'Save' : 'Create & Edit'}
          </button>
        </div>
      </div>

      {/* MIDI track review modal */}
      {isMidiReviewOpen && midiPreview && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setIsMidiReviewOpen(false)}
          />

          <div className="
            relative z-10 w-full max-w-2xl max-h-[75vh]
            bg-[var(--bg-secondary)]/95 backdrop-blur-xl rounded-2xl
            border border-[var(--border-color)] shadow-[0_20px_60px_rgba(0,0,0,0.5)]
            flex flex-col
          ">
            <div className="p-4 border-b border-[var(--border-color)]">
              <h3 className="text-base font-semibold text-[var(--text-primary)]">Review MIDI Tracks</h3>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                Choose up to {MAX_VOICES} monophonic tracks to import as voices.
              </p>
            </div>

            <div className="p-4 space-y-3 overflow-y-auto">
              <div className="text-xs text-[var(--text-secondary)] bg-black/20 rounded-lg px-3 py-2">
                <p>File: <span className="text-[var(--text-primary)]">{midiPreview.fileName}</span></p>
                <p>Tempo: <span className="text-[var(--text-primary)]">{midiPreview.tempoBpm} BPM</span> • Time Signature: <span className="text-[var(--text-primary)]">{midiPreview.timeSigNumerator}/{midiPreview.timeSigDenominator}</span> • Bars: <span className="text-[var(--text-primary)]">{midiPreview.totalBars}</span></p>
              </div>

              {midiPreview.globalIssues.length > 0 && (
                <div className="space-y-1">
                  {midiPreview.globalIssues.map((issue) => (
                    <div key={issue} className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-2">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      <span>{issue}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                {midiPreview.tracks.map((track) => {
                  const selected = midiSelectedTracks.includes(track.trackIndex);
                  const disabled = !track.importable;

                  return (
                    <label
                      key={track.trackIndex}
                      className={`block rounded-lg border px-3 py-2 ${
                        disabled
                          ? 'border-red-500/20 bg-red-500/5'
                          : selected
                            ? 'border-green-500/30 bg-green-500/10'
                            : 'border-[var(--border-color)] bg-white/5'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={disabled}
                          onChange={() => handleToggleMidiTrack(track.trackIndex)}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm text-[var(--text-primary)] truncate">{track.name}</p>
                            {track.importable ? (
                              <span className="inline-flex items-center gap-1 text-[10px] text-green-300">
                                <CheckCircle2 size={12} />
                                Importable
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] text-red-300">
                                <AlertTriangle size={12} />
                                Not importable
                              </span>
                            )}
                          </div>

                          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                            Notes: {track.noteCount}{track.channel !== null ? ` • MIDI channel ${track.channel + 1}` : ''}
                          </p>

                          {track.issues.length > 0 && (
                            <ul className="mt-1 space-y-0.5 text-xs text-amber-300">
                              {track.issues.map((issue) => (
                                <li key={`${track.trackIndex}-${issue}`}>• {issue}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="p-4 border-t border-[var(--border-color)] flex justify-end gap-2">
              <button
                onClick={() => setIsMidiReviewOpen(false)}
                className="
                  px-4 py-2 rounded-lg
                  bg-[var(--button-bg)] text-[var(--text-secondary)]
                  hover:bg-[var(--button-bg-hover)] hover:text-[var(--text-primary)]
                "
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmMidiImport}
                className="
                  px-4 py-2 rounded-lg
                  bg-[var(--accent-primary)] text-white
                  hover:brightness-110
                "
              >
                Use Selected Tracks
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CreateArrangementModal;
