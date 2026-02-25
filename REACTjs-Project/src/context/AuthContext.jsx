import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  AUTH_TOKEN_KEY,
  AUTH_UNAUTHORIZED_EVENT,
  AUTH_USER_KEY,
  clearAuthStorage,
  loginRequest,
} from "../lib/authApi";

const AuthContext = createContext(null);

function readInitialAuthState() {
  if (typeof window === "undefined") {
    return {
      token: "",
      user: null,
    };
  }

  const token = String(window.localStorage.getItem(AUTH_TOKEN_KEY) || "").trim();
  const rawUser = window.localStorage.getItem(AUTH_USER_KEY);
  let user = null;

  if (rawUser) {
    try {
      user = JSON.parse(rawUser);
    } catch {
      user = null;
    }
  }

  if (!token || !user) {
    clearAuthStorage();
    return {
      token: "",
      user: null,
    };
  }

  return {
    token,
    user,
  };
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(readInitialAuthState);

  const saveAuth = useCallback((token, user) => {
    const safeToken = String(token || "").trim();
    const safeUser = user && typeof user === "object" ? user : null;

    if (!safeToken || !safeUser) {
      clearAuthStorage();
      setAuth({ token: "", user: null });
      return;
    }

    if (typeof window !== "undefined") {
      window.localStorage.setItem(AUTH_TOKEN_KEY, safeToken);
      window.localStorage.setItem(AUTH_USER_KEY, JSON.stringify(safeUser));
    }

    setAuth({
      token: safeToken,
      user: safeUser,
    });
  }, []);

  const login = useCallback(
    async ({ username, password }) => {
      const payload = await loginRequest({ username, password });
      saveAuth(payload?.token, payload?.user);
      return payload?.user ?? null;
    },
    [saveAuth]
  );

  const logout = useCallback(() => {
    clearAuthStorage();
    setAuth({
      token: "",
      user: null,
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleUnauthorized = () => logout();
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
  }, [logout]);

  const value = useMemo(
    () => ({
      token: auth.token,
      user: auth.user,
      isAuthenticated: Boolean(auth.token && auth.user),
      login,
      logout,
      saveAuth,
    }),
    [auth.token, auth.user, login, logout, saveAuth]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
