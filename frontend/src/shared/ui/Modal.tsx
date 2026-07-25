import { X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";

interface ModalProps {
  children: ReactNode;
  className?: string;
  closeLabel?: string;
  onClose?: () => void;
  title: string;
}

export function Modal({
  children,
  className = "",
  closeLabel = "닫기",
  onClose,
  title,
}: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialogRef.current?.focus();
    return () => {
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    if (!onClose) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className={`modal-dialog ${className}`.trim()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="modal-heading">
          <h2 id={titleId}>{title}</h2>
          {onClose ? (
            <button
              aria-label={closeLabel}
              className="modal-close-button"
              onClick={onClose}
              type="button"
            >
              <X aria-hidden="true" size={21} />
            </button>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}
