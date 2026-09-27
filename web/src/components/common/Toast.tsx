// src/components/common/Toast.tsx
import React, { createContext, useContext, useState, useCallback } from "react";

type ToastType = "success" | "error" | "info" | "warning";

interface Toast {
  id: number;
  title: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  toasts: Toast[];
  showToast: (title: string, message: string, type?: ToastType, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType>({ toasts: [], showToast: () => {} });

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((title: string, message: string, type: ToastType = "info", duration = 3200) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, title, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, showToast }}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            <div className="toast-bar" />
            <div>
              <div className="toast-title">{t.title}</div>
              <div className="toast-msg">{t.message}</div>
            </div>
            <button className="toast-close" onClick={() => setToasts((prev) => prev.filter((toast) => toast.id !== t.id))} type="button">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => useContext(ToastContext);
