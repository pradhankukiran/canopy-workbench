import { Outlet } from "react-router-dom";
import { Header } from "./header";

export function AppShell() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-[1440px] px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
