type ConfirmDialogProps = {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** Estilo rojo para acciones destructivas. */
  confirmDanger?: boolean
  /** Deshabilita los botones mientras la acción está en curso. */
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Confirmación en pantalla (sin `window.confirm`). Se comparte entre paneles
 * para mantener la UX consistente: fondo semitransparente + modal oscuro.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Continuar',
  cancelLabel = 'Cancelar',
  confirmDanger,
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/55 backdrop-blur-[1px]"
        aria-label="Cerrar"
        onClick={onCancel}
        disabled={busy}
      />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-slate-600/80 bg-slate-900 p-5 shadow-2xl shadow-black/40">
        <h3
          id="confirm-dialog-title"
          className="text-base font-semibold text-slate-100"
        >
          {title}
        </h3>
        <p className="mt-2 text-sm text-slate-400 leading-relaxed whitespace-pre-line">
          {message}
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-sm px-3 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`text-sm px-3 py-2 rounded-lg font-medium disabled:opacity-50 ${
              confirmDanger
                ? 'bg-red-600 hover:bg-red-500 text-white'
                : 'bg-violet-600 hover:bg-violet-500 text-white'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
