import type { CSSProperties } from "react";
import { HashRouter } from "react-router-dom";

import { AppSidebar } from "@/components/app-sidebar";
import { AppTitlebarMemory } from "@/components/app-titlebar-memory";
import { AppRoutes } from "@/routes/app-routes";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";

import "./App.css";

export default function App() {
  return (
    <HashRouter>
      <SidebarProvider
        style={
          {
            "--sidebar-width": "calc(var(--spacing) * 42)",
          } as CSSProperties
        }
      >
        <AppTitlebarMemory />
        <AppSidebar variant="sidebar" />
        <SidebarInset className="bg-background">
          <AppRoutes />
        </SidebarInset>
        <Toaster position="bottom-right" />
      </SidebarProvider>
    </HashRouter>
  );
}
