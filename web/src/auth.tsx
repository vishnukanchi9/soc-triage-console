import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { ApiError, api, type Role, type User } from "./api";

interface AuthState {
  user: User | null;
  loading: boolean;
  signedIn(user: User): void;
  signOut(): Promise<void>;
  /** True when the signed-in user holds one of the given roles. The server enforces the same rule. */
  can(...roles: Role[]): boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return (await api.me()).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: Infinity,
    retry: false,
  });

  /**
   * Switches the session user and drops everything cached for the previous one.
   * The "me" query is updated in place rather than cleared: clearing would detach
   * it from the observer above, and the new user would never reach the UI.
   */
  const switchUser = useCallback(
    (user: User | null) => {
      queryClient.setQueryData(["me"], user);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" && q.queryKey[0] !== "demo-accounts" });
    },
    [queryClient],
  );

  const signedIn = useCallback((user: User) => switchUser(user), [switchUser]);

  const signOut = useCallback(async () => {
    await api.logout();
    switchUser(null);
  }, [switchUser]);

  const value = useMemo<AuthState>(() => {
    const user = data ?? null;
    return { user, loading: isLoading, signedIn, signOut, can: (...roles) => !!user && roles.includes(user.role) };
  }, [data, isLoading, signedIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
