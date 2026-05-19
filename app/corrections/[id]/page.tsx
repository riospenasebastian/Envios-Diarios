"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Link from "next/link";
import {
  ArrowLeft, CheckCircle2, XCircle, RotateCcw, MapPin,
  ExternalLink, Edit3, Save, X, User, Package,
  AlertTriangle, Zap,
} from "lucide-react";
import {
  getStatusColor, getStatusLabel, getConfidenceColor, getConfidenceLabel,
  getErrorLabel, formatDate, cn,
} from "@/lib/utils";
import Spinner from "@/components/ui/Spinner";
import Modal from "@/components/ui/Modal";

interface OrderDetail {
  id: string;
  shopifyOrderNum: string;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  origAddress1: string;
  origAddress2?: string | null;
  origCity: string;
  origState: string;
  origZip: string;
  origCountry: string;
  originalColonia?: string | null;
  sugAddress1?: string | null;
  sugAddress2?: string | null;
  sugCity?: string | null;
  sugState?: string | null;
  sugZip?: string | null;
  sugColonia?: string | null;
  sugReference?: string | null;
  detectedColonia?: string | null;
  errorType?: string | null;
  errorDetails?: string | null;
  confidence: string;
  validationNotes?: string | null;
  status: string;
  shopifyLink?: string | null;
  mapLink?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  rejectedReason?: string | null;
  appliedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  corrections: Array<{ id: string; field: string; oldValue: string | null; newValue: string | null; source: string; createdAt: string }>;
  logs: Array<{ id: string; action: string; message: string; level: string; createdAt: string }>;
}

function FieldRow({ label, orig, sug, changed }: { label: string; orig?: string | null; sug?: string | null; changed?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-4 py-2.5 border-b border-dark-700/40 last:border-0">
      <div className="text-xs font-medium text-dark-500 uppercase tracking-wider pt-0.5">{label}</div>
      <div className="text-sm text-dark-300 break-words">{orig || <span className="text-dark-600 italic">vacío</span>}</div>
      <div className={cn("text-sm break-words font-medium", changed ? "text-yellow-400" : "text-dark-400")}>
        {sug || <span className="text-dark-600 italic">sin cambio</span>}
        {changed && <span className="ml-2 text-xs bg-yellow-900/30 text-yellow-400 border border-yellow-800/50 px-1.5 py-0.5 rounded">modificado</span>}
      </div>
    </div>
  );
}

export default function CorrectionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [applyModal, setApplyModal] = useState(false);
  const [rejectModal, setRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  async function fetchOrder() {
    try {
      const res = await fetch(`/api/orders/${id}`);
      const data = await res.json();
      setOrder(data);
      setEditFields({
        sugAddress1: data.sugAddress1 ?? data.origAddress1 ?? "",
        sugAddress2: data.sugAddress2 ?? data.origAddress2 ?? "",
        sugCity: data.sugCity ?? data.origCity ?? "",
        sugState: data.sugState ?? data.origState ?? "",
        sugZip: data.sugZip ?? data.origZip ?? "",
        sugColonia: data.sugColonia ?? data.detectedColonia ?? "",
        sugReference: data.sugReference ?? "",
      });
    } catch {
      toast.error("Error cargando pedido");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchOrder(); }, [id]);

  async function doAction(action: string, extra?: object) {
    setActionLoading(action);
    try {
      const res = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(
          action === "approve" ? "Pedido aprobado" :
          action === "reject" ? "Pedido rechazado" :
          action === "edit" ? "Cambios guardados" : "Acción completada"
        );
        await fetchOrder();
        setEditing(false);
      } else {
        toast.error(data.message ?? "Error");
      }
    } catch {
      toast.error("Error de conexión");
    } finally {
      setActionLoading(null);
    }
  }

  async function applyToEnviaTodo() {
    setActionLoading("apply");
    setApplyModal(false);
    try {
      const res = await fetch(`/api/apply/${id}`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast.success("Correcciones aplicadas en EnviaTodo");
        await fetchOrder();
      } else {
        toast.error(data.message ?? "Error aplicando correcciones");
      }
    } catch {
      toast.error("Error de conexión");
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Spinner className="w-8 h-8 text-primary-400" /></div>;
  }

  if (!order) {
    return <div className="p-6 text-center text-dark-400">Pedido no encontrado.</div>;
  }

  const hasSuggestions = order.sugZip || order.sugColonia || order.sugAddress1;

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => router.back()} className="btn-ghost p-2">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-dark-100">Pedido #{order.shopifyOrderNum}</h1>
            <span className={`badge ${getStatusColor(order.status)}`}>{getStatusLabel(order.status)}</span>
            {order.confidence !== "UNKNOWN" && (
              <span className={`text-sm font-medium ${getConfidenceColor(order.confidence)}`}>
                Confianza {getConfidenceLabel(order.confidence)}
              </span>
            )}
          </div>
          <p className="text-sm text-dark-400 mt-0.5">Actualizado: {formatDate(order.updatedAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          {order.shopifyLink && (
            <a href={order.shopifyLink} target="_blank" rel="noreferrer" className="btn-secondary">
              <ExternalLink className="w-3.5 h-3.5" />
              Shopify
            </a>
          )}
          {order.mapLink && (
            <a href={order.mapLink} target="_blank" rel="noreferrer" className="btn-secondary">
              <MapPin className="w-3.5 h-3.5" />
              Mapa
            </a>
          )}
        </div>
      </div>

      {/* Error banner */}
      {order.errorType && order.errorType !== "OK" && (
        <div className={cn(
          "flex items-start gap-3 p-4 rounded-xl border",
          order.status === "CRITICAL" ? "bg-red-900/20 border-red-800/40" : "bg-yellow-900/20 border-yellow-800/40"
        )}>
          <AlertTriangle className={cn("w-4 h-4 mt-0.5 shrink-0", order.status === "CRITICAL" ? "text-red-400" : "text-yellow-400")} />
          <div>
            <p className={cn("text-sm font-medium", order.status === "CRITICAL" ? "text-red-300" : "text-yellow-300")}>
              {getErrorLabel(order.errorType)}
            </p>
            {order.errorDetails && <p className="text-xs text-dark-400 mt-0.5">{order.errorDetails}</p>}
            {order.validationNotes && <p className="text-xs text-dark-500 mt-0.5">{order.validationNotes}</p>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Customer Info */}
        <div className="card">
          <div className="card-header flex items-center gap-2">
            <User className="w-4 h-4 text-dark-500" />
            <h2 className="text-sm font-semibold text-dark-200">Cliente</h2>
          </div>
          <div className="card-body space-y-3">
            <div>
              <p className="text-xs text-dark-500">Nombre</p>
              <p className="text-sm font-medium text-dark-200">{order.customerName}</p>
            </div>
            {order.customerPhone && (
              <div>
                <p className="text-xs text-dark-500">Teléfono</p>
                <p className="text-sm text-dark-300">{order.customerPhone}</p>
              </div>
            )}
            {order.customerEmail && (
              <div>
                <p className="text-xs text-dark-500">Email</p>
                <p className="text-sm text-dark-300 break-all">{order.customerEmail}</p>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="lg:col-span-2 card">
          <div className="card-header flex items-center gap-2">
            <Package className="w-4 h-4 text-dark-500" />
            <h2 className="text-sm font-semibold text-dark-200">Acciones</h2>
          </div>
          <div className="card-body">
            <div className="flex flex-wrap gap-3">
              {(order.status === "CORRECTABLE" || order.status === "NEEDS_REVIEW" || order.status === "CRITICAL") && (
                <button onClick={() => doAction("approve")} disabled={!!actionLoading} className="btn-success">
                  {actionLoading === "approve" ? <Spinner /> : <CheckCircle2 className="w-4 h-4" />}
                  Aprobar correcciones
                </button>
              )}

              {order.status === "APPROVED" && (
                <button onClick={() => setApplyModal(true)} disabled={!!actionLoading} className="btn-primary">
                  {actionLoading === "apply" ? <Spinner /> : <Zap className="w-4 h-4" />}
                  Aplicar en EnviaTodo
                </button>
              )}

              {order.status !== "REJECTED" && order.status !== "APPLIED" && (
                <button onClick={() => setRejectModal(true)} disabled={!!actionLoading} className="btn-danger">
                  <XCircle className="w-4 h-4" />
                  Rechazar
                </button>
              )}

              <button onClick={() => doAction("revalidate")} disabled={!!actionLoading} className="btn-secondary">
                {actionLoading === "revalidate" ? <Spinner /> : <RotateCcw className="w-4 h-4" />}
                Revalidar
              </button>

              <button onClick={() => setEditing(!editing)} className="btn-secondary">
                {editing ? <X className="w-4 h-4" /> : <Edit3 className="w-4 h-4" />}
                {editing ? "Cancelar edición" : "Editar manualmente"}
              </button>

              {editing && (
                <button
                  onClick={() => doAction("edit", { fields: editFields })}
                  disabled={!!actionLoading}
                  className="btn-primary"
                >
                  {actionLoading === "edit" ? <Spinner /> : <Save className="w-4 h-4" />}
                  Guardar cambios
                </button>
              )}
            </div>

            {order.approvedAt && (
              <p className="text-xs text-emerald-400 mt-3">Aprobado: {formatDate(order.approvedAt)}</p>
            )}
            {order.rejectedAt && (
              <p className="text-xs text-red-400 mt-3">
                Rechazado: {formatDate(order.rejectedAt)}
                {order.rejectedReason && ` — ${order.rejectedReason}`}
              </p>
            )}
            {order.appliedAt && (
              <p className="text-xs text-purple-400 mt-3">Aplicado en EnviaTodo: {formatDate(order.appliedAt)}</p>
            )}
          </div>
        </div>
      </div>

      {/* Address Comparison */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-sm font-semibold text-dark-200">Comparación de dirección</h2>
          <p className="text-xs text-dark-500 mt-0.5">Izquierda: original Shopify (nunca se modifica) · Derecha: sugerencia del sistema</p>
        </div>
        <div className="card-body">
          {/* Column headers */}
          <div className="grid grid-cols-3 gap-4 pb-2 border-b border-dark-700/60 mb-1">
            <div className="text-xs font-medium text-dark-600 uppercase">Campo</div>
            <div className="text-xs font-medium text-dark-500 uppercase">Original Shopify</div>
            <div className="text-xs font-medium text-dark-500 uppercase">
              {editing ? "Editar" : "Sugerido"}
            </div>
          </div>

          {editing ? (
            <div className="space-y-1">
              {[
                { key: "sugAddress1", label: "Calle / Número" },
                { key: "sugColonia", label: "Colonia" },
                { key: "sugAddress2", label: "Referencias" },
                { key: "sugCity", label: "Ciudad" },
                { key: "sugState", label: "Estado" },
                { key: "sugZip", label: "CP" },
                { key: "sugReference", label: "Ref. adicional" },
              ].map(({ key, label }) => (
                <div key={key} className="grid grid-cols-3 gap-4 py-2 border-b border-dark-700/40 last:border-0 items-center">
                  <div className="text-xs font-medium text-dark-500 uppercase tracking-wider">{label}</div>
                  <div className="text-sm text-dark-400">
                    {((order as unknown) as Record<string, unknown>)[key.replace("sug", "orig").toLowerCase()] as string ??
                     (key === "sugColonia" ? order.originalColonia : null) ?? "—"}
                  </div>
                  <input
                    type="text"
                    className="input text-sm py-1.5"
                    value={editFields[key] ?? ""}
                    onChange={(e) => setEditFields((f) => ({ ...f, [key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div>
              <FieldRow label="Calle / Núm." orig={order.origAddress1} sug={order.sugAddress1} changed={!!(order.sugAddress1 && order.sugAddress1 !== order.origAddress1)} />
              <FieldRow label="Colonia" orig={order.originalColonia ?? order.origAddress2} sug={order.sugColonia} changed={!!order.sugColonia} />
              <FieldRow label="Referencias" orig={order.origAddress2} sug={order.sugAddress2} changed={!!(order.sugAddress2 && order.sugAddress2 !== order.origAddress2)} />
              <FieldRow label="Ciudad" orig={order.origCity} sug={order.sugCity} changed={!!(order.sugCity && order.sugCity !== order.origCity)} />
              <FieldRow label="Estado" orig={order.origState} sug={order.sugState} changed={!!(order.sugState && order.sugState !== order.origState)} />
              <FieldRow label="CP" orig={order.origZip} sug={order.sugZip} changed={!!(order.sugZip && order.sugZip !== order.origZip)} />
              {order.sugReference && (
                <FieldRow label="Ref. adicional" orig="" sug={order.sugReference} changed />
              )}
            </div>
          )}
        </div>
      </div>

      {/* History */}
      {order.corrections.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="text-sm font-semibold text-dark-200">Historial de cambios</h2>
          </div>
          <div className="divide-y divide-dark-700/30">
            {order.corrections.map((c) => (
              <div key={c.id} className="px-5 py-2.5 flex items-center gap-4 text-xs">
                <span className="font-mono text-primary-400 w-24 shrink-0">{c.field}</span>
                <span className="text-dark-500 line-through">{c.oldValue ?? "—"}</span>
                <span className="text-dark-400">→</span>
                <span className="text-dark-200">{c.newValue ?? "—"}</span>
                <span className="ml-auto text-dark-600">{c.source}</span>
                <span className="text-dark-600">{formatDate(c.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Apply Modal */}
      <Modal open={applyModal} onClose={() => setApplyModal(false)} title="Aplicar en EnviaTodo" size="sm">
        <div className="space-y-4">
          <div className="p-4 rounded-lg bg-primary-900/20 border border-primary-800/40">
            <p className="text-sm text-primary-300">
              Playwright abrirá EnviaTodo y aplicará las correcciones aprobadas para el pedido <strong>#{order.shopifyOrderNum}</strong>.
            </p>
            <p className="text-xs text-dark-400 mt-2">
              Las correcciones se aplicarán ÚNICAMENTE dentro de EnviaTodo. Shopify NO será modificado.
            </p>
          </div>
          <div className="flex gap-3 justify-end">
            <button className="btn-secondary" onClick={() => setApplyModal(false)}>Cancelar</button>
            <button className="btn-primary" onClick={applyToEnviaTodo}>
              <Zap className="w-4 h-4" />
              Confirmar y aplicar
            </button>
          </div>
        </div>
      </Modal>

      {/* Reject Modal */}
      <Modal open={rejectModal} onClose={() => setRejectModal(false)} title={`Rechazar pedido #${order.shopifyOrderNum}`} size="sm">
        <div className="space-y-4">
          <textarea
            className="input h-24 resize-none"
            placeholder="Motivo (opcional)..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <div className="flex gap-3 justify-end">
            <button className="btn-secondary" onClick={() => setRejectModal(false)}>Cancelar</button>
            <button className="btn-danger" onClick={async () => { await doAction("reject", { reason: rejectReason }); setRejectModal(false); }}>
              Rechazar
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
