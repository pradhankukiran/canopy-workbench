import { cn } from "@/lib/utils";
import { BarChart3 } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

const navItems = [
  { to: "/", label: "Modules" },
  { to: "/property-cat-pricing", label: "Pricing" },
  { to: "/ils-parametric-trigger", label: "Trigger Sim" },
] as const;

export function Header() {
  const location = useLocation();

  return (
    <header className="border-b border-border bg-card shadow-sm">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-6 px-4">
        <Link to="/" className="flex items-center gap-2 font-semibold text-foreground">
          <BarChart3 className="h-5 w-5 text-primary" />
          <span className="text-sm tracking-tight">Canopy Workbench</span>
        </Link>

        <nav className="flex items-center gap-1" aria-label="Main navigation">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                location.pathname === item.to
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
