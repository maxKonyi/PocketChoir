/* ============================================================
   VOICE SIDEBAR COMPONENT
   
   Left sidebar showing voice controls.
   Each voice has: record arm, mute, solo, delete recording
   ============================================================ */

import { Circle, Volume2, VolumeX, Headphones, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { useAppStore } from '../../stores/appStore';

/* ------------------------------------------------------------
   Voice Control Row Component
   ------------------------------------------------------------ */

interface VoiceControlProps {
  voiceId: string;
  voiceName: string;
  voiceColor: string;
  voiceIndex: number;
}

function VoiceControl({ voiceId, voiceName, voiceColor, voiceIndex }: VoiceControlProps) {
  // Get state from store
  const voiceState = useAppStore((state) => 
    state.voiceStates.find((v) => v.voiceId === voiceId)
  );
  const armedVoiceId = useAppStore((state) => state.armedVoiceId);
  const hasRecording = useAppStore((state) => state.recordings.has(voiceId));
  
  // Get actions from store
  const armVoice = useAppStore((state) => state.armVoice);
  const setVoiceSynthMuted = useAppStore((state) => state.setVoiceSynthMuted);
  const setVoiceSynthSolo = useAppStore((state) => state.setVoiceSynthSolo);
  const clearRecording = useAppStore((state) => state.clearRecording);

  const isArmed = armedVoiceId === voiceId;
  const isMuted = voiceState?.synthMuted ?? false;
  const isSolo = voiceState?.synthSolo ?? false;

  return (
    <div 
      className="flex items-center gap-1 p-2 rounded-[var(--radius-md)] bg-[var(--button-bg)]"
      style={{ borderLeft: `3px solid ${voiceColor}` }}
    >
      {/* Voice label */}
      <div className="flex-1 min-w-0">
        <div 
          className="text-sm font-medium truncate"
          style={{ color: voiceColor }}
        >
          V{voiceIndex + 1}
        </div>
        <div className="text-xs text-[var(--text-muted)] truncate">
          {voiceName}
        </div>
      </div>

      {/* Record arm button */}
      <Button
        variant={isArmed ? 'record' : 'ghost'}
        size="icon"
        onClick={() => armVoice(isArmed ? null : voiceId)}
        title={isArmed ? 'Disarm recording' : 'Arm for recording'}
        className="h-7 w-7"
      >
        <Circle 
          size={14} 
          fill={isArmed ? 'currentColor' : 'none'}
        />
      </Button>

      {/* Mute button */}
      <Button
        variant={isMuted ? 'danger' : 'ghost'}
        size="icon"
        onClick={() => setVoiceSynthMuted(voiceId, !isMuted)}
        title={isMuted ? 'Unmute' : 'Mute'}
        className="h-7 w-7"
      >
        {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
      </Button>

      {/* Solo button */}
      <Button
        variant={isSolo ? 'primary' : 'ghost'}
        size="icon"
        onClick={() => setVoiceSynthSolo(voiceId, !isSolo)}
        title={isSolo ? 'Unsolo' : 'Solo'}
        className="h-7 w-7"
      >
        <Headphones size={14} />
      </Button>

      {/* Delete recording button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => clearRecording(voiceId)}
        disabled={!hasRecording}
        title="Delete recording"
        className="h-7 w-7"
      >
        <Trash2 size={14} />
      </Button>

      {/* Recording indicator */}
      {hasRecording && (
        <div 
          className="w-2 h-2 rounded-full bg-[var(--color-success)]"
          title="Has recording"
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------
   Main Sidebar Component
   ------------------------------------------------------------ */

export function VoiceSidebar() {
  // Get arrangement from store
  const arrangement = useAppStore((state) => state.arrangement);
  const clearAllRecordings = useAppStore((state) => state.clearAllRecordings);

  if (!arrangement) {
    return (
      <Panel variant="solid" className="w-48 p-4 flex flex-col gap-2">
        <div className="text-sm text-[var(--text-muted)] text-center">
          No arrangement loaded
        </div>
      </Panel>
    );
  }

  return (
    <Panel variant="solid" className="w-48 p-2 flex flex-col gap-2 overflow-y-auto">
      {/* Header */}
      <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider px-2">
        Voices
      </div>

      {/* Voice controls */}
      <div className="flex flex-col gap-1">
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

      {/* Spacer */}
      <div className="flex-1" />

      {/* Clear all button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={clearAllRecordings}
        className="w-full text-[var(--color-record)]"
      >
        <Trash2 size={14} className="mr-1" />
        Clear All
      </Button>

      {/* Arrangement info */}
      <div className="text-xs text-[var(--text-muted)] px-2 pt-2 border-t border-[var(--border-color)]">
        <div>Key: {arrangement.tonic} {arrangement.scale}</div>
        <div>Tempo: {arrangement.tempo} BPM</div>
        <div>Length: {arrangement.bars} bars</div>
      </div>
    </Panel>
  );
}

export default VoiceSidebar;
