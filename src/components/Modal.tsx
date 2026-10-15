import type { ReactNode } from "react";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, onClose, children }: Props) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{title}</span>
          <button className="icon-button" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-content">{children}</div>
      </div>
    </div>
  );
}
