/* ============================================================
   BUTTON COMPONENT
   
   Reusable button with multiple variants and states.
   Uses CSS variables for theming.
   ============================================================ */

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

/* ------------------------------------------------------------
   Types
   ------------------------------------------------------------ */

type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger' | 'record';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  active?: boolean;       // For toggle buttons
  loading?: boolean;
}

/* ------------------------------------------------------------
   Styles
   ------------------------------------------------------------ */

const baseStyles = `
  inline-flex items-center justify-center
  font-medium
  transition-all duration-[var(--transition-fast)]
  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]
  disabled:opacity-50 disabled:cursor-not-allowed
`;

const variantStyles: Record<ButtonVariant, string> = {
  default: `
    bg-[var(--button-bg)] 
    hover:bg-[var(--button-bg-hover)] 
    active:bg-[var(--button-bg-active)]
    border border-[var(--border-color)]
    text-[var(--text-primary)]
  `,
  primary: `
    bg-[var(--accent-primary)] 
    hover:brightness-110 
    active:brightness-90
    text-white
    shadow-[0_0_10px_var(--accent-primary-glow)]
  `,
  ghost: `
    bg-transparent 
    hover:bg-[var(--button-bg-hover)] 
    active:bg-[var(--button-bg-active)]
    text-[var(--text-secondary)]
    hover:text-[var(--text-primary)]
  `,
  danger: `
    bg-[var(--color-record)] 
    hover:brightness-110 
    active:brightness-90
    text-white
  `,
  record: `
    bg-[var(--color-record)] 
    hover:brightness-110 
    active:brightness-90
    text-white
    shadow-[0_0_10px_var(--color-record-glow)]
  `,
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-7 px-2 text-xs rounded-[var(--radius-sm)]',
  md: 'h-9 px-4 text-sm rounded-[var(--radius-md)]',
  lg: 'h-11 px-6 text-base rounded-[var(--radius-lg)]',
  icon: 'h-9 w-9 rounded-[var(--radius-md)]',
};

const activeStyles = `
  ring-2 ring-[var(--accent-primary)]
  bg-[var(--button-bg-active)]
`;

/* ------------------------------------------------------------
   Component
   ------------------------------------------------------------ */

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ 
    className = '', 
    variant = 'default', 
    size = 'md', 
    active = false,
    loading = false,
    disabled,
    children, 
    ...props 
  }, ref) => {
    return (
      <button
        ref={ref}
        className={`
          ${baseStyles}
          ${variantStyles[variant]}
          ${sizeStyles[size]}
          ${active ? activeStyles : ''}
          ${className}
        `}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <span className="animate-spin mr-2">⏳</span>
        ) : null}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

export default Button;
