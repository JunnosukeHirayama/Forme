'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Check, X, LoaderCircle, FileText, ArrowUpRight, CircleHelp } from 'lucide-react';
import Link from 'next/link';

const ToastContext = createContext<(message: string, error?: boolean) => void>(() => {});
export function Providers({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const notify = useCallback((message: string, error = false) => setToast({ message, error }), []);
  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(null), 4500);
      return () => clearTimeout(id);
    }
  }, [toast]);
  return (
    <ToastContext.Provider value={notify}>
      {children}
      {toast && (
        <div
          className={`toast ${toast.error ? 'error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <CircleHelp size={18} /> : <Check size={18} />}
          {toast.message}
          <button aria-label="通知を閉じる" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);
export function Brand({ small = false, linked = true }: { small?: boolean; linked?: boolean }) {
  const content = (
    <>
      <span className="brand-icon">
        <span />
        <span />
        <span />
      </span>
      <span>
        forme<span className="brand-dot">.</span>
      </span>
    </>
  );
  return linked ? (
    <Link href="/" className={`brand ${small ? 'small' : ''}`} aria-label="Forme ホーム">
      {content}
    </Link>
  ) : (
    <span className={`brand ${small ? 'small' : ''}`} role="img" aria-label="Forme">
      {content}
    </span>
  );
}
export function Spinner({ label = '読み込み中…' }: { label?: string }) {
  return (
    <div className="loading-state">
      <LoaderCircle size={24} className="spin" />
      <span>{label}</span>
    </div>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <FileText size={28} strokeWidth={1.4} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const r = ref.current!.getBoundingClientRect();
          if (
            event.clientX < r.left ||
            event.clientX > r.right ||
            event.clientY < r.top ||
            event.clientY > r.bottom
          )
            onClose();
        }
      }}
      aria-labelledby="dialog-title"
    >
      <div className="modal-header">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon-button" aria-label="閉じる" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function ExternalLabel({ children }: { children: ReactNode }) {
  return (
    <span className="external-label">
      {children}
      <ArrowUpRight size={14} />
    </span>
  );
}

export function Pagination({
  page,
  total,
  pageSize = 10,
  onChange,
}: {
  page: number;
  total: number;
  pageSize?: number;
  onChange: (page: number) => void;
}) {
  if (total <= pageSize) return null;
  return (
    <nav className="pagination" aria-label="回答のページ切り替え">
      <span>
        {page * pageSize + 1}–{Math.min(total, (page + 1) * pageSize)} / {total}件
      </span>
      <button className="button subtle" disabled={page === 0} onClick={() => onChange(page - 1)}>
        前へ
      </button>
      <button
        className="button subtle"
        disabled={(page + 1) * pageSize >= total}
        onClick={() => onChange(page + 1)}
      >
        次へ
      </button>
    </nav>
  );
}
