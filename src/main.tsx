import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./styles/index.css";
import { router } from "./app/router";
import { applyTheme, useUi } from "./stores/ui";

// Apply the saved theme before the first paint, then keep it in sync.
applyTheme(useUi.getState().theme);
useUi.subscribe((s, prev) => {
  if (s.theme !== prev.theme) applyTheme(s.theme);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
