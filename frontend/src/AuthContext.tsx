import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  fetchCurrentUser,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  retryOnNetworkFailure,
  type AuthUser,
} from "./api";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  // For SettingsScreen after a profile/avatar update — the backend already
  // returned the fresh user, so this just syncs context without a refetch.
  setUser: (user: AuthUser) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // retryOnNetworkFailure only retries a rejected fetch (no network yet,
    // a mid-update service worker) — a resolved `null` from
    // fetchCurrentUser (a real 401) is returned immediately, never
    // retried, so a genuinely logged-out visitor still sees the login
    // screen without delay.
    function checkSession() {
      retryOnNetworkFailure(fetchCurrentUser)
        .then((u) => {
          if (!cancelled) setUser(u);
        })
        .catch(() => {
          if (!cancelled) setUser(null);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    checkSession();

    // Reported: reopening the app (Brave/Edge on Windows specifically)
    // still showed the user as logged out even with this retry in place —
    // those browsers can suspend/freeze a tab instead of actually killing
    // it, so "reopening" it never re-mounts this provider and the retry
    // above never runs again; the page just resumes the exact in-memory
    // React state from whenever it froze. Re-checking whenever the tab
    // becomes visible again catches that case without needing to know
    // which specific browser mechanism caused it.
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") checkSession();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const loggedIn = await apiLogin(email, password);
    setUser(loggedIn);
  }, []);

  const register = useCallback(async (email: string, password: string, name?: string) => {
    const created = await apiRegister(email, password, name);
    setUser(created);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, setUser }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
