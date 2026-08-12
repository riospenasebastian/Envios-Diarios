"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Package, Wrench,
  Settings, ScrollText, Truck, Zap,
  Sun, Moon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/providers/ThemeProvider";

const navItems = [
  { href: "/",            icon: LayoutDashboard, label: "Dashboard"      },
  { href: "/orders",      icon: Package,         label: "Pedidos"        },
  { href: "/corrections", icon: Wrench,          label: "Correcciones"   },
  { href: "/logs",        icon: ScrollText,      label: "Logs"           },
  { href: "/settings",    icon: Settings,        label: "Configuración"  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();

  return (
    <aside className="w-[220px] xl:w-[240px] 2xl:w-[260px] shrink-0 bg-dark-900 border-r border-dark-700/50 flex flex-col">

      {/* ── Brand ─────────────────────────────────────────── */}
      <div className="h-[56px] flex items-center px-4 border-b border-dark-700/50 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {/* Logo mark */}
          <div className="w-8 h-8 bg-primary-600 rounded-[10px] flex items-center justify-center shrink-0 shadow-sm shadow-primary-900/40">
            <Truck className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-dark-100 leading-tight tracking-tight truncate">
              EnvíosSaaS
            </p>
            <p className="text-xs text-dark-500 leading-tight">Logística</p>
          </div>
        </div>
      </div>

      {/* ── Navigation ────────────────────────────────────── */}
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {navItems.map(({ href, icon: Icon, label }) => {
          const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(isActive ? "sidebar-item-active" : "sidebar-item-inactive")}
            >
              <Icon className={cn(
                "w-[18px] h-[18px] shrink-0",
                isActive ? "text-primary-400" : "text-dark-500 group-hover:text-dark-300"
              )} />
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* ── Footer ────────────────────────────────────────── */}
      <div className="px-3 pb-3 pt-2 border-t border-dark-700/50 space-y-2">

        {/* Theme toggle */}
        <button
          onClick={toggle}
          title={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
          className={cn(
            "w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-[13px] font-medium",
            "border transition-all duration-150 active:scale-[0.97]",
            "bg-dark-800/60 hover:bg-dark-800 text-dark-400 hover:text-dark-200",
            "border-dark-700/60 hover:border-dark-600"
          )}
        >
          <span className="flex items-center gap-2.5">
            {theme === "dark"
              ? <Moon className="w-3.5 h-3.5 text-primary-400" />
              : <Sun  className="w-3.5 h-3.5 text-yellow-500" />}
            {theme === "dark" ? "Modo oscuro" : "Modo claro"}
          </span>

          {/* Toggle pill */}
          <div className={cn(
            "relative w-8 h-4 rounded-full transition-colors duration-200 shrink-0",
            theme === "dark" ? "bg-primary-600" : "bg-yellow-400"
          )}>
            <div className={cn(
              "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform duration-200 shadow-sm",
              theme === "dark" ? "left-0.5" : "translate-x-4"
            )} />
          </div>
        </button>

        {/* Version chip — sirve para confirmar de un vistazo que corre la
            versión con los cambios de notas del carrito y pop-ups. */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-900/20 border border-emerald-700/40">
          <Zap className="w-3 h-3 text-emerald-400 shrink-0" />
          <div className="leading-tight">
            <span className="block text-xs text-emerald-300 tabular-nums font-medium">
              Local · v1.1
            </span>
            <span className="block text-[10px] text-emerald-500/80">
              Notas del carrito + pop-ups
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
