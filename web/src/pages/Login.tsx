import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

const ROLE_HINT = {
  admin: "Assign anyone, reopen incidents, read the audit log",
  analyst: "Take incidents, work and grade them",
  viewer: "Read-only",
} as const;

export function LoginPage() {
  const { user, signedIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const demo = useQuery({ queryKey: ["demo-accounts"], queryFn: api.demoAccounts, staleTime: Infinity });

  const destination = (location.state as { from?: string } | null)?.from ?? "/queue";
  if (user) return <Navigate to={destination} replace />;

  async function run(action: () => Promise<{ user: Parameters<typeof signedIn>[0] }>) {
    setBusy(true);
    setError(null);
    try {
      signedIn((await action()).user);
      navigate(destination, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void run(() => api.login(email, password));
  }

  return (
    <div className="login">
      <div className="login-card">
        <div className="brand brand-large">
          <span className="brand-mark" aria-hidden="true" />
          Triage Console
        </div>
        <p className="muted">Security incidents, ranked by how often their detector finds a real threat.</p>

        <form onSubmit={onSubmit} noValidate>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary btn-block" type="submit" disabled={busy || !email || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {demo.data?.enabled && (
          <section className="demo" aria-labelledby="demo-heading">
            <h2 id="demo-heading">Demo accounts</h2>
            <p className="muted">Local demo mode. One click signs in as each role.</p>
            <ul>
              {demo.data.accounts
                .filter((a, i, all) => all.findIndex((b) => b.role === a.role) === i)
                .map((account) => (
                  <li key={account.email}>
                    <button className="btn demo-btn" disabled={busy} onClick={() => void run(() => api.demoLogin(account.email))}>
                      <span className="demo-role">{account.role}</span>
                      <span className="muted">{ROLE_HINT[account.role]}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
