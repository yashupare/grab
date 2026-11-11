import { create } from "zustand";

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
  action?: { label: string; run: () => void };
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
}

let next = 1;

export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = next++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => get().dismiss(id), t.kind === "error" ? 7000 : 4000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (message: string, action?: Toast["action"]) => useToasts.getState().push({ kind: "success", message, action }),
  error: (message: string) => useToasts.getState().push({ kind: "error", message }),
  info: (message: string, action?: Toast["action"]) => useToasts.getState().push({ kind: "info", message, action }),
};
