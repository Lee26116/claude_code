import { create } from "zustand";
import { api } from "@/utils/api";

interface AuthState {
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem("token"),
  isAuthenticated: !!localStorage.getItem("token"),
  loading: false,
  error: null,

  login: async (username, password) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Login failed");
      }
      const data = await res.json();
      localStorage.setItem("token", data.token);
      set({ token: data.token, isAuthenticated: true, loading: false });
    } catch (e: any) {
      set({ error: e.message || "Login failed", loading: false });
    }
  },

  logout: () => {
    localStorage.removeItem("token");
    set({ token: null, isAuthenticated: false });
  },

  checkAuth: () => {
    const token = localStorage.getItem("token");
    set({ token, isAuthenticated: !!token });
  },
}));
