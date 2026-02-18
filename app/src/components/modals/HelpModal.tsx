/* ============================================================
   HELP MODAL

   Shows mode-aware guidance for using the app.
   - Play mode help: practice and playback workflow
   - Create mode help: arrangement editing workflow
   - Quick references: keyboard + mouse controls
   ============================================================ */

import { CircleHelp, X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

/* ------------------------------------------------------------
   Types
   ------------------------------------------------------------ */

type HelpItem = {
  title: string;
  details: string;
};

type ShortcutItem = {
  keys: string;
  action: string;
};

/* ------------------------------------------------------------
   Shared help data
   ------------------------------------------------------------ */

// Core controls used during playback and practice.
const PLAY_FLOW: HelpItem[] = [
  {
    title: '1) Choose an arrangement',
    details: 'Use the arrangement button in the top bar to open the Library and load a song.',
  },
  {
    title: '2) Set your practice context',
    details: 'Use Mic Setup (microphone icon), then adjust Key/BPM/Loop/Metronome in the transport bar.',
  },
  {
    title: '3) Practice with guides',
    details: 'Use the Parts sidebar to toggle Voice/Guides, and click contour lines to focus on one part.',
  },
  {
    title: '4) Record and compare',
    details: 'Arm a part in the sidebar, record, then replay with transport controls to evaluate your timing and pitch.',
  },
];

// Core controls used while building or editing arrangements.
const CREATE_FLOW: HelpItem[] = [
  {
    title: '1) Enter Create mode',
    details: 'Click Create in the top bar, then set arrangement title, key, BPM, bars, and voices.',
  },
  {
    title: '2) Select a voice to edit',
    details: 'In the Parts sidebar, click Edit on a track (or press 1-6) to choose the active voice.',
  },
  {
    title: '3) Place and shape melody nodes',
    details: 'Click empty grid space to place nodes. Drag nodes to move them, and use multi-select for group edits.',
  },
  {
    title: '4) Add structure layers',
    details: 'Use Enable Chord Track / Enable Lyrics Track, then edit chord blocks and lyric chips directly on the grid.',
  },
  {
    title: '5) Save your work',
    details: 'Use Save in the top bar to store in My Library, and Export to create a JSON backup file.',
  },
];

// Controls available in both modes.
const SHARED_SHORTCUTS: ShortcutItem[] = [
  { keys: 'Space', action: 'Play/Pause (or stop active recording/count-in)' },
  { keys: 'Shift + Space', action: 'Play from beginning' },
  { keys: 'R', action: 'Restart transport to beginning' },
  { keys: '[ / ]', action: 'Vertical zoom out/in' },
  { keys: '1..6', action: 'Select voice by track number (when available)' },
  { keys: 'Escape', action: 'Clear focus (and clear node selection in Create mode)' },
];

// Create mode editing shortcuts.
const CREATE_SHORTCUTS: ShortcutItem[] = [
  { keys: 'Ctrl/Cmd + Z', action: 'Undo' },
  { keys: 'Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y', action: 'Redo' },
  { keys: 'Delete / Backspace', action: 'Delete selected nodes' },
  { keys: 'Ctrl/Cmd + C / X / V', action: 'Copy / Cut / Paste selected nodes' },
  { keys: 'Ctrl/Cmd + D', action: 'Duplicate selected nodes' },
  { keys: 'Ctrl/Cmd + A', action: 'Select all nodes in active voice' },
  { keys: 'Arrow Left/Right', action: 'Pan timeline (hold Shift for bigger steps)' },
  { keys: 'W / S', action: 'Pan pitch up/down (hold Shift for bigger steps)' },
  { keys: '+ / -', action: 'Horizontal zoom in/out' },
  { keys: '0', action: 'Reset Create view (time and pitch pan)' },
];

// Mouse interactions with the grid and overlays.
const PLAY_MOUSE: HelpItem[] = [
  {
    title: 'Click a node',
    details: 'Audition that pitch without changing focus.',
  },
  {
    title: 'Click a contour line',
    details: 'Focus that voice. Shift + click toggles multi-focus.',
  },
  {
    title: 'Right-drag / middle-drag',
    details: 'Pan timeline view horizontally (middle-drag also supports vertical pitch pan).',
  },
  {
    title: 'Wheel / modifiers',
    details: 'Wheel pans pitch, Shift + Wheel zooms time, Alt + Wheel pans time, Alt + Shift + Wheel zooms pitch.',
  },
];

const CREATE_MOUSE: HelpItem[] = [
  {
    title: 'Left-click empty grid',
    details: 'Place a node on the selected voice.',
  },
  {
    title: 'Click/Shift-click nodes',
    details: 'Select one node, or toggle node membership in the current selection.',
  },
  {
    title: 'Ctrl/Cmd + drag on empty grid',
    details: 'Marquee-select nodes. Add Shift for additive marquee.',
  },
  {
    title: 'Drag selected nodes',
    details: 'Move one node or a selected group in time/pitch.',
  },
  {
    title: 'Alt + left-drag',
    details: 'Scrub/seek timeline while editing.',
  },
];

// Create overlays: chords and lyrics.
const CREATE_TRACK_NOTES: HelpItem[] = [
  {
    title: 'Chord Track',
    details: 'Enable the track, double-click a chord to rename, Shift + click to delete, and drag chord edges to resize.',
  },
  {
    title: 'Chord splits',
    details: 'Hover near the top edge of the chord lane and click the split marker (+) to split at that time.',
  },
  {
    title: 'Lyrics Track',
    details: 'Enable lyrics after Voice 1 melody nodes exist. Click a lyric chip to edit at that node.',
  },
  {
    title: 'Lyrics connectors',
    details: "Type '-' for syllable split and '_' for held syllables. Enter/Tab advances to next lyric node.",
  },
];

/* ------------------------------------------------------------
   Small presentational helpers
   ------------------------------------------------------------ */

function HelpList({ items }: { items: HelpItem[] }) {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item.title}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2"
        >
          <p className="text-xs font-semibold text-[var(--text-primary)]">{item.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{item.details}</p>
        </div>
      ))}
    </div>
  );
}

function ShortcutTable({ rows }: { rows: ShortcutItem[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-white/5">
      {rows.map((row, index) => (
        <div
          key={`${row.keys}-${index}`}
          className="grid grid-cols-[170px_1fr] gap-3 border-b border-white/8 px-3 py-2 last:border-b-0"
        >
          <div className="text-xs font-semibold text-[var(--accent-primary-light)]">{row.keys}</div>
          <div className="text-xs text-[var(--text-secondary)]">{row.action}</div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------
   Component
   ------------------------------------------------------------ */

export function HelpModal() {
  // Open/close state for this modal.
  const isOpen = useAppStore((state) => state.isHelpOpen);
  const setHelpOpen = useAppStore((state) => state.setHelpOpen);

  // The app mode controls which workflow section is shown first.
  const mode = useAppStore((state) => state.mode);

  // Read-only context for more helpful text in the header.
  const arrangement = useAppStore((state) => state.arrangement);

  // Single close handler so all close buttons behave identically.
  const handleClose = () => {
    setHelpOpen(false);
  };

  if (!isOpen) return null;

  const modeTitle = mode === 'create' ? 'Create Mode' : 'Play Mode';
  const modeFlow = mode === 'create' ? CREATE_FLOW : PLAY_FLOW;
  const modeMouse = mode === 'create' ? CREATE_MOUSE : PLAY_MOUSE;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-md animate-[fadeInUp_0.2s_ease-out]"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label="Help"
    >
      <div
        className="relative w-full max-w-4xl max-h-[84vh] m-4 overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]/95 shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with current mode context so users know which instructions apply now. */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border-color)] px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <CircleHelp size={18} className="text-[var(--accent-primary)]" />
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">Help and How To Use</h2>
            </div>
            <p className="mt-1 text-xs text-[var(--text-secondary)] leading-relaxed">
              Current mode: <span className="font-semibold text-[var(--text-primary)]">{modeTitle}</span>
              {arrangement ? ` | Arrangement: ${arrangement.title}` : ''}
            </p>
          </div>

          <button
            onClick={handleClose}
            className="shrink-0 rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text-primary)]"
            aria-label="Close Help"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body so long help content stays usable on smaller screens. */}
        <div className="max-h-[calc(84vh-132px)] overflow-y-auto px-5 py-4 space-y-5">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Recommended flow ({modeTitle})</h3>
            <HelpList items={modeFlow} />
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Keyboard shortcuts (all modes)</h3>
            <ShortcutTable rows={SHARED_SHORTCUTS} />
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Mouse controls ({modeTitle})</h3>
            <HelpList items={modeMouse} />
          </section>

          {/* Create-specific details only shown in Create mode */}
          {mode === 'create' && (
            <>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Create mode shortcuts</h3>
                <ShortcutTable rows={CREATE_SHORTCUTS} />
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Create mode: Chords and Lyrics</h3>
                <HelpList items={CREATE_TRACK_NOTES} />
              </section>
            </>
          )}

          <section className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Tip: If a shortcut does not respond, click an empty part of the app first so keyboard focus is not inside a text field.
            </p>
          </section>
        </div>

        <div className="flex justify-end border-t border-[var(--border-color)] px-5 py-3">
          <button
            onClick={handleClose}
            className="rounded-lg bg-[var(--accent-primary)] px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

export default HelpModal;
