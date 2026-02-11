/* ============================================================
   VOICE SIDEBAR COMPONENT
   
   Floating left sidebar showing voice controls.
   Each voice has two rows:
     Row 1: Coloured name pill (full width) with recording indicator dot
     Row 2: Rec button (starts recording) + Trash button (delete with confirm)
   
   Global toggles at top: VOICE (vocals) and GUIDES (synths)
   Mixer button and Clear All at the bottom.
   ============================================================ */

import { useState } from 'react';
import { Mic, Trash2, Edit3, Layers, Sliders } from 'lucide-react';
import { useAppStore, MAX_VOICES } from '../../stores/appStore';
import { ConfirmDialog } from '../ui/ConfirmDialog';

/* ------------------------------------------------------------
   Voice Control Row Component - Two-row layout per voice
   ------------------------------------------------------------ */

interface VoiceControlProps {
  voiceId: string;
  voiceName: string;
  voiceColor: string;
  voiceIndex: number;
  startRecording: (targetVoiceId?: string) => Promise<boolean>;
  stopRecording: (keepPlaying?: boolean) => void;
}

function VoiceControl({ voiceId, voiceName, voiceColor, startRecording, stopRecording }: VoiceControlProps) {
  // Local inline rename UI state (only used in Create mode).
  const [isRenaming, setIsRenaming] = useState(false);
  const [pendingName, setPendingName] = useState(voiceName);
  // Confirm dialog state for single-track delete
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Get state from store
  const voiceState = useAppStore((state) =>
    state.voiceStates.find((v) => v.voiceId === voiceId)
  );
  // Subscribe to ONLY the playback field this component uses.
  // Do NOT subscribe to the entire playback object — setPosition() fires ~30fps
  // and would cause 6 VoiceSidebar instances to re-render every frame.
  const pbIsRecording = useAppStore((state) => state.playback.isRecording);
  const armedVoiceId = useAppStore((state) => state.armedVoiceId);
  const hasRecording = useAppStore((state) => state.recordings.has(voiceId));
  const mode = useAppStore((state) => state.mode);
  const selectedVoiceId = useAppStore((state) => state.selectedVoiceId);
  // In Create mode, we use node data to decide whether a track has content.
  const voiceNodeCount = useAppStore((state) => (
    state.arrangement?.voices.find((v) => v.id === voiceId)?.nodes.length ?? 0
  ));

  // Get actions from store
  const armVoice = useAppStore((state) => state.armVoice);
  const clearRecording = useAppStore((state) => state.clearRecording);
  const setSelectedVoiceId = useAppStore((state) => state.setSelectedVoiceId);
  const renameVoice = useAppStore((state) => state.renameVoice);
  const clearVoiceNodes = useAppStore((state) => state.clearVoiceNodes);

  const isArmed = armedVoiceId === voiceId;
  const isRecording = isArmed && pbIsRecording;
  // Track content: in Create mode use nodes, otherwise use recordings.
  const hasContent = mode === 'create' ? voiceNodeCount > 0 : hasRecording;

  const synthMuted = voiceState?.synthMuted ?? false;
  const vocalMuted = voiceState?.vocalMuted ?? false;

  const isSelectedForEdit = mode === 'create' && selectedVoiceId === voiceId;

  // Visual status: if any voice is focused, un-focused tracks appear dimmed.
  const anySoloActive = useAppStore((state) =>
    state.voiceStates.some(v => v.synthSolo || v.vocalSolo)
  );
  const isFocused = (voiceState?.synthSolo && voiceState?.vocalSolo) ?? false;
  const isDimmed = anySoloActive && !isFocused;

  return (
    <div
      className="flex flex-col gap-1 p-1.5 rounded-[1.25rem] bg-white/5 border border-white/5 transition-opacity duration-200"
      style={{ opacity: isDimmed ? 0.45 : 1 }}
    >
      {/* ROW 1: Full-width coloured name pill with indicator dot */}
      <button
        onClick={() => {
          if (mode === 'create') {
            // In Create mode, clicking the pill selects the track for editing.
            setSelectedVoiceId(voiceId);
          }
        }}
        className={`
          w-full flex items-center gap-1.5 px-2.5 py-1.5
          rounded-full transition-all duration-200
          ${mode === 'create' ? 'cursor-pointer' : 'cursor-default'}
          ${isRecording
            ? 'ring-2 ring-white shadow-[0_0_15px_rgba(239,68,68,0.5)] scale-[1.02]'
            : (isArmed || isSelectedForEdit)
              ? 'ring-1 ring-white/50 brightness-110'
              : mode === 'create' ? 'hover:brightness-110 hover:shadow-[0_0_10px_-3px_rgba(255,255,255,0.1)]' : ''
          }
        `}
        style={{
          backgroundColor: isRecording
            ? '#ef4444'
            : `color-mix(in srgb, ${voiceColor}, transparent 60%)`,
          border: isRecording ? 'none' : `1px solid ${voiceColor}`,
          opacity: vocalMuted && synthMuted ? 0.5 : 1
        }}
        title={mode === 'create' ? 'Select for editing' : voiceName}
        aria-label={`${voiceName} - ${mode === 'create' ? 'Select for editing' : 'Track'}`}
      >
        {/* In Create mode show the pencil icon; in Play mode just the name */}
        {mode === 'create' && (
          <Edit3
            size={11}
            className={`shrink-0 ${isSelectedForEdit ? 'text-green-300 drop-shadow-[0_0_6px_rgba(34,197,94,0.8)]' : 'text-white'}`}
          />
        )}

        {/* Track name: double-click in Create mode to rename. */}
        {mode === 'create' && isRenaming ? (
          <input
            value={pendingName}
            autoFocus
            className="text-[9px] font-bold uppercase tracking-wider truncate text-white bg-transparent outline-none min-w-0"
            onChange={(evt) => setPendingName(evt.target.value)}
            onBlur={() => {
              setIsRenaming(false);
              renameVoice(voiceId, pendingName);
            }}
            onKeyDown={(evt) => {
              if (evt.key === 'Enter') {
                evt.preventDefault();
                setIsRenaming(false);
                renameVoice(voiceId, pendingName);
              }
              if (evt.key === 'Escape') {
                evt.preventDefault();
                setPendingName(voiceName);
                setIsRenaming(false);
              }
            }}
            onClick={(evt) => evt.stopPropagation()}
          />
        ) : (
          <span
            className="text-[9px] font-bold uppercase tracking-wider truncate text-white overflow-hidden text-ellipsis whitespace-nowrap"
            onDoubleClick={(evt) => {
              if (mode !== 'create') return;
              evt.stopPropagation();
              setPendingName(voiceName);
              setIsRenaming(true);
            }}
            title={mode === 'create' ? 'Double-click to rename' : undefined}
          >
            {voiceName}
          </span>
        )}

        {/* Recording indicator dot — green when content exists */}
        <div
          className={`
            ml-auto w-1.5 h-1.5 rounded-full transition-all duration-300 shrink-0
            ${hasContent ? 'bg-green-400 shadow-[0_0_5px_rgba(74,222,128,1)]' : 'bg-white/20'}
          `}
        />
      </button>

      {/* ROW 2: Rec button + Trash button */}
      <div className="flex items-center gap-1 px-0.5">
        {/* Rec button — starts recording in Play mode, selects in Create mode */}
        <button
          onClick={async () => {
            if (mode === 'create') {
              setSelectedVoiceId(voiceId);
            } else {
              if (isRecording) {
                stopRecording();
              } else {
                armVoice(voiceId);
                await startRecording(voiceId);
              }
            }
          }}
          className={`
            flex-1 flex items-center justify-center gap-1 px-2 py-1
            rounded-full text-[9px] font-bold uppercase tracking-wider
            transition-all duration-200 cursor-pointer
            ${isRecording
              ? 'bg-red-500 text-white animate-pulse shadow-[0_0_12px_rgba(239,68,68,0.5)]'
              : 'bg-white/8 text-[var(--text-secondary)] hover:bg-white/15 hover:text-white border border-white/10'
            }
          `}
          title={mode === 'create' ? 'Select track' : (isRecording ? 'Stop recording' : 'Record')}
          aria-label={`${isRecording ? 'Stop recording' : 'Record'} ${voiceName}`}
        >
          <Mic size={10} className="shrink-0" />
          <span>{isRecording ? 'Stop' : 'Rec'}</span>
        </button>

        {/* Trash button — shows confirmation dialog before deleting */}
        <button
          onClick={() => {
            if (!hasContent) return;
            setShowDeleteConfirm(true);
          }}
          disabled={!hasContent}
          className={`
            p-1.5 rounded-full transition-colors
            ${hasContent
              ? 'text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 cursor-pointer'
              : 'text-[var(--text-disabled)] cursor-not-allowed'}
          `}
          title={hasContent ? (mode === 'create' ? 'Clear track content' : 'Clear recording') : 'No content'}
          aria-label={`Clear ${voiceName} content`}
        >
          <Trash2 size={11} />
        </button>
      </div>

      {/* Confirmation dialog for deleting this track's content */}
      <ConfirmDialog
        open={showDeleteConfirm}
        message={`Are you sure you want to delete ${voiceName}?`}
        onConfirm={() => {
          setShowDeleteConfirm(false);
          if (mode === 'create') {
            clearVoiceNodes(voiceId);
          } else {
            clearRecording(voiceId);
          }
        }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}

/* ------------------------------------------------------------
   Main Sidebar Component - Floating panel
   ------------------------------------------------------------ */
export interface VoiceSidebarProps {
  startRecording: (targetVoiceId?: string) => Promise<boolean>;
  stopRecording: (keepPlaying?: boolean) => void;
}

export function VoiceSidebar({ startRecording, stopRecording }: VoiceSidebarProps) {
  // Confirm dialog state for "Clear All"
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);

  // Get arrangement from store
  const arrangement = useAppStore((state) => state.arrangement);
  const voiceStates = useAppStore((state) => state.voiceStates);
  const setVoiceVocalMuted = useAppStore((state) => state.setVoiceVocalMuted);
  const setVoiceSynthMuted = useAppStore((state) => state.setVoiceSynthMuted);
  const clearAllRecordings = useAppStore((state) => state.clearAllRecordings);
  const clearAllVoiceNodes = useAppStore((state) => state.clearAllVoiceNodes);
  const setMixerOpen = useAppStore((state) => state.setMixerOpen);
  const mode = useAppStore((state) => state.mode);
  const addVoiceTrack = useAppStore((state) => state.addVoiceTrack);
  const isCreateMode = mode === 'create';
  const hasReachedVoiceCap = arrangement ? arrangement.voices.length >= MAX_VOICES : true;

  if (!arrangement) {
    return null; // Don't show sidebar when no arrangement
  }

  return (
    // Container defines the "safe zone" for centering.
    // Top is pinned below the TopBar (approx 5rem / 80px).
    // Bottom uses `bottom-32` to clear the transport bar area.
    <div className="absolute left-6 top-0 bottom-0 pt-[9rem] pb-20 flex flex-col items-start justify-center pointer-events-none z-20 w-fit">
      <div
        className="
          flex flex-col gap-2.5 p-3 pb-4 pointer-events-auto
          glass-pane glass-sidebar glass-noise rounded-[2.5rem]
          shadow-2xl border border-white/10
          shrink-0 w-[168px]
        "
      >

        {/* Header label styled to match the brighter top-bar theme dropdown */}
        <div className="relative flex items-center justify-center text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-[0.25em]">
          <div className="flex items-center gap-1.25">
            <Layers size={11} />
            <span>Tracks</span>
          </div>

          {isCreateMode && (
            <button
              type="button"
              onClick={() => {
                if (hasReachedVoiceCap) return;
                addVoiceTrack();
              }}
              disabled={hasReachedVoiceCap}
              title={hasReachedVoiceCap ? 'Reached track limit' : 'Add a new track'}
              className={`
                absolute right-1 top-1/2 -translate-y-1/2 px-2 py-1 transition-colors
                ${hasReachedVoiceCap
                  ? 'text-[var(--text-disabled)] cursor-not-allowed'
                  : 'text-[var(--accent-secondary)] hover:text-white hover:drop-shadow-[0_0_10px_rgba(236,72,153,0.4)]'}
              `}
            >
              <span className="text-base font-black leading-none">+</span>
            </button>
          )}
        </div>

        {/* Global Toggles: VOICE (vocals) and GUIDES (synths) */}
        <div className="flex gap-2 px-1 pb-1">
          {/* VOICE toggle — mutes/unmutes all vocal tracks */}
          <button
            onClick={() => {
              // Logic: If any vocal is unmuted, mute all. If all muted, unmute all.
              const anyUnmuted = voiceStates.some(v => !v.vocalMuted);
              voiceStates.forEach(v => setVoiceVocalMuted(v.voiceId, anyUnmuted));
            }}
            aria-label="Toggle all vocals"
            className={`
               flex-1 py-1.5 rounded-lg text-[10px] font-bold tracking-widest uppercase transition-all cursor-pointer
               border border-white/5 shadow-sm
               ${voiceStates.every(v => v.vocalMuted)
                ? 'bg-red-500/20 text-red-200 border-red-500/30 hover:bg-red-500/30'
                : 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary-light)] border-[var(--accent-primary)]/30 hover:bg-[var(--accent-primary)]/30'
              }
             `}
          >
            Voice
          </button>

          {/* GUIDES toggle — mutes/unmutes all synth tracks */}
          <button
            onClick={() => {
              // Logic: If any synth is unmuted, mute all. If all muted, unmute all.
              const anyUnmuted = voiceStates.some(v => !v.synthMuted);
              voiceStates.forEach(v => setVoiceSynthMuted(v.voiceId, anyUnmuted));
            }}
            aria-label="Toggle all guides"
            className={`
               flex-1 py-1.5 rounded-lg text-[10px] font-bold tracking-widest uppercase transition-all cursor-pointer
               border border-white/5 shadow-sm
               ${voiceStates.every(v => v.synthMuted)
                ? 'bg-red-500/20 text-red-200 border-red-500/30 hover:bg-red-500/30'
                : 'bg-[var(--accent-secondary)]/20 text-[var(--accent-secondary-light)] border-[var(--accent-secondary)]/30 hover:bg-[var(--accent-secondary)]/30'
              }
             `}
          >
            Guides
          </button>
        </div>

        {/* Voice controls — one two-row card per track */}
        <div className="flex flex-col gap-1.5">
          {arrangement.voices.map((voice, index) => (
            <VoiceControl
              key={voice.id}
              voiceId={voice.id}
              voiceName={voice.name}
              voiceColor={voice.color}
              voiceIndex={index}
              startRecording={startRecording}
              stopRecording={stopRecording}
            />
          ))}
        </div>

        {/* Bottom section: Clear All + Mixer */}
        <div className="flex flex-col gap-1.5 mt-1">
          {/* Clear All button — shows confirmation dialog */}
          <button
            onClick={() => setShowClearAllConfirm(true)}
            aria-label="Clear all recordings"
            className="
              px-3 py-1.5
              text-[9px] font-bold uppercase tracking-widest
              text-[var(--text-muted)] hover:text-[var(--text-primary)]
              bg-white/5 hover:bg-white/10
              hover:shadow-[0_0_10px_-3px_rgba(255,255,255,0.08)]
              rounded-full
              transition-all duration-200 cursor-pointer
              shrink-0
            "
          >
            Clear All
          </button>

          {/* Mixer button — opens the mixer modal */}
          <button
            onClick={() => setMixerOpen(true)}
            aria-label="Open Mixer"
            className="
              flex items-center justify-center gap-1.5 px-3 py-1.5
              text-[9px] font-bold uppercase tracking-widest
              text-[var(--text-secondary)] hover:text-[var(--text-primary)]
              bg-white/5 hover:bg-white/10
              hover:shadow-[0_0_10px_-3px_rgba(255,255,255,0.08)]
              rounded-full
              transition-all duration-200 cursor-pointer
              shrink-0
            "
            title="Open Mixer"
          >
            <Sliders size={11} />
            <span>Mixer</span>
          </button>
        </div>
      </div>

      {/* Confirmation dialog for Clear All */}
      <ConfirmDialog
        open={showClearAllConfirm}
        message="Are you sure you want to clear all track data?"
        onConfirm={() => {
          setShowClearAllConfirm(false);
          if (isCreateMode) {
            clearAllVoiceNodes();
          } else {
            clearAllRecordings();
          }
        }}
        onCancel={() => setShowClearAllConfirm(false)}
      />
    </div>
  );
}

export default VoiceSidebar;
