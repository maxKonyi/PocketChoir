import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Palette } from 'lucide-react';
import { isValidHexColor, normalizeHexColor } from '../../utils/colors';

/**
 * Evenly distributed 12-color rainbow spectrum.
 */
const QUICK_SWATCHES = [
  '#ff4757', // Red
  '#ff7f50', // Coral
  '#ffa502', // Orange
  '#f1c40f', // Yellow
  '#badc58', // Lime
  '#2ecc71', // Green
  '#00cec9', // Teal
  '#48dbfb', // Sky blue
  '#0984e3', // Blue
  '#6c5ce7', // Indigo
  '#9b59b6', // Purple
  '#fd79a8', // Pink
];

interface VoiceColorPickerProps {
  color: string;
  onChange: (nextColor: string) => void;
  label: string;
  containerClassName?: string;
  triggerClassName?: string;
  panelClassName?: string;
  panelAlign?: 'left' | 'right';
}

/**
 * Reusable voice color picker:
 * - Quick swatches for fast picking.
 * - Native color input for visual fine-tuning.
 * - Hex box for exact copy/paste values.
 */
export function VoiceColorPicker({
  color,
  onChange,
  label,
  containerClassName,
  triggerClassName,
  panelClassName,
  panelAlign = 'left',
}: VoiceColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftHex, setDraftHex] = useState(color);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const normalizedCurrentColor = useMemo(() => {
    return normalizeHexColor(color) ?? '#ffffff';
  }, [color]);

  const normalizedDraftHex = useMemo(() => {
    return normalizeHexColor(draftHex);
  }, [draftHex]);

  // Keep the hex text box synchronized if color changes from another UI entry point.
  useEffect(() => {
    setDraftHex(normalizedCurrentColor);
  }, [normalizedCurrentColor]);

  const [popoverRect, setPopoverRect] = useState<{ top: number; left: number } | null>(null);

  // Close the popover when the user clicks anywhere outside this picker.
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDownOutside = (event: MouseEvent) => {
      // Allow clicks inside the trigger itself
      if (rootRef.current && rootRef.current.contains(event.target as Node)) {
        return;
      }
      
      // Look for clicks inside the portal popover
      const popoverEl = document.getElementById('voice-color-popover');
      if (popoverEl && popoverEl.contains(event.target as Node)) {
        return;
      }

      setIsOpen(false);
    };

    // Calculate position relative to the trigger element
    if (rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect();
      // Place it right below the trigger
      setPopoverRect({
        top: rect.bottom + 8, // 8px margin
        left: panelAlign === 'right' ? rect.right - 224 : rect.left, // 224px is w-56
      });
    }

    window.addEventListener('mousedown', handlePointerDownOutside);
    // Listen for scroll/resize to close or reposition the popover
    window.addEventListener('scroll', () => setIsOpen(false), true);
    window.addEventListener('resize', () => setIsOpen(false));
    
    return () => {
      window.removeEventListener('mousedown', handlePointerDownOutside);
      window.removeEventListener('scroll', () => setIsOpen(false), true);
      window.removeEventListener('resize', () => setIsOpen(false));
    };
  }, [isOpen, panelAlign]);

  const applyHexColor = () => {
    if (!normalizedDraftHex) return;
    onChange(normalizedDraftHex);
    setIsOpen(false);
  };

  const renderPopover = () => {
    if (!isOpen || !popoverRect) return null;

    return createPortal(
      <div
        id="voice-color-popover"
        className={`fixed z-[100] w-56 rounded-xl border border-white/10 bg-[rgba(13,16,28,0.95)] backdrop-blur-xl p-3 shadow-[0_30px_60px_rgba(0,0,0,0.8)] ${panelClassName ?? ''}`}
        style={{
          top: popoverRect.top,
          left: popoverRect.left,
        }}
      >
        <div className="flex items-center gap-2 mb-2 text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-semibold">
          <Palette size={12} />
          <span>{label} Color</span>
        </div>

        <div className="grid grid-cols-6 gap-2 mb-3">
          {QUICK_SWATCHES.map((swatch) => {
            const normalizedSwatch = normalizeHexColor(swatch) ?? swatch;
            const isActive = normalizedSwatch === normalizedCurrentColor;
            return (
              <button
                key={swatch}
                type="button"
                onClick={() => {
                  onChange(normalizedSwatch);
                  setIsOpen(false);
                }}
                className="w-7 h-7 rounded-md border border-white/15 hover:scale-105 transition-transform flex items-center justify-center"
                style={{ backgroundColor: normalizedSwatch }}
                title={normalizedSwatch}
                aria-label={`Pick ${normalizedSwatch}`}
              >
                {isActive ? <Check size={12} className="text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]" /> : null}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 mb-2">
          <input
            type="color"
            value={normalizedDraftHex ?? normalizedCurrentColor}
            onChange={(event) => setDraftHex(event.target.value)}
            className="h-8 w-10 rounded border border-white/15 bg-transparent cursor-pointer"
            aria-label="Fine tune color"
          />
          <input
            type="text"
            value={draftHex}
            onChange={(event) => setDraftHex(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyHexColor();
              }
            }}
            placeholder="#ff6b9d"
            className="flex-1 h-8 rounded-md border border-white/15 bg-black/20 px-2 text-xs text-white outline-none focus:border-[var(--accent-primary)]"
            aria-label="Hex color"
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className={`text-[10px] ${isValidHexColor(draftHex) ? 'text-emerald-300' : 'text-[var(--text-muted)]'}`}>
            {isValidHexColor(draftHex) ? 'Valid hex color' : 'Use 3 or 6 hex digits'}
          </span>
          <button
            type="button"
            onClick={applyHexColor}
            disabled={!normalizedDraftHex}
            className="px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Apply
          </button>
        </div>
      </div>,
      document.body
    );
  };

  return (
    <div ref={rootRef} className={`relative ${containerClassName ?? ''}`}>
      <button
        type="button"
        onClick={() => setIsOpen((previous) => !previous)}
        aria-label={`Change ${label} color`}
        title={`Change ${label} color`}
        className={triggerClassName ?? 'w-3 h-12 rounded-full border border-white/20'}
        style={{
          backgroundColor: normalizedCurrentColor,
          boxShadow: `0 0 10px ${normalizedCurrentColor}66`,
        }}
      />
      {renderPopover()}
    </div>
  );
}
