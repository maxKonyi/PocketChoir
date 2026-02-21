import { X, Volume2, Music2, RotateCw } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { VoiceColorPicker } from '../ui/VoiceColorPicker';

/* ------------------------------------------------------------
   Mixer Modal
   
   A comprehensive mixing interface for controlling:
   - Global volume and reverb
   - Per-track synth/vocal balance
   - Mute/Focus states
   ------------------------------------------------------------ */

export function MixerModal() {
    const isMixerOpen = useAppStore((state) => state.isMixerOpen);
    const setMixerOpen = useAppStore((state) => state.setMixerOpen);

    const arrangement = useAppStore((state) => state.arrangement);
    const voiceStates = useAppStore((state) => state.voiceStates);

    // Global Actions
    const globalVolume = useAppStore((state) => state.globalVolume);
    const globalReverb = useAppStore((state) => state.globalReverb);
    const setGlobalVolume = useAppStore((state) => state.setGlobalVolume);
    const setGlobalReverb = useAppStore((state) => state.setGlobalReverb);

    // Voice Actions
    const setVoiceSynthVolume = useAppStore((state) => state.setVoiceSynthVolume);
    const setVoiceSynthMuted = useAppStore((state) => state.setVoiceSynthMuted);
    const setVoiceSynthSolo = useAppStore((state) => state.setVoiceSynthSolo);
    const setVoiceSynthPan = useAppStore((state) => state.setVoiceSynthPan);
    const setVoiceVocalVolume = useAppStore((state) => state.setVoiceVocalVolume);
    const setVoiceVocalMuted = useAppStore((state) => state.setVoiceVocalMuted);
    const setVoiceVocalSolo = useAppStore((state) => state.setVoiceVocalSolo);
    const setVoiceVocalPan = useAppStore((state) => state.setVoiceVocalPan);
    const setVoiceColor = useAppStore((state) => state.setVoiceColor);

    if (!isMixerOpen || !arrangement) return null;

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-8 bg-black/40 backdrop-blur-md animate-[fadeInUp_0.2s_ease-out]" role="dialog" aria-modal="true" aria-label="Mixer">
            <div className="
        w-[900px] max-w-full max-h-[85vh] flex flex-col
        glass-pane glass-high rounded-3xl
        shadow-[0_50px_100px_rgba(0,0,0,0.5)]
        border border-white/10
      ">

                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-white/10">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-white/10 rounded-lg">
                            <Music2 size={20} className="text-[var(--accent-primary)]" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-[var(--text-primary)]">Mixer</h2>
                            <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">Audio Control Console</p>
                        </div>
                    </div>
                    <button
                        onClick={() => setMixerOpen(false)}
                        className="p-2 rounded-full hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Global Controls Band */}
                <div className="flex items-center justify-between px-8 py-4 bg-black/20 border-b border-white/5 shrink-0">
                    <div className="flex gap-8 w-full max-w-2xl mx-auto">
                        {/* Global Volume */}
                        <div className="flex-1 flex items-center gap-4">
                            <Volume2 size={18} className="text-[var(--text-secondary)] shrink-0" />
                            <div className="flex-1 flex flex-col gap-1.5">
                                <div className="flex justify-between text-[10px] uppercase font-bold tracking-widest text-[var(--text-secondary)]">
                                    <span>Master Volume</span>
                                    <span>{Math.round(globalVolume * 100)}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={globalVolume}
                                    onChange={(e) => setGlobalVolume(parseFloat(e.target.value))}
                                    className="w-full accent-white h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer"
                                />
                            </div>
                        </div>

                        {/* Global Reverb */}
                        <div className="flex-1 flex items-center gap-4">
                            <RotateCw size={18} className="text-[var(--text-secondary)] shrink-0" />
                            <div className="flex-1 flex flex-col gap-1.5">
                                <div className="flex justify-between text-[10px] uppercase font-bold tracking-widest text-[var(--text-secondary)]">
                                    <span>Global Reverb</span>
                                    <span>{Math.round(globalReverb * 100)}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={globalReverb}
                                    onChange={(e) => setGlobalReverb(parseFloat(e.target.value))}
                                    className="w-full accent-[var(--accent-secondary)] h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Track List */}
                <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
                    <div className="flex flex-col gap-2">

                        {/* Legend Header */}
                        <div className="grid grid-cols-[160px_1fr_1fr] gap-6 px-4 py-2 text-[10px] uppercase font-bold tracking-widest text-[var(--text-dim)] sticky top-0 bg-transparent z-10 scrollbar-gutter-stable">
                            <div>Track</div>
                            <div>Synth (Guide)</div>
                            <div>Vocal (Recording)</div>
                        </div>

                        {/* Tracks */}
                        {arrangement.voices.map((voice, idx) => {
                            const vs = voiceStates.find(s => s.voiceId === voice.id);
                            if (!vs) return null;

                            return (
                                <div
                                    key={voice.id}
                                    className="
                     grid grid-cols-[160px_1fr_1fr] gap-6 px-4 py-3
                     bg-white/5 hover:bg-white/[0.07]
                     border border-white/5 rounded-xl
                     items-center transition-colors
                   "
                                >

                                    {/* Track Info */}
                                    <div className="flex items-center gap-3">
                                        {/* This uses the same picker as the sidebar so behavior stays consistent. */}
                                        <VoiceColorPicker
                                            color={voice.color}
                                            onChange={(nextColor) => setVoiceColor(voice.id, nextColor)}
                                            label={voice.name}
                                            containerClassName="shrink-0"
                                            triggerClassName="w-3 h-12 rounded-full border border-white/20 cursor-pointer shadow-[0_0_10px_inset_rgba(0,0,0,0.5)]"
                                        />
                                        <div>
                                            <div className="text-sm font-bold text-white mb-0.5">{voice.name}</div>
                                            <div className="text-[10px] text-[var(--text-dim)]">Voice {idx + 1}</div>
                                        </div>
                                    </div>

                                    {/* Synth Controls */}
                                    <div className="flex items-center gap-3 pr-4 border-r border-white/10">
                                        <div className="flex flex-col gap-1 w-full justify-center">
                                            <div className="flex gap-2 w-full">
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="1"
                                                    step="0.01"
                                                    value={vs.synthVolume}
                                                    onChange={(e) => setVoiceSynthVolume(voice.id, parseFloat(e.target.value))}
                                                    className="w-full accent-[var(--accent-primary)] h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
                                                    title="Synth Volume"
                                                />

                                                <input
                                                    type="range"
                                                    min="-1"
                                                    max="1"
                                                    step="0.1"
                                                    value={vs.synthPan}
                                                    onChange={(e) => setVoiceSynthPan(voice.id, parseFloat(e.target.value))}
                                                    className="w-16 accent-[var(--accent-primary)]/50 h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
                                                    title="Synth Pan Left/Right"
                                                />
                                            </div>
                                            <div className="flex justify-between items-center mt-1">
                                                <div className="flex gap-1">
                                                    <button
                                                        onClick={() => setVoiceSynthMuted(voice.id, !vs.synthMuted)}
                                                        className={`
                                        w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold transition-all
                                        ${vs.synthMuted ? 'bg-red-500 text-white' : 'bg-white/10 text-[var(--text-muted)] hover:bg-white/20 hover:text-[var(--text-primary)]'}
                                    `}
                                                    >M</button>
                                                    <button
                                                        onClick={() => setVoiceSynthSolo(voice.id, !vs.synthSolo)}
                                                        className={`
                                        w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold transition-all
                                        ${vs.synthSolo ? 'bg-yellow-500 text-black' : 'bg-white/10 text-[var(--text-muted)] hover:bg-white/20 hover:text-[var(--text-primary)]'}
                                        cursor-pointer
                                    `}
                                                    >F</button>
                                                </div>
                                                <span className="text-[9px] text-[var(--text-dim)] tabular-nums">Vol {Math.round(vs.synthVolume * 100)} | Pan {vs.synthPan.toFixed(1)}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Vocal Controls */}
                                    <div className="flex items-center gap-3">
                                        <div className="flex flex-col gap-1 w-full justify-center">
                                            <div className="flex gap-2 w-full">
                                                {/* Voc Vol */}
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="1"
                                                    step="0.01"
                                                    value={vs.vocalVolume}
                                                    onChange={(e) => setVoiceVocalVolume(voice.id, parseFloat(e.target.value))}
                                                    className="w-full accent-white h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
                                                    title="Vocal Volume"
                                                />
                                                {/* Vox Pan */}
                                                <input
                                                    type="range"
                                                    min="-1"
                                                    max="1"
                                                    step="0.1"
                                                    value={vs.vocalPan}
                                                    onChange={(e) => setVoiceVocalPan(voice.id, parseFloat(e.target.value))}
                                                    className="w-16 accent-white/50 h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
                                                    title="Pan Left/Right"
                                                />
                                            </div>

                                            <div className="flex justify-between items-center mt-1">
                                                <div className="flex gap-1">
                                                    <button
                                                        onClick={() => setVoiceVocalMuted(voice.id, !vs.vocalMuted)}
                                                        className={`
                                        w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold transition-all
                                        ${vs.vocalMuted ? 'bg-red-500 text-white' : 'bg-white/10 text-[var(--text-muted)] hover:bg-white/20 hover:text-[var(--text-primary)]'}
                                    `}
                                                    >M</button>
                                                    <button
                                                        onClick={() => setVoiceVocalSolo(voice.id, !vs.vocalSolo)}
                                                        className={`
                                        w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold transition-all
                                        ${vs.vocalSolo ? 'bg-yellow-500 text-black' : 'bg-white/10 text-[var(--text-muted)] hover:bg-white/20 hover:text-[var(--text-primary)]'}
                                        cursor-pointer
                                    `}
                                                    >F</button>
                                                </div>
                                                <span className="text-[9px] text-[var(--text-dim)] tabular-nums">Vol {Math.round(vs.vocalVolume * 100)} | Pan {vs.vocalPan.toFixed(1)}</span>
                                            </div>
                                        </div>
                                    </div>

                                </div>
                            );
                        })}
                    </div>
                </div>

            </div>
        </div>
    );
}
