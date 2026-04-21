import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import AppLayout from "./layouts/AppLayout";
import AdminIncidentReports from "./pages/AdminIncidentReports";
import AdminPatients from "./pages/AdminPatients";
import Deliver from "./pages/Deliver";
import Home from "./pages/Home";
import Login from "./pages/Login";
import PatientPurchaseHistory from "./pages/PatientPurchaseHistory";
import Products from "./pages/Products";
import Receiving from "./pages/Receiving";
import Reports from "./pages/Reports";
import SqlEditor from "./pages/SqlEditor";

function toCleanText(value) {
  return String(value || "").trim();
}

function RequireAuth({ children }) {
  const location = useLocation();
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: location.pathname + location.search,
        }}
      />
    );
  }

  return children;
}

function PublicOnly({ children }) {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function RequireAdmin({ children }) {
  const { user } = useAuth();
  const role = toCleanText(user?.role).toUpperCase();

  if (role !== "ADMIN") {
    return <Navigate to="/" replace />;
  }

  return children;
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnly>
            <Login />
          </PublicOnly>
        }
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Home />} />
        <Route path="reports" element={<Reports />} />
        <Route
          path="admin/incidents"
          element={
            <RequireAdmin>
              <AdminIncidentReports />
            </RequireAdmin>
          }
        />
        <Route
          path="admin/patients"
          element={
            <RequireAdmin>
              <AdminPatients />
            </RequireAdmin>
          }
        />
        <Route
          path="products"
          element={
            <RequireAdmin>
              <Products />
            </RequireAdmin>
          }
        />
        <Route path="deliver" element={<Deliver />} />
        <Route path="patient-history" element={<PatientPurchaseHistory />} />
        <Route path="receiving" element={<Receiving />} />
        <Route
          path="sql-editor"
          element={
            <RequireAdmin>
              <SqlEditor />
            </RequireAdmin>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
