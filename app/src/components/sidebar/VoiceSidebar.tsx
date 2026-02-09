/* ============================================================
   VOICE SIDEBAR COMPONENT
   
   Floating left sidebar showing voice controls.
   Each voice has: record arm button with mic icon, mute, solo, delete
   Styled to match the cosmic/dreamy aesthetic from mockups.
   ============================================================ */

import { Mic, Volume2, VolumeX, Headphones, Trash2, Edit3, Music, Layers } from 'lucide-react';
import { Button } from '../ui/Button';
import { useAppStore, MAX_VOICES } from '../../stores/appStore';

/* ------------------------------------------------------------
   Voice Control Row Component - Grouped controls per voice
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

  // Get actions from store
  const armVoice = useAppStore((state) => state.armVoice);
  const setVoiceSynthMuted = useAppStore((state) => state.setVoiceSynthMuted);
  const setVoiceSynthSolo = useAppStore((state) => state.setVoiceSynthSolo);
  const setVoiceVocalMuted = useAppStore((state) => state.setVoiceVocalMuted);
  const setVoiceVocalSolo = useAppStore((state) => state.setVoiceVocalSolo);
  const clearRecording = useAppStore((state) => state.clearRecording);
  const setSelectedVoiceId = useAppStore((state) => state.setSelectedVoiceId);

  const isArmed = armedVoiceId === voiceId;
  const isRecording = isArmed && pbIsRecording;

  const synthMuted = voiceState?.synthMuted ?? false;
  const synthSolo = voiceState?.synthSolo ?? false;
  const vocalMuted = voiceState?.vocalMuted ?? false;
  const vocalSolo = voiceState?.vocalSolo ?? false;

  const isSelectedForEdit = mode === 'create' && selectedVoiceId === voiceId;

  // Visual status for soloed out
  // Solo is global across SYN + VOX tracks.
  // If ANY solo is active anywhere, tracks that are not soloed are "soloed out".
  const anySoloActive = useAppStore((state) =>
    state.voiceStates.some(v => v.synthSolo || v.vocalSolo)
  );

  const synthSoloedOut = anySoloActive && !synthSolo;
  const vocalSoloedOut = anySoloActive && !vocalSolo;

  return (
    <div className="flex flex-col gap-1 p-1.5 rounded-[1.25rem] bg-white/5 border border-white/5">
      {/* Header - Voice Name & RECORD/SELECT Button */}
      <div className="flex items-center gap-1.5">
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
            flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1
            rounded-full transition-all duration-200 cursor-pointer
            ${isRecording
              ? 'ring-2 ring-white shadow-[0_0_15px_rgba(239,68,68,0.5)] scale-[1.02]'
              : (isArmed || isSelectedForEdit)
                ? 'ring-1 ring-white/50 brightness-110'
                : 'hover:brightness-110 hover:shadow-[0_0_10px_-3px_rgba(255,255,255,0.1)]'
            }
          `}
          style={{
            backgroundColor: isRecording
              ? '#ef4444'
              : `color-mix(in srgb, ${voiceColor}, transparent 60%)`, // Glassy transparency
            border: isRecording ? 'none' : `1px solid ${voiceColor}`, // Solid border
            opacity: vocalMuted && synthMuted ? 0.5 : 1
          }}
          title={mode === 'create' ? 'Select for editing' : 'Record'}
          aria-label={`${voiceName} - ${mode === 'create' ? 'Select for editing' : 'Record'}`}
        >
          {mode === 'create' ? (
            <Edit3 size={11} className="text-white" />
          ) : (
            <Mic size={11} className={isRecording ? 'text-white animate-pulse' : 'text-white'} />
          )}

          <span className="text-[9px] font-bold uppercase tracking-wider truncate text-white overflow-hidden text-ellipsis whitespace-nowrap">
            {voiceName}
          </span>

          {/* Recording indicator dot */}
          <div
            className={`
              ml-auto w-1.5 h-1.5 rounded-full transition-all duration-300
              ${hasRecording ? 'bg-green-400 shadow-[0_0_5px_rgba(74,222,128,1)]' : 'bg-white/20'}
            `}
          />
        </button>

        {/* Delete recording button - always visible but gated */}
        <button
          onClick={() => hasRecording && clearRecording(voiceId)}
          disabled={!hasRecording}
          className={`
            p-1 transition-colors
            ${hasRecording
              ? 'text-[var(--text-muted)] hover:text-red-400 cursor-pointer'
              : 'text-[var(--text-disabled)] cursor-not-allowed'}
          `}
          title={hasRecording ? "Clear recording" : "No recording"}
          aria-label={`Clear ${voiceName} recording`}
        >
          <Trash2 size={11} />
        </button>
      </div>

      {/* Control Rows - spacing controlled by 'gap' below */}
      <div className="flex flex-col gap-0 px-0.5 ml-0.5">

        {/* Vocal Controls Row */}
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1">
            <div
              className={`p-0.5 rounded-sm ${vocalMuted || vocalSoloedOut ? 'text-[var(--text-disabled)]' : 'text-[var(--text-secondary)]'}`}
              title="Vocal Part"
            >
              <Mic size={11} />
            </div>
            <span className="text-[10px] uppercase tracking-tighter text-[var(--text-muted)] font-bold leading-none">Vox</span>
          </div>

          <div className="flex items-center gap-0.5">
            <Button
              variant={vocalSolo ? 'primary' : 'ghost'}
              size="icon"
              onClick={() => setVoiceVocalSolo(voiceId, !vocalSolo)}
              className="h-4.5 w-4.5 rounded-sm"
              title="Solo Vocal"
            >
              <Headphones size={11} />
            </Button>
            <Button
              variant={vocalMuted ? 'danger' : 'ghost'}
              size="icon"
              onClick={() => setVoiceVocalMuted(voiceId, !vocalMuted)}
              className="h-4.5 w-4.5 rounded-sm"
              title="Mute Vocal"
            >
              {vocalMuted ? <VolumeX size={11} /> : <Volume2 size={11} />}
            </Button>
          </div>
        </div>

        {/* Synth Controls Row */}
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1">
            <div
              className={`p-0.5 rounded-sm ${synthMuted || synthSoloedOut ? 'text-[var(--text-disabled)]' : 'text-[var(--text-secondary)]'}`}
              title="Synth Part"
            >
              <Music size={11} />
            </div>
            <span className="text-[10px] uppercase tracking-tighter text-[var(--text-muted)] font-bold leading-none">Syn</span>
          </div>

          <div className="flex items-center gap-0.5">
            <Button
              variant={synthSolo ? 'primary' : 'ghost'}
              size="icon"
              onClick={() => setVoiceSynthSolo(voiceId, !synthSolo)}
              className="h-4.5 w-4.5 rounded-sm"
              title="Solo Synth"
            >
              <Headphones size={11} />
            </Button>
            <Button
              variant={synthMuted ? 'danger' : 'ghost'}
              size="icon"
              onClick={() => setVoiceSynthMuted(voiceId, !synthMuted)}
              className="h-4.5 w-4.5 rounded-sm"
              title="Mute Synth"
            >
              {synthMuted ? <VolumeX size={11} /> : <Volume2 size={11} />}
            </Button>
          </div>
        </div>

      </div>
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
  // Get arrangement from store
  const arrangement = useAppStore((state) => state.arrangement);
  const voiceStates = useAppStore((state) => state.voiceStates);
  const setVoiceVocalMuted = useAppStore((state) => state.setVoiceVocalMuted);
  const setVoiceSynthMuted = useAppStore((state) => state.setVoiceSynthMuted);
  const clearAllRecordings = useAppStore((state) => state.clearAllRecordings);
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

        {/* Header controls: Global Toggles */}
        <div className="flex gap-2 px-1 pb-1">
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
            VOX
          </button>

          <button
            onClick={() => {
              // Logic: If any synth is unmuted, mute all. If all muted, unmute all.
              const anyUnmuted = voiceStates.some(v => !v.synthMuted);
              voiceStates.forEach(v => setVoiceSynthMuted(v.voiceId, anyUnmuted));
            }}
            aria-label="Toggle all synths"
            className={`
               flex-1 py-1.5 rounded-lg text-[10px] font-bold tracking-widest uppercase transition-all cursor-pointer
               border border-white/5 shadow-sm
               ${voiceStates.every(v => v.synthMuted)
                ? 'bg-red-500/20 text-red-200 border-red-500/30 hover:bg-red-500/30'
                : 'bg-[var(--accent-secondary)]/20 text-[var(--accent-secondary-light)] border-[var(--accent-secondary)]/30 hover:bg-[var(--accent-secondary)]/30'
              }
             `}
          >
            SYN
          </button>
        </div>

        {/* Voice controls */}
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

        {/* Clear all button */}
        <button
          onClick={clearAllRecordings}
          aria-label="Clear all recordings"
          className="
            px-3 py-1.5 mt-2 mb-1
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
      </div>
    </div>
  );
}

export default VoiceSidebar;
