import { Route, Routes } from "react-router-dom";
import AppLayout from "./layouts/AppLayout";
import Deliver from "./pages/Deliver";
import Home from "./pages/Home";
import Products from "./pages/Products";
import Receiving from "./pages/Receiving";
import Reports from "./pages/Reports";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<Home />} />
        <Route path="reports" element={<Reports />} />
        <Route path="products" element={<Products />} />
        <Route path="deliver" element={<Deliver />} />
        <Route path="receiving" element={<Receiving />} />
      </Route>
    </Routes>
  );
}
