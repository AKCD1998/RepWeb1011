import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import AppLayout from "./layouts/AppLayout";
import Deliver from "./pages/Deliver";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Products from "./pages/Products";
import Receiving from "./pages/Receiving";
import Reports from "./pages/Reports";

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
        <Route path="products" element={<Products />} />
        <Route path="deliver" element={<Deliver />} />
        <Route path="receiving" element={<Receiving />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
