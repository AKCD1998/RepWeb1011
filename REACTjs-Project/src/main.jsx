import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./ThemeProvider";
import "./Report1011.css";
import "./AppLayout.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </HashRouter>
    </ThemeProvider>
  </React.StrictMode>
);
