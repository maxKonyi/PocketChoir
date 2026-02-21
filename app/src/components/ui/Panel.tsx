/* ============================================================
   PANEL COMPONENT
   
   Styled container with backdrop blur and border.
   Used for sidebars, modals, cards, etc.
   ============================================================ */

import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';

/* ------------------------------------------------------------
   Types
   ------------------------------------------------------------ */

type PanelVariant = 'default' | 'solid' | 'transparent';

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  variant?: PanelVariant;
}

/* ------------------------------------------------------------
   Styles
   ------------------------------------------------------------ */

const baseStyles = `
  rounded-[var(--radius-xl)]
  border border-[var(--border-color-strong)]
`;

const variantStyles: Record<PanelVariant, string> = {
  default: `
    bg-[var(--bg-secondary)]/[var(--panel-opacity)]
    backdrop-blur-[var(--panel-blur)]
  `,
  solid: `
    bg-[var(--bg-secondary)]/95
    backdrop-blur-xl
    shadow-[0_20px_60px_rgba(0,0,0,0.5)]
  `,
  transparent: `
    bg-transparent
    border-transparent
  `,
};

/* ------------------------------------------------------------
   Component
   ------------------------------------------------------------ */

export const Panel = forwardRef<HTMLDivElement, PanelProps>(
  ({ className = '', variant = 'default', children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`${baseStyles} ${variantStyles[variant]} ${className}`}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Panel.displayName = 'Panel';

export default Panel;
