import { NavLink, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import { Loading } from "./components/ui";
import { AuditPage } from "./pages/Audit";
import { DashboardPage } from "./pages/Dashboard";
import { DetectorsPage } from "./pages/Detectors";
import { IncidentPage } from "./pages/Incident";
import { LoginPage } from "./pages/Login";
import { QueuePage } from "./pages/Queue";

const ROLE_LABEL = { viewer: "Viewer", analyst: "Analyst", admin: "Admin" } as const;

function Shell() {
  const { user, signOut, can } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Triage Console
        </div>
        <nav aria-label="Main">
          <NavLink to="/queue">Queue</NavLink>
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/detectors">Detectors</NavLink>
          {can("admin") && <NavLink to="/audit">Audit log</NavLink>}
        </nav>
        <div className="sidebar-user">
          <div>
            <div className="user-name">{user.name}</div>
            <div className="muted">{ROLE_LABEL[user.role]}</div>
          </div>
          <button className="btn btn-quiet" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <main id="main" className="main">
        <Outlet />
      </main>
    </div>
  );
}

function AdminOnly() {
  const { can } = useAuth();
  return can("admin") ? <Outlet /> : <Navigate to="/queue" replace />;
}

export function App() {
  const { loading } = useAuth();
  if (loading) return <Loading label="Starting" />;

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Shell />}>
        <Route index element={<Navigate to="/queue" replace />} />
        <Route path="/queue" element={<QueuePage />} />
        <Route path="/incidents/:id" element={<IncidentPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/detectors" element={<DetectorsPage />} />
        <Route element={<AdminOnly />}>
          <Route path="/audit" element={<AuditPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/queue" replace />} />
      </Route>
    </Routes>
  );
}
