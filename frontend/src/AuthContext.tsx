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
    // `initial`: the first check at mount, where there's no known state
    // to keep and an unreachable backend has to resolve to "not logged
    // in". On the visibility re-checks below it's the opposite: the user
    // was logged in a moment ago, so a request that *fails* (the backend
    // mid-redeploy behind the proxy, a phone whose network hasn't come
    // back yet after switching apps) proves nothing about the session
    // and must leave them where they are — only a real 401 (a resolved
    // null) logs them out. Reported: coming back from copying something
    // in another app, the user was dropped out of the tree to the login
    // screen with their half-filled form gone.
    function checkSession(initial: boolean) {
      retryOnNetworkFailure(fetchCurrentUser)
        .then((u) => {
          if (cancelled) return;
          // Same user as before: keep the existing object so nothing
          // keyed on it re-renders or resets for no reason.
          setUser((current) => {
            const unchanged = current && u && current.id === u.id && current.name === u.name && current.avatarUrl === u.avatarUrl;
            return unchanged ? current : u;
          });
        })
        .catch(() => {
          if (!cancelled && initial) setUser(null);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    checkSession(true);

    // Reported: reopening the app (Brave/Edge on Windows specifically)
    // still showed the user as logged out even with this retry in place —
    // those browsers can suspend/freeze a tab instead of actually killing
    // it, so "reopening" it never re-mounts this provider and the retry
    // above never runs again; the page just resumes the exact in-memory
    // React state from whenever it froze. Re-checking whenever the tab
    // becomes visible again catches that case without needing to know
    // which specific browser mechanism caused it.
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") checkSession(false);
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
