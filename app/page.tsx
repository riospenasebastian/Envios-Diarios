"use client";

import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import {
  Package, AlertTriangle, CheckCircle2, XCircle,
  RefreshCw, Clock, Zap, Database,
  ArrowRight, AlertCircle, Timer, BarChart3, Activity,
  TrendingUp,
} from "lucide-react";
import { formatDate, getStatusColor, getStatusLabel, getErrorLabel, getConfidenceColor, getConfidenceLabel } from "@/lib/utils";
import Spinner from "@/components/ui/Spinner";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface DashboardData {
  total: number;
  pending: number;
  analyzing: number;
  correctable: number;
  needsReview: number;
  critical: number;
  approved: number;
  rejected: number;
  applied: number;
  ok: number;
  syncesToday: number;
  ordersApprovedToday: number;
  ordersAppliedToday: number;
  tiempoAhorrado: string;
  procesadosPct: number;
  recentLogs: Array<{
    id: string; action: string; message: string; level: string;
    createdAt: string; order?: { shopifyOrderNum: string } | null;
  }>;
  recentOrders: Array<{
    id: string; shopifyOrderNum: string; customerName: string;
    status: string; errorType: string | null; confidence: string;
    updatedAt: string; origCity: string; origState: string;
  }>;
  sepomexLoaded: boolean;
  sepomexCount: number;
}

function StatCard({ label, value, icon: Icon, color, href, subtext }: {
  label: string; value: string | number; icon: React.ElementType;
  color: string; href?: string; subtext?: string;
}) {
  const content = (
    <div className={cn(
      "stat-card group hover:border-dark-600 transition-all duration-150",
      href && "cursor-pointer"
    )}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-dark-500 uppercase tracking-wider">{label}</p>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className="text-3xl font-bold text-dark-100 mt-2 leading-none">{value}</p>
      <div className="flex items-center justify-between mt-2">
        {subtext && <p className="text-xs text-dark-600">{subtext}</p>}
        {href && (
          <div className="flex items-center gap-1 text-xs text-dark-600 group-hover:text-primary-400 transition-colors ml-auto">
            <span>Ver</span>
            <ArrowRight className="w-3 h-3" />
          </div>
        )}
      </div>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

function LogLevelBadge({ level }: { level: string }) {
  const styles: Record<string, string> = {
    ERROR: "text-red-400 bg-red-900/20 border border-red-900/40",
    WARN: "text-yellow-400 bg-yellow-900/20 border border-yellow-900/40",
    SUCCESS: "text-emerald-400 bg-emerald-900/20 border border-emerald-900/40",
    INFO: "text-blue-400 bg-blue-900/20 border border-blue-900/40",
  };
  return (
    <span className={cn("px-1.5 py-0.5 rounded text-xs font-mono", styles[level] ?? "text-dark-500 bg-dark-800")}>
      {level}
    </span>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard");
      setData(await res.json());
    } catch {
      toast.error("Error cargando dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 30000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(`Sync completa: ${json.newOrders} nuevos, ${json.updated} actualizados`);
        await fetchDashboard();
      } else {
        toast.error(json.message ?? "Error en sincronización");
      }
    } catch {
      toast.error("Error de conexión");
    } finally {
      setSyncing(false);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Spinner className="w-8 h-8 text-primary-400" /></div>;
  }

  const d = data!;
  const actionRequired = d.correctable + d.needsReview + d.critical;

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* ── Header ───────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-dark-100">Dashboard</h1>
          <p className="text-sm text-dark-400 mt-0.5">
            {actionRequired > 0
              ? <span className="text-yellow-400">{actionRequired} pedidos requieren atención</span>
              : <span className="text-emerald-400">Todo en orden</span>
            }
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!d.sepomexLoaded && (
            <Link href="/settings" className="flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-900/20 border border-yellow-800/40 text-yellow-400 text-xs hover:bg-yellow-900/30 transition-colors">
              <AlertTriangle className="w-3.5 h-3.5" /> Sin base SEPOMEX
            </Link>
          )}
          {d.sepomexLoaded && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-dark-800 border border-dark-700 text-xs text-dark-400">
              <Database className="w-3.5 h-3.5 text-emerald-400" />
              {d.sepomexCount.toLocaleString()} colonias
            </div>
          )}
          <button onClick={handleSync} disabled={syncing} className="btn-primary">
            {syncing ? <Spinner /> : <RefreshCw className="w-4 h-4" />}
            Sincronizar pedidos
          </button>
        </div>
      </div>

      {/* ── KPIs del día ─────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary-600/20 flex items-center justify-center shrink-0">
            <Activity className="w-4 h-4 text-primary-400" />
          </div>
          <div>
            <p className="text-xs text-dark-500">Syncs hoy</p>
            <p className="text-xl font-bold text-dark-100">{d.syncesToday}</p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-600/20 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <p className="text-xs text-dark-500">Aprobados hoy</p>
            <p className="text-xl font-bold text-dark-100">{d.ordersApprovedToday}</p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-purple-600/20 flex items-center justify-center shrink-0">
            <Zap className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <p className="text-xs text-dark-500">Aplicados hoy</p>
            <p className="text-xl font-bold text-dark-100">{d.ordersAppliedToday}</p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-600/20 flex items-center justify-center shrink-0">
            <Timer className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <p className="text-xs text-dark-500">Tiempo ahorrado</p>
            <p className="text-xl font-bold text-dark-100">{d.tiempoAhorrado}</p>
          </div>
        </div>
      </div>

      {/* ── Stats principales ─────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-4">
        <StatCard label="Total pedidos" value={d.total} icon={Package}
          color="bg-primary-600/20 text-primary-400" href="/orders" />
        <StatCard label="Corregibles" value={d.correctable} icon={BarChart3}
          color="bg-yellow-600/20 text-yellow-400" href="/orders?status=CORRECTABLE" />
        <StatCard label="Críticos" value={d.critical} icon={XCircle}
          color="bg-red-600/20 text-red-400" href="/orders?status=CRITICAL" />
        <StatCard label="Aprobados" value={d.approved} icon={CheckCircle2}
          color="bg-emerald-600/20 text-emerald-400" href="/orders?status=APPROVED" />
        <StatCard label="Aplicados" value={d.applied} icon={Zap}
          color="bg-purple-600/20 text-purple-400" href="/orders?status=APPLIED" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Pendientes" value={d.pending + d.analyzing} icon={Clock}
          color="bg-dark-600/40 text-dark-400" href="/orders?status=PENDING" />
        <StatCard label="Req. revisión" value={d.needsReview} icon={AlertCircle}
          color="bg-orange-600/20 text-orange-400" href="/orders?status=NEEDS_REVIEW" />
        <StatCard label="Rechazados" value={d.rejected} icon={XCircle}
          color="bg-dark-600/40 text-dark-500" href="/orders?status=REJECTED" />
        <StatCard label="Sin errores" value={d.ok} icon={CheckCircle2}
          color="bg-emerald-700/20 text-emerald-500" href="/orders?status=OK" />
      </div>

      {/* ── Progress ──────────────────────────────────── */}
      {d.total > 0 && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary-400" />
              <p className="text-sm font-medium text-dark-300">Progreso de validación</p>
            </div>
            <p className="text-sm font-bold text-primary-400">{d.procesadosPct}%</p>
          </div>
          <div className="w-full h-2.5 bg-dark-800 rounded-full overflow-hidden flex gap-0.5">
            {[
              { val: d.ok,          color: "bg-emerald-500" },
              { val: d.approved,    color: "bg-green-500" },
              { val: d.applied,     color: "bg-purple-500" },
              { val: d.correctable, color: "bg-yellow-500" },
              { val: d.needsReview, color: "bg-orange-500" },
              { val: d.critical,    color: "bg-red-500" },
            ].map(({ val, color }, i) => val > 0 && (
              <div key={i} className={`h-full ${color} rounded-sm`}
                style={{ width: `${(val / d.total) * 100}%` }} />
            ))}
          </div>
          <div className="flex items-center gap-4 mt-2.5 flex-wrap">
            {[
              { label: "Correctos",   color: "bg-emerald-500", val: d.ok },
              { label: "Aprobados",   color: "bg-green-500",   val: d.approved },
              { label: "Aplicados",   color: "bg-purple-500",  val: d.applied },
              { label: "Corregibles", color: "bg-yellow-500",  val: d.correctable },
              { label: "Revisión",    color: "bg-orange-500",  val: d.needsReview },
              { label: "Críticos",    color: "bg-red-500",     val: d.critical },
            ].map(({ label, color, val }) => (
              <span key={label} className="flex items-center gap-1.5 text-xs text-dark-500">
                <span className={`w-2 h-2 rounded-full ${color}`} />
                {label} ({val})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Bottom grid ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pedidos recientes */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h2 className="text-sm font-semibold text-dark-200">Pedidos recientes</h2>
            <Link href="/orders" className="text-xs text-primary-400 hover:text-primary-300">Ver todos →</Link>
          </div>
          <div className="divide-y divide-dark-700/30">
            {d.recentOrders.length === 0 ? (
              <div className="p-6 text-center text-sm text-dark-500">
                Sin pedidos. Sincroniza para comenzar.
              </div>
            ) : (
              d.recentOrders.map((order) => (
                <Link key={order.id} href={`/corrections/${order.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-dark-800/40 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-primary-400">#{order.shopifyOrderNum}</span>
                      <span className={`badge text-xs ${getStatusColor(order.status)}`}>
                        {getStatusLabel(order.status)}
                      </span>
                    </div>
                    <p className="text-xs text-dark-500 mt-0.5 truncate">
                      {order.customerName} · {order.origCity}, {order.origState}
                    </p>
                  </div>
                  <div className="text-right">
                    {order.errorType && (
                      <p className="text-xs text-dark-500">{getErrorLabel(order.errorType)}</p>
                    )}
                    <p className={`text-xs font-medium ${getConfidenceColor(order.confidence)}`}>
                      {getConfidenceLabel(order.confidence)}
                    </p>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Actividad reciente */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h2 className="text-sm font-semibold text-dark-200">Actividad reciente</h2>
            <Link href="/logs" className="text-xs text-primary-400 hover:text-primary-300">Ver logs →</Link>
          </div>
          <div className="divide-y divide-dark-700/20">
            {d.recentLogs.length === 0 ? (
              <div className="p-6 text-center text-sm text-dark-500">Sin actividad aún.</div>
            ) : (
              d.recentLogs.slice(0, 10).map((logEntry) => (
                <div key={logEntry.id} className="flex items-start gap-3 px-4 py-2">
                  <LogLevelBadge level={logEntry.level} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-dark-300 truncate">{logEntry.message}</p>
                    {logEntry.order && (
                      <p className="text-xs text-dark-600">#{logEntry.order.shopifyOrderNum}</p>
                    )}
                  </div>
                  <p className="text-xs text-dark-700 shrink-0">{formatDate(logEntry.createdAt)}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
