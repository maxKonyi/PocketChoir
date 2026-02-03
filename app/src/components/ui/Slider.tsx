/* ============================================================
   SLIDER COMPONENT
   
   Custom styled range slider for volume, pan, etc.
   Uses CSS variables for theming.
   ============================================================ */

import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';

/* ------------------------------------------------------------
   Types
   ------------------------------------------------------------ */

interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  showValue?: boolean;
  vertical?: boolean;
}

/* ------------------------------------------------------------
   Component
   ------------------------------------------------------------ */

export const Slider = forwardRef<HTMLInputElement, SliderProps>(
  ({ 
    className = '', 
    label,
    showValue = false,
    vertical = false,
    value,
    min = 0,
    max = 100,
    ...props 
  }, ref) => {
    // Calculate percentage for styling the track fill
    const numValue = typeof value === 'number' ? value : parseFloat(String(value) || '0');
    const numMin = typeof min === 'number' ? min : parseFloat(String(min) || '0');
    const numMax = typeof max === 'number' ? max : parseFloat(String(max) || '100');
    const percentage = ((numValue - numMin) / (numMax - numMin)) * 100;

    return (
      <div className={`flex ${vertical ? 'flex-col items-center h-full' : 'items-center gap-2'} ${className}`}>
        {label && (
          <label className="text-xs text-[var(--text-secondary)] whitespace-nowrap">
            {label}
          </label>
        )}
        
        <div className={`relative ${vertical ? 'h-full w-4' : 'flex-1 h-4'} flex items-center`}>
          <input
            ref={ref}
            type="range"
            value={value}
            min={min}
            max={max}
            className={`
              ${vertical ? 'slider-vertical' : 'w-full'}
              h-1
              appearance-none
              bg-[var(--button-bg)]
              rounded-full
              cursor-pointer
              
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:bg-[var(--accent-primary)]
              [&::-webkit-slider-thumb]:cursor-pointer
              [&::-webkit-slider-thumb]:transition-transform
              [&::-webkit-slider-thumb]:hover:scale-125
              
              [&::-moz-range-thumb]:w-3
              [&::-moz-range-thumb]:h-3
              [&::-moz-range-thumb]:rounded-full
              [&::-moz-range-thumb]:bg-[var(--accent-primary)]
              [&::-moz-range-thumb]:border-0
              [&::-moz-range-thumb]:cursor-pointer
            `}
            style={{
              background: vertical 
                ? undefined
                : `linear-gradient(to right, var(--accent-primary) 0%, var(--accent-primary) ${percentage}%, var(--button-bg) ${percentage}%, var(--button-bg) 100%)`
            }}
            {...props}
          />
        </div>
        
        {showValue && (
          <span className="text-xs text-[var(--text-muted)] w-8 text-right">
            {Math.round(numValue)}
          </span>
        )}
      </div>
    );
  }
);

Slider.displayName = 'Slider';

export default Slider;
