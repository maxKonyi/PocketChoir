/* ============================================================
   CONFIRM DIALOG COMPONENT
   
   A reusable in-app pop-up that asks "Are you sure you want to
   delete X?" before performing destructive actions like clearing
   a recording or clearing all tracks.
   ============================================================ */

interface ConfirmDialogProps {
  /** Whether the dialog is visible. */
  open: boolean;
  /** The question shown to the user, e.g. "Are you sure you want to delete Voice 1?" */
  message: string;
  /** Called when the user clicks "Yes" / confirms. */
  onConfirm: () => void;
  /** Called when the user clicks "Cancel" or presses Escape. */
  onCancel: () => void;
}

export function ConfirmDialog({ open, message, onConfirm, onCancel }: ConfirmDialogProps) {
  // Don't render anything when the dialog is closed.
  if (!open) return null;

  return (
    /* Full-screen backdrop: darkens the background and centers the dialog. */
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-[fadeInUp_0.15s_ease-out]"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm action"
      /* Clicking the backdrop counts as "cancel". */
      onClick={onCancel}
      /* Pressing Escape also cancels. */
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      {/* Dialog box — stop click propagation so clicking inside doesn't close it. */}
      <div
        className="
          flex flex-col gap-5 p-6
          glass-pane glass-high rounded-2xl
          shadow-[0_30px_80px_rgba(0,0,0,0.5)]
          border border-white/10
          max-w-sm w-full mx-4
        "
        onClick={(e) => e.stopPropagation()}
      >
        {/* Message text */}
        <p className="text-sm text-[var(--text-primary)] text-center leading-relaxed">
          {message}
        </p>

        {/* Action buttons */}
        <div className="flex gap-3 justify-center">
          {/* Cancel button */}
          <button
            onClick={onCancel}
            className="
              px-5 py-2 rounded-full text-xs font-bold uppercase tracking-widest
              bg-white/10 text-[var(--text-secondary)]
              hover:bg-white/15 hover:text-[var(--text-primary)]
              transition-all duration-200 cursor-pointer
            "
          >
            Cancel
          </button>

          {/* Confirm / delete button */}
          <button
            onClick={onConfirm}
            autoFocus
            className="
              px-5 py-2 rounded-full text-xs font-bold uppercase tracking-widest
              bg-red-500/20 text-red-200 border border-red-500/30
              hover:bg-red-500/30 hover:text-red-100
              transition-all duration-200 cursor-pointer
            "
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
