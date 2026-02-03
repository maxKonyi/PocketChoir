/* ============================================================
   VOICE SIDEBAR COMPONENT
   
   Floating left sidebar showing voice controls.
   Each voice has: record arm button with mic icon, mute, solo, delete
   Styled to match the cosmic/dreamy aesthetic from mockups.
   ============================================================ */

import { Mic, Volume2, VolumeX, Headphones, Trash2, Edit3 } from 'lucide-react';
import { Button } from '../ui/Button';
import { useAppStore } from '../../stores/appStore';

/* ------------------------------------------------------------
   Voice Control Row Component - Pill-style button per voice
   ------------------------------------------------------------ */

interface VoiceControlProps {
  voiceId: string;
  voiceName: string;
  voiceColor: string;
  voiceIndex: number;
}

function VoiceControl({ voiceId, voiceName, voiceColor }: VoiceControlProps) {
  // Get state from store
  const voiceState = useAppStore((state) =>
    state.voiceStates.find((v) => v.voiceId === voiceId)
  );
  const armedVoiceId = useAppStore((state) => state.armedVoiceId);
  const hasRecording = useAppStore((state) => state.recordings.has(voiceId));
  const mode = useAppStore((state) => state.mode);
  const selectedVoiceId = useAppStore((state) => state.selectedVoiceId);

  // Get actions from store
  const armVoice = useAppStore((state) => state.armVoice);
  const setVoiceSynthMuted = useAppStore((state) => state.setVoiceSynthMuted);
  const setVoiceSynthSolo = useAppStore((state) => state.setVoiceSynthSolo);
  const clearRecording = useAppStore((state) => state.clearRecording);
  const setSelectedVoiceId = useAppStore((state) => state.setSelectedVoiceId);

  const isArmed = armedVoiceId === voiceId;
  const isMuted = voiceState?.synthMuted ?? false;
  const isSolo = voiceState?.synthSolo ?? false;
  const isSelectedForEdit = mode === 'create' && selectedVoiceId === voiceId;

  return (
    <div className="flex flex-col gap-1">
      {/* Main voice button - pill shaped, colored */}
      <button
        onClick={() => {
          // In create mode, clicking selects voice for editing
          // In play mode, clicking arms voice for recording
          if (mode === 'create') {
            setSelectedVoiceId(voiceId);
          } else {
            armVoice(isArmed ? null : voiceId);
          }
        }}
        className={`
          flex items-center gap-2 px-3 py-2
          rounded-full
          transition-all duration-200
          ${isArmed || isSelectedForEdit
            ? 'ring-2 ring-white/50 shadow-lg'
            : 'hover:brightness-110'
          }
        `}
        style={{
          backgroundColor: voiceColor,
          boxShadow: (isArmed || isSelectedForEdit) ? `0 0 20px ${voiceColor}80` : `0 2px 8px ${voiceColor}40`,
        }}
        title={mode === 'create'
          ? (isSelectedForEdit ? 'Selected for editing' : 'Click to select for editing')
          : (isArmed ? 'Click to disarm' : 'Click to arm for recording')
        }
      >
        {/* Icon - Edit in create mode, Mic in play mode */}
        {mode === 'create' ? (
          <Edit3 size={14} className="text-white/90" />
        ) : (
          <Mic size={14} className="text-white/90" />
        )}

        {/* Status indicator dot */}
        <span
          className={`
            w-2.5 h-2.5 rounded-full 
            ${isArmed ? 'bg-red-500 animate-pulse' : ''}
            ${isSelectedForEdit ? 'bg-green-400 animate-pulse' : ''}
            ${!isArmed && !isSelectedForEdit ? 'bg-white/30' : ''}
          `}
        />

        {/* Voice label */}
        <span className="text-white font-medium text-sm">
          {mode === 'create' ? 'EDIT' : 'REC'} {voiceName.charAt(0).toUpperCase()}
        </span>
      </button>

      {/* Secondary controls row */}
      <div className="flex items-center justify-center gap-1 px-1">
        {/* Mute button */}
        <Button
          variant={isMuted ? 'danger' : 'ghost'}
          size="icon"
          onClick={() => setVoiceSynthMuted(voiceId, !isMuted)}
          title={isMuted ? 'Unmute' : 'Mute'}
          className="h-6 w-6 rounded-full"
        >
          {isMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
        </Button>

        {/* Solo button */}
        <Button
          variant={isSolo ? 'primary' : 'ghost'}
          size="icon"
          onClick={() => setVoiceSynthSolo(voiceId, !isSolo)}
          title={isSolo ? 'Unsolo' : 'Solo'}
          className="h-6 w-6 rounded-full"
        >
          <Headphones size={12} />
        </Button>

        {/* Delete recording button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => clearRecording(voiceId)}
          disabled={!hasRecording}
          title="Delete recording"
          className="h-6 w-6 rounded-full"
        >
          <Trash2 size={12} />
        </Button>

        {/* Recording exists indicator */}
        {hasRecording && (
          <div
            className="w-2 h-2 rounded-full bg-green-400"
            title="Has recording"
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------
   Main Sidebar Component - Floating panel
   ------------------------------------------------------------ */

export function VoiceSidebar() {
  // Get arrangement from store
  const arrangement = useAppStore((state) => state.arrangement);
  const clearAllRecordings = useAppStore((state) => state.clearAllRecordings);

  if (!arrangement) {
    return null; // Don't show sidebar when no arrangement
  }

  return (
    <div
      className="
        absolute left-6 top-1/2 -translate-y-1/2 z-20
        flex flex-col gap-4 p-4
        glass-pane glass-med rounded-[2rem]
        shadow-2xl
      "
    >

      {/* Header label */}
      <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider text-center flex items-center gap-2 justify-center">
        <Mic size={12} />
        <span>Vox</span>
      </div>

      {/* Voice controls */}
      <div className="flex flex-col gap-2">
        {arrangement.voices.map((voice, index) => (
          <VoiceControl
            key={voice.id}
            voiceId={voice.id}
            voiceName={voice.name}
            voiceColor={voice.color}
            voiceIndex={index}
          />
        ))}
      </div>

      {/* Clear all button */}
      <button
        onClick={clearAllRecordings}
        className="
          px-4 py-2 
          text-xs font-medium uppercase tracking-wider
          text-[var(--text-secondary)]
          bg-[var(--button-bg)]/50
          hover:bg-[var(--button-bg)]
          rounded-full
          transition-colors
        "
      >
        Clear
      </button>
    </div>
  );
}

export default VoiceSidebar;
