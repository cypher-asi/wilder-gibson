import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initAnalytics, track } from "./lib/analytics";
import "./ui/theme.css";

const queryClient = new QueryClient();

// No-op until VITE_MIXPANEL_TOKEN is set; records a visit once configured.
initAnalytics();
track("page_view", { path: window.location.pathname });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
