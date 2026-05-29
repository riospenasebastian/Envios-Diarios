"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import Link from "next/link";
import {
  Search, RefreshCw, CheckCircle2, XCircle, MapPin,
  RotateCcw, ChevronLeft, ChevronRight, ExternalLink,
  X, Save, Edit3, ChevronDown, Zap, Clock, AlertTriangle,
  User, Hash, Info, Database, Globe, Square, Play,
  StopCircle, Trash2, List, CheckSquare, Copy, Send,
  Eye, EyeOff, GripVertical,
} from "lucide-react";
import {
  getStatusColor, getStatusLabel, getConfidenceColor, getConfidenceLabel,
  getErrorLabel, getErrorColor, formatDate, cn,
} from "@/lib/utils";
import Spinner from "@/components/ui/Spinner";
import Modal from "@/components/ui/Modal";
import type { OrderWithDetails, ColoniaSugerida } from "@/types";

// ────────────────────────────────────────────────────────
// Constantes
// ────────────────────────────────────────────────────────
const QUICK_FILTERS = [
  { value: "ALL",          label: "Todos",          color: "text-dark-300" },
  { value: "CRITICAL",     label: "Críticos",       color: "text-red-400" },
  { value: "CORRECTABLE",  label: "Corregibles",    color: "text-yellow-400" },
  { value: "NEEDS_REVIEW", label: "Req. revisión",  color: "text-orange-400" },
  { value: "APPROVED",     label: "Aprobados",      color: "text-emerald-400" },
  { value: "APPLIED",      label: "Aplicados",      color: "text-purple-400" },
  { value: "OK",           label: "Correctos",      color: "text-emerald-500" },
  { value: "PENDING",      label: "Pendientes",     color: "text-dark-400" },
  { value: "REJECTED",     label: "Rechazados",     color: "text-dark-500" },
];

const ERROR_FILTERS = [
  { value: "SIN_COLONIA",               label: "Sin colonia" },
  { value: "CP_INCORRECTO",             label: "CP incorrecto" },
  { value: "COLONIA_MAL_ESCRITA",       label: "Colonia mal escrita" },
  { value: "DIRECCION_LARGA",           label: "Dir. larga" },
  { value: "DIRECCION_INVALIDA",        label: "Dir. inválida" },
  { value: "SIN_COLONIA_CP_INCORRECTO", label: "Sin col.+CP" },
];

const AUTO_REFRESH_OPTIONS = [
  { value: "0",   label: "Off" },
  { value: "120", label: "2 min" },
  { value: "300", label: "5 min" },
  { value: "600", label: "10 min" },
];

const DEFAULT_ORDERS_FLOW = "__DEFAULT_ORDERS_NAV__";

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────
function timeAgo(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// ────────────────────────────────────────────────────────
// Sub-componentes del panel lateral
// ────────────────────────────────────────────────────────
function ValidationSourceBadge({ source, notes }: { source?: string | null; notes?: string | null }) {
  if (!notes && !source) return null;
  const isSepomex = source === "sepomex" || notes?.includes("SEPOMEX") || notes?.includes("SEPOMEX");
  const isMiCp = source === "micodigopostal" || notes?.includes("micodigopostal");
  return (
    <div className={cn(
      "flex items-start gap-1.5 px-2 py-1.5 rounded-lg text-xs border",
      isSepomex ? "bg-emerald-900/10 border-emerald-800/20 text-emerald-400"
        : isMiCp ? "bg-blue-900/10 border-blue-800/20 text-blue-400"
        : "bg-dark-800/50 border-dark-700/40 text-dark-500"
    )}>
      {isSepomex ? <Database className="w-3 h-3 shrink-0 mt-0.5" />
        : isMiCp ? <Globe className="w-3 h-3 shrink-0 mt-0.5" />
        : <Info className="w-3 h-3 shrink-0 mt-0.5" />}
      <span className="leading-relaxed">{notes || (isSepomex ? "Validado con SEPOMEX" : isMiCp ? "Validado con micodigopostal.org" : "Validado")}</span>
    </div>
  );
}

function CompareRow({ label, orig, sug }: { label: string; orig?: string | null; sug?: string | null }) {
  const hasChange = sug && orig && sug !== orig;
  return (
    <div className="grid grid-cols-[60px_1fr] gap-1 items-start py-0.5">
      <span className="text-dark-600 text-xs font-medium pt-0.5">{label}</span>
      <div className="min-w-0">
        {hasChange ? (
          <div className="space-y-0.5">
            <p className="text-dark-500 line-through text-xs break-all">{orig}</p>
            <p className="text-yellow-300 font-semibold text-xs break-all">{sug}</p>
          </div>
        ) : (
          <p className="text-dark-300 text-xs break-all">{sug || orig || <span className="text-dark-700">—</span>}</p>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────
// Picker de colonias (cuando hay varias opciones disponibles)
// ────────────────────────────────────────────────────────
interface ColoniaPickerProps {
  colonias: ColoniaSugerida[];
  currentZip: string;
  selectedColonia?: string;
  onSelect: (colonia: string, cp: string) => void;
  loading: boolean;
}

function ColoniaPicker({ colonias, currentZip, selectedColonia, onSelect, loading }: ColoniaPickerProps) {
  if (colonias.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold text-amber-500/80 uppercase tracking-wider flex items-center gap-1.5">
        <MapPin className="w-3 h-3" />
        Colonias disponibles — toca la correcta
      </p>
      <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
        {colonias.map((c, i) => {
          const isSelected = c.colonia === selectedColonia;
          const cpDiffers  = c.cp && c.cp !== currentZip;
          return (
            <button
              key={i}
              disabled={loading}
              onClick={() => onSelect(c.colonia, c.cp)}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs border transition-all",
                isSelected
                  ? "border-emerald-500 bg-emerald-900/25 text-emerald-300 font-semibold"
                  : "border-dark-600 bg-dark-800/80 text-dark-300 hover:border-primary-500 hover:bg-primary-900/20 hover:text-primary-300"
              )}
              title={cpDiffers ? `CP: ${c.cp}` : undefined}
            >
              <span>{c.colonia}</span>
              {cpDiffers && (
                <span className={cn("font-mono text-[10px]", isSelected ? "text-emerald-500" : "text-dark-600")}>
                  {c.cp}
                </span>
              )}
              {c.matchPct !== undefined && !isSelected && (
                <span className="text-dark-700 text-[10px]">{c.matchPct}%</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface DetailPanelProps {
  order: OrderWithDetails;
  onClose: () => void;
  onAction: (action: string, extra?: object) => Promise<void>;
  actionLoading: string | null;
}

function DetailPanel({ order, onClose, onAction, actionLoading }: DetailPanelProps) {
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState({
    sugAddress1: order.sugAddress1 ?? order.origAddress1,
    sugColonia: order.sugColonia ?? order.detectedColonia ?? "",
    sugAddress2: order.sugAddress2 ?? order.origAddress2 ?? "",
    sugCity: order.sugCity ?? order.origCity,
    sugState: order.sugState ?? order.origState,
    sugZip: order.sugZip ?? order.origZip,
    sugReference: order.sugReference ?? "",
  });

  useEffect(() => {
    setFields({
      sugAddress1: order.sugAddress1 ?? order.origAddress1,
      sugColonia: order.sugColonia ?? order.detectedColonia ?? "",
      sugAddress2: order.sugAddress2 ?? order.origAddress2 ?? "",
      sugCity: order.sugCity ?? order.origCity,
      sugState: order.sugState ?? order.origState,
      sugZip: order.sugZip ?? order.origZip,
      sugReference: order.sugReference ?? "",
    });
    setEditing(false);
  }, [order.id]);

  // Parsear colonias sugeridas para el picker (modo vista)
  const coloniasSugeridas: ColoniaSugerida[] = (() => {
    try {
      if (!order.sugColoniasJson) return [];
      const parsed = JSON.parse(order.sugColoniasJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  })();

  // Clic en chip de colonia (modo vista): guarda inmediatamente
  const handleColoniaSelect = async (colonia: string, cp: string) => {
    const newFields = {
      ...fields,
      sugColonia: colonia,
      sugZip: cp && cp !== order.origZip ? cp : fields.sugZip,
    };
    setFields(newFields);
    await onAction("edit", { fields: newFields });
  };

  // ── Colonias del CP en modo edición manual ────────────────────────────────
  const [cpColonias, setCpColonias] = useState<ColoniaSugerida[]>([]);
  const [cpLoading, setCpLoading]   = useState(false);

  useEffect(() => {
    if (!editing) { setCpColonias([]); return; }
    const cp = fields.sugZip?.trim().replace(/\D/g, "");
    if (!cp || cp.length !== 5) { setCpColonias([]); return; }
    const timer = setTimeout(async () => {
      setCpLoading(true);
      try {
        const res  = await fetch(`/api/colonias?cp=${cp}`);
        const data = await res.json();
        setCpColonias(data.colonias ?? []);
      } catch { setCpColonias([]); }
      finally { setCpLoading(false); }
    }, 350);
    return () => clearTimeout(timer);
  }, [fields.sugZip, editing]);

  // Clic en chip de colonia en modo edición: solo actualiza el estado local
  const handleEditColoniaSelect = (colonia: string, cp: string) => {
    setFields((f) => ({
      ...f,
      sugColonia: colonia,
      sugZip: cp && cp !== order.origZip ? cp : f.sugZip,
    }));
  };

  // ── Autocomplete de colonia por nombre ────────────────────────────────────
  const [coloniaSearch, setColoniaSearch] = useState<ColoniaSugerida[]>([]);
  const [coloniaSearching, setColoniaSearching] = useState(false);

  useEffect(() => {
    if (!editing) { setColoniaSearch([]); return; }
    const q = fields.sugColonia?.trim();
    if (!q || q.length < 3) { setColoniaSearch([]); return; }
    const timer = setTimeout(async () => {
      setColoniaSearching(true);
      try {
        const params = new URLSearchParams({ q, estado: order.origState, ciudad: order.origCity });
        const res  = await fetch(`/api/colonias/search?${params}`);
        const data = await res.json();
        setColoniaSearch(data.colonias ?? []);
      } catch { setColoniaSearch([]); }
      finally { setColoniaSearching(false); }
    }, 350);
    return () => clearTimeout(timer);
  }, [fields.sugColonia, editing, order.origState, order.origCity]);

  const fullAddress = [
    order.sugAddress1 ?? order.origAddress1,
    order.sugColonia ?? order.originalColonia ?? order.origAddress2,
    order.sugCity ?? order.origCity,
    order.sugZip ?? order.origZip,
  ].filter(Boolean).join(", ");

  return (
    <div className="flex flex-col h-full overflow-hidden border-l border-dark-700/60">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-dark-700/60 shrink-0 bg-dark-900/80">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs text-primary-400 font-bold">#{order.shopifyOrderNum}</span>
          <span className={`badge text-xs ${getStatusColor(order.status)}`}>{getStatusLabel(order.status)}</span>
          {order.confidence && order.confidence !== "UNKNOWN" && (
            <span className={`text-xs font-semibold ${getConfidenceColor(order.confidence)}`}>
              {getConfidenceLabel(order.confidence)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {order.mapLink && (
            <a href={order.mapLink} target="_blank" rel="noreferrer"
              className="p-1.5 rounded hover:bg-dark-700 text-dark-500 hover:text-blue-400 transition-colors" title="Ver mapa">
              <MapPin className="w-3.5 h-3.5" />
            </a>
          )}
          {order.shopifyLink && (
            <a href={order.shopifyLink} target="_blank" rel="noreferrer"
              className="p-1.5 rounded hover:bg-dark-700 text-dark-500 hover:text-dark-200 transition-colors" title="Abrir en Shopify">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <button
            onClick={() => { navigator.clipboard.writeText(fullAddress); toast.success("Dirección copiada"); }}
            className="p-1.5 rounded hover:bg-dark-700 text-dark-500 hover:text-dark-200 transition-colors" title="Copiar dirección">
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-dark-700 text-dark-500 hover:text-dark-200 transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Contenido scrollable */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* Cliente */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-semibold text-dark-200">{order.customerName}</p>
            {order.customerPhone && <p className="text-xs text-dark-500">{order.customerPhone}</p>}
            {order.customerEmail && <p className="text-xs text-dark-600">{order.customerEmail}</p>}
          </div>
          <Link href={`/corrections/${order.id}`} className="text-xs text-primary-500 hover:text-primary-400 transition-colors">
            Ver detalle →
          </Link>
        </div>

        {/* Error banner */}
        {order.errorType && order.errorType !== "OK" && (
          <div className={cn(
            "flex items-start gap-2 p-2.5 rounded-lg text-xs border",
            order.status === "CRITICAL" || order.status === "NEEDS_REVIEW"
              ? "bg-red-900/15 border-red-800/30 text-red-300"
              : "bg-yellow-900/15 border-yellow-800/30 text-yellow-300"
          )}>
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">{getErrorLabel(order.errorType)}</p>
              {order.errorDetails && <p className="text-dark-400 mt-0.5">{order.errorDetails}</p>}
            </div>
          </div>
        )}

        {/* Fuente validación */}
        <ValidationSourceBadge source={null} notes={order.validationNotes} />

        {/* Picker de colonias (SIN_COLONIA o confianza baja) */}
        {coloniasSugeridas.length > 0 && (
          <div className="bg-amber-900/10 border border-amber-700/30 rounded-lg p-2.5">
            <ColoniaPicker
              colonias={coloniasSugeridas}
              currentZip={fields.sugZip || order.origZip}
              selectedColonia={fields.sugColonia || undefined}
              onSelect={handleColoniaSelect}
              loading={actionLoading === "edit"}
            />
            {fields.sugColonia && (
              <p className="mt-1.5 text-[10px] text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                Colonia seleccionada: <strong>{fields.sugColonia}</strong>
                {fields.sugZip !== order.origZip && ` · CP ${fields.sugZip}`}
                {" — ahora puedes aprobar"}
              </p>
            )}
          </div>
        )}

        {/* Shopify original */}
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-dark-600 uppercase tracking-wider">Shopify (original)</p>
          <div className="bg-dark-800/40 rounded-lg px-3 py-2 text-xs space-y-0.5">
            <p className="text-dark-300">{order.origAddress1}</p>
            {order.origAddress2 && <p className="text-dark-400">{order.origAddress2}</p>}
            {(order.originalColonia ?? order.detectedColonia) && (
              <p className="text-dark-400">Col. {order.originalColonia ?? order.detectedColonia}</p>
            )}
            <p className="text-dark-500">
              {order.origCity}{order.origState ? `, ${order.origState}` : ""}{order.origZip ? ` · CP ${order.origZip}` : ""}
            </p>
          </div>
        </div>

        {/* Corrección sugerida / Edit */}
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-dark-600 uppercase tracking-wider">Corrección sugerida</p>
          {editing ? (
            <div className="space-y-2">
              {[
                { key: "sugAddress1",  label: "Calle / Núm.",  max: 42, placeholder: order.origAddress1 },
                { key: "sugColonia",   label: "Colonia",       max: 50, placeholder: order.detectedColonia ?? "" },
                { key: "sugZip",       label: "CP",            max: 5,  placeholder: order.origZip },
                { key: "sugCity",      label: "Ciudad",        max: 30, placeholder: order.origCity },
                { key: "sugState",     label: "Estado",        max: 30, placeholder: order.origState },
                { key: "sugReference", label: "Referencias",   max: 25, placeholder: "" },
              ].map(({ key, label, max, placeholder }) => {
                const val = fields[key as keyof typeof fields];
                const over = max && val.length > max;
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-dark-600">{label}</label>
                      <span className={cn("text-[10px]", over ? "text-red-400" : "text-dark-700")}>
                        {val.length}/{max}
                      </span>
                    </div>
                    <input
                      type="text"
                      className={cn("input text-xs py-1.5 mt-0.5", over && "border-red-700 focus:border-red-500")}
                      value={val}
                      placeholder={placeholder}
                      onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
                    />
                    {/* Autocomplete de colonia por nombre — aparece al escribir en Colonia */}
                    {key === "sugColonia" && (coloniaSearching || coloniaSearch.length > 0) && (
                      <div className="mt-1.5">
                        {coloniaSearching ? (
                          <p className="text-[10px] text-dark-600 flex items-center gap-1">
                            <span className="animate-spin inline-block w-2.5 h-2.5 border border-dark-500 border-t-primary-400 rounded-full" />
                            Buscando colonias…
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {coloniaSearch.map((c, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => {
                                  setFields((f) => ({
                                    ...f,
                                    sugColonia: c.colonia,
                                    sugZip: c.cp && c.cp !== order.origZip ? c.cp : f.sugZip,
                                  }));
                                  setColoniaSearch([]);
                                }}
                                className="text-[11px] px-2 py-0.5 rounded border border-dark-600 bg-dark-800 hover:border-primary-500 hover:bg-primary-900/20 hover:text-primary-300 text-dark-300 transition-colors"
                              >
                                {c.colonia}
                                {c.cp && c.cp !== fields.sugZip && (
                                  <span className="ml-1 text-dark-600 font-mono">{c.cp}</span>
                                )}
                                {c.matchPct !== undefined && (
                                  <span className="ml-1 text-dark-700">{c.matchPct}%</span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Picker de colonias por CP — aparece al editar el CP */}
                    {key === "sugZip" && (cpLoading || cpColonias.length > 0) && (
                      <div className="mt-1.5">
                        {cpLoading ? (
                          <p className="text-[10px] text-dark-600 flex items-center gap-1">
                            <span className="animate-spin inline-block w-2.5 h-2.5 border border-dark-500 border-t-primary-400 rounded-full" />
                            Cargando colonias del CP…
                          </p>
                        ) : (
                          <ColoniaPicker
                            colonias={cpColonias}
                            currentZip={fields.sugZip}
                            selectedColonia={fields.sugColonia || undefined}
                            onSelect={handleEditColoniaSelect}
                            loading={false}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-dark-800/30 rounded-lg px-2.5 py-2 divide-y divide-dark-700/30">
              <CompareRow label="Calle"   orig={order.origAddress1}  sug={order.sugAddress1} />
              <CompareRow label="Colonia" orig={order.originalColonia ?? order.origAddress2 ?? ""} sug={order.sugColonia} />
              <CompareRow label="CP"      orig={order.origZip}        sug={order.sugZip} />
              <CompareRow label="Ciudad"  orig={order.origCity}       sug={order.sugCity} />
              <CompareRow label="Estado"  orig={order.origState}      sug={order.sugState} />
              {order.sugReference && <CompareRow label="Ref."   orig="" sug={order.sugReference} />}
            </div>
          )}
        </div>

        {/* Timestamps */}
        <div className="text-[10px] text-dark-700 space-y-0.5 pt-1 border-t border-dark-800">
          <p>Creado: {formatDate(order.shopifyCreatedAt)} · {timeAgo(order.shopifyCreatedAt)}</p>
          <p>Shopify ID: {order.shopifyId}</p>
        </div>
      </div>

      {/* Acciones fijas */}
      <div className="shrink-0 px-4 py-3 border-t border-dark-700/60 space-y-2 bg-dark-900/60">
        <div className="flex items-center gap-3 text-[10px] text-dark-700 justify-center">
          <span><kbd className="px-1 bg-dark-800 rounded border border-dark-700">A</kbd> aprobar</span>
          <span><kbd className="px-1 bg-dark-800 rounded border border-dark-700">R</kbd> rechazar</span>
          <span><kbd className="px-1 bg-dark-800 rounded border border-dark-700">↑↓</kbd> navegar</span>
          <span><kbd className="px-1 bg-dark-800 rounded border border-dark-700">Esc</kbd> cerrar</span>
        </div>

        {editing ? (
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)} className="btn-secondary flex-1 py-1.5 text-xs">
              <X className="w-3.5 h-3.5" /> Cancelar
            </button>
            <button
              onClick={async () => { await onAction("edit", { fields }); setEditing(false); }}
              disabled={!!actionLoading}
              className="btn-primary flex-1 py-1.5 text-xs"
            >
              {actionLoading === "edit" ? <Spinner /> : <Save className="w-3.5 h-3.5" />}
              Guardar
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {(order.status === "CORRECTABLE" || order.status === "NEEDS_REVIEW" || order.status === "CRITICAL") && (
              <button
                onClick={() => onAction("approve")}
                disabled={!!actionLoading}
                className="btn-success w-full py-2 text-xs"
              >
                {actionLoading === "approve" ? <Spinner /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Aprobar correcciones
              </button>
            )}
            {order.status === "APPROVED" && (
              <button
                onClick={() => onAction("apply")}
                disabled={!!actionLoading}
                className="btn-primary w-full py-2 text-xs"
              >
                {actionLoading === "apply" ? <Spinner /> : <Zap className="w-3.5 h-3.5" />}
                Aplicar en EnviaTodo
              </button>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setEditing(true)} className="btn-secondary py-1.5 text-xs">
                <Edit3 className="w-3.5 h-3.5" /> Editar
              </button>
              <button
                onClick={() => onAction("revalidate")}
                disabled={!!actionLoading}
                className="btn-secondary py-1.5 text-xs"
              >
                {actionLoading === "revalidate" ? <Spinner /> : <RotateCcw className="w-3.5 h-3.5" />}
                Revalidar
              </button>
              {order.status !== "REJECTED" && order.status !== "APPLIED" && (
                <button
                  onClick={() => onAction("reject")}
                  disabled={!!actionLoading}
                  className="btn-danger py-1.5 text-xs col-span-2"
                >
                  <XCircle className="w-3.5 h-3.5" /> Rechazar
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────
// Consola de automatización masiva (panel deslizante)
// ────────────────────────────────────────────────────────
interface BulkConsoleProps {
  running: boolean;
  log: string;
  done: number;
  total: number;
  errors: number;
  currentOrder: string;
  height: number;
  onHeightChange: (h: number) => void;
  onStop: () => void;
  onClear: () => void;
  onClose: () => void;
}

function BulkConsole({ running, log, done, total, errors, currentOrder, height, onHeightChange, onStop, onClear, onClose }: BulkConsoleProps) {
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  // Refs estables para evitar stale closures en mousemove/mouseup
  const resizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHRef = useRef(height);
  const heightRef = useRef(height);
  useEffect(() => { heightRef.current = height; }, [height]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      // Arrastrar hacia ARRIBA → consola más ALTA
      const dy = startYRef.current - e.clientY;
      const minH = 140;
      const maxH = Math.round(window.innerHeight * 0.9);
      const newH = Math.min(maxH, Math.max(minH, startHRef.current + dy));
      onHeightChange(newH);
    };
    const onUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem("bulkConsoleHeight", String(heightRef.current));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onHeightChange]);

  const pct = total > 0 ? Math.round(((done + errors) / total) * 100) : 0;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 bg-dark-950 border-t-2 border-primary-600/40 shadow-2xl animate-slide-up"
      style={{ height }}>

      {/* Handle para redimensionar — barra horizontal arriba */}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          resizingRef.current = true;
          startYRef.current = e.clientY;
          startHRef.current = height;
          document.body.style.cursor = "row-resize";
          document.body.style.userSelect = "none";
        }}
        title="Arrastra para redimensionar"
        className="absolute -top-1.5 left-0 right-0 h-3 cursor-row-resize group z-30 flex items-center justify-center"
      >
        <div className="h-1 w-16 rounded-full bg-dark-700 group-hover:bg-primary-500/70 transition-colors" />
      </div>

      {/* Header consola */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-dark-800">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            {running ? (
              <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            ) : errors > 0 ? (
              <span className="w-2 h-2 rounded-full bg-red-400" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
            )}
            <span className="text-sm font-semibold text-dark-200">Automatización EnviaTodo</span>
          </div>
          {total > 0 && (
            <span className="text-xs text-dark-500">
              {done}/{total} procesados · {errors} error(es)
            </span>
          )}
          {running && currentOrder && (
            <span className="text-xs text-yellow-400 animate-pulse">→ {currentOrder}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {running ? (
            <button onClick={onStop} className="btn-danger text-xs py-1.5 gap-1">
              <StopCircle className="w-3.5 h-3.5" /> Detener
            </button>
          ) : (
            <button onClick={onClear} className="btn-ghost text-xs py-1.5 gap-1">
              <Trash2 className="w-3.5 h-3.5" /> Limpiar
            </button>
          )}
          <button onClick={onClose} className="btn-ghost text-xs py-1.5 px-2">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="px-4 py-1.5 border-b border-dark-800/60">
          <div className="flex items-center gap-3 text-xs text-dark-500 mb-1">
            <span>{pct}%</span>
            <span className="text-emerald-500">✅ {done} ok</span>
            {errors > 0 && <span className="text-red-400">❌ {errors} error(es)</span>}
            <span>{total - done - errors} restantes</span>
          </div>
          <div className="h-1.5 bg-dark-800 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-300",
                errors > 0 ? "bg-gradient-to-r from-emerald-500 to-red-500" : "bg-emerald-500"
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Log terminal */}
      <pre
        ref={logRef}
        className="px-4 py-2 text-xs font-mono text-dark-300 overflow-auto whitespace-pre-wrap break-all"
        style={{ height: "calc(100% - 88px)" }}
      >
        {log || "[Esperando inicio…]"}
      </pre>
    </div>
  );
}

// ────────────────────────────────────────────────────────
// Página principal
// ────────────────────────────────────────────────────────
function OrdersContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Pedidos y paginación
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [approvedCount, setApprovedCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Panel lateral
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderWithDetails | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Modales
  const [rejectModal, setRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  // Filtros
  const [autoRefresh, setAutoRefresh] = useState(0);
  const [errorFilter, setErrorFilter] = useState<string>("");
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Selección múltiple ────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState<string | null>(null);

  // ── Consola automatización masiva ─────────────────────
  const [showConsole, setShowConsole] = useState(false);
  const [consoleRunning, setConsoleRunning] = useState(false);
  const [consoleLog, setConsoleLog] = useState("");
  const [consoleProgress, setConsoleProgress] = useState({ done: 0, total: 0, errors: 0, current: "" });

  // ── Altura de la consola (resizable, persistida) ──────
  const [consoleHeight, setConsoleHeight] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = parseInt(localStorage.getItem("bulkConsoleHeight") ?? "0");
      if (saved > 0) return saved;
      return Math.round(window.innerHeight * 0.42);
    }
    return 400;
  });

  // ── Opciones de automatización ─────────────────────────
  // headlessMode: true = segundo plano (sin ventana), false = ventana visible
  const [headlessMode, setHeadlessMode] = useState(true);

  // ── Selector de flujo ──────────────────────────────────
  // null = sin flujo seleccionado; DEFAULT_ORDERS_FLOW = flujo legacy; "nombre.ts" = script guardado
  const [selectedScript, setSelectedScript] = useState<string | null>(null);
  const [availableScripts, setAvailableScripts] = useState<{ name: string; stepCount: number }[]>([]);
  const [soloRunning, setSoloRunning] = useState(false);

  // ── Ancho del panel lateral (resizable) ───────────────
  // Mínimo: 320 px. Máximo: 50% del viewport (para pantallas 2K+).
  const panelMaxWidth = () =>
    typeof window !== "undefined" ? Math.round(window.innerWidth * 0.5) : 750;

  const [panelWidth, setPanelWidth] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = parseInt(localStorage.getItem("panelWidth") ?? "480");
      return Math.min(saved, panelMaxWidth());
    }
    return 480;
  });
  const resizingRef = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);
  // Ref para leer el ancho actual dentro de handlers sin stale closure
  const panelWidthRef = useRef(panelWidth);
  useEffect(() => { panelWidthRef.current = panelWidth; }, [panelWidth]);

  // ── Resize panel: mousemove / mouseup globales ─────────
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      // Arrastrando hacia la izquierda → panel más ancho
      const dx = resizeStartX.current - e.clientX;
      const newW = Math.min(panelMaxWidth(), Math.max(320, resizeStartW.current + dx));
      setPanelWidth(newW);
    };
    const onMouseUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem("panelWidth", String(panelWidthRef.current));
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const status = searchParams.get("status") ?? "ALL";
  const search = searchParams.get("search") ?? "";
  const page = parseInt(searchParams.get("page") ?? "1");

  // ── Cargar pedidos ──────────────────────────────────
  const fetchOrders = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const params = new URLSearchParams();
    if (status !== "ALL") params.set("status", status);
    if (search) params.set("search", search);
    if (errorFilter) params.set("errorType", errorFilter);
    params.set("page", String(page));
    params.set("limit", "60");
    try {
      const res = await fetch(`/api/orders?${params}`);
      const data = await res.json();
      setOrders(data.orders ?? []);
      setTotal(data.total ?? 0);
      setPages(data.pages ?? 1);
      setApprovedCount(data.approvedCount ?? 0);
      if (selectedId) {
        const refreshed = (data.orders ?? []).find((o: OrderWithDetails) => o.id === selectedId);
        if (refreshed) setSelectedOrder(refreshed);
      }
    } catch {
      if (!silent) toast.error("Error cargando pedidos");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [status, search, page, errorFilter, selectedId]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // ── Cargar lista de scripts disponibles ─────────────
  useEffect(() => {
    fetch("/api/playwright/scripts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list" }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setAvailableScripts(
          d.scripts
            .filter((s: { name: string }) => s.name !== "playwright.config.ts")
            .map((s: { name: string; stepCount: number }) => ({ name: s.name, stepCount: s.stepCount }))
        );
      })
      .catch(() => {});
  }, []);

  // ── Auto-refresh ────────────────────────────────────
  useEffect(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    if (autoRefresh > 0) {
      refreshTimer.current = setInterval(() => fetchOrders(true), autoRefresh * 1000);
    }
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current); };
  }, [autoRefresh, fetchOrders]);

  // ── Polling consola bulk ────────────────────────────
  useEffect(() => {
    if (!consoleRunning) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/apply/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status" }),
        });
        const d = await res.json();
        setConsoleLog(d.log ?? "");
        setConsoleProgress({ done: d.done, total: d.total, errors: d.errors, current: d.currentOrder });
        if (!d.running) {
          setConsoleRunning(false);
          await fetchOrders(true);
          if (d.errors === 0) toast.success(`${d.done} pedidos aplicados en EnviaTodo ✅`);
          else toast.error(`${d.done} aplicados, ${d.errors} con error`);
        }
      } catch { /* silencioso */ }
    }, 1500);
    return () => clearInterval(interval);
  }, [consoleRunning, fetchOrders]);

  // ── Keyboard shortcuts ──────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "/" && !isInput) { e.preventDefault(); document.getElementById("orders-search")?.focus(); return; }
      if (!selectedOrder || isInput) return;
      if (e.key === "Escape") { setSelectedId(null); setSelectedOrder(null); return; }
      if (e.key === "a" || e.key === "A") { e.preventDefault(); doAction("approve"); return; }
      if (e.key === "r" || e.key === "R") { e.preventDefault(); setRejectModal(true); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const idx = orders.findIndex((o) => o.id === selectedId);
        const next = e.key === "ArrowDown" ? idx + 1 : idx - 1;
        if (next >= 0 && next < orders.length) { setSelectedId(orders[next].id); setSelectedOrder(orders[next]); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedOrder, selectedId, orders]);

  // ── Helpers ─────────────────────────────────────────
  function updateParam(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (value === "ALL" || value === "") p.delete(key); else p.set(key, value);
    if (key !== "page") p.delete("page");
    router.push(`/orders?${p.toString()}`);
  }

  function selectOrder(order: OrderWithDetails) {
    if (selectedId === order.id) { setSelectedId(null); setSelectedOrder(null); }
    else { setSelectedId(order.id); setSelectedOrder(order); }
  }

  async function doAction(action: string, extra?: object) {
    if (!selectedId) return;
    setActionLoading(action);
    try {
      const res = await fetch(`/api/orders/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (data.success) {
        const msgs: Record<string, string> = { approve: "Pedido aprobado ✅", reject: "Pedido rechazado", edit: "Cambios guardados", revalidate: "Marcado para revalidar" };
        toast.success(msgs[action] ?? "Acción completada");

        if (action === "approve") {
          // Auto-avanzar al siguiente pedido accionable
          const ACTIONABLE = ["CORRECTABLE", "NEEDS_REVIEW", "CRITICAL"];
          const idx = orders.findIndex((o) => o.id === selectedId);
          const after  = orders.slice(idx + 1).find((o) => ACTIONABLE.includes(o.status));
          const before = orders.slice(0, idx).find((o) => ACTIONABLE.includes(o.status));
          const next = after ?? before;
          if (next) { setSelectedId(next.id); setSelectedOrder(next); }
          else       { setSelectedId(null);   setSelectedOrder(null); }
        } else {
          setSelectedOrder(data.order);
        }

        await fetchOrders(true);
      } else toast.error(data.message ?? "Error");
    } catch { toast.error("Error de conexión"); }
    finally { setActionLoading(null); }
  }

  async function doApply() {
    if (!selectedId) return;
    setActionLoading("apply");
    try {
      const res = await fetch(`/api/apply/${selectedId}`, { method: "POST" });
      const data = await res.json();
      if (data.success) { toast.success("Aplicado en EnviaTodo"); await fetchOrders(true); }
      else toast.error(data.message ?? "Error aplicando");
    } catch { toast.error("Error de conexión"); }
    finally { setActionLoading(null); }
  }

  async function handlePanelAction(action: string, extra?: object) {
    if (action === "apply") { await doApply(); return; }
    if (action === "reject") { setRejectModal(true); return; }
    await doAction(action, extra);
  }

  async function confirmReject() {
    await doAction("reject", { reason: rejectReason });
    setRejectModal(false);
    setRejectReason("");
  }

  // ── Selección múltiple ────────────────────────────────
  function toggleSelect(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === orders.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(orders.map((o) => o.id)));
    }
  }

  async function doBulkAction(action: "approve" | "reject" | "revalidate") {
    if (selectedIds.size === 0) return;
    setBulkLoading(action);
    try {
      const res = await fetch("/api/orders/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: Array.from(selectedIds) }),
      });
      const data = await res.json();
      if (data.success) {
        const msgs = { approve: `${data.count} pedidos aprobados ✅`, reject: `${data.count} pedidos rechazados`, revalidate: `${data.count} pedidos en revalidación` };
        toast.success(msgs[action]);
        setSelectedIds(new Set());
        await fetchOrders(true);
      } else toast.error(data.message ?? "Error en operación masiva");
    } catch { toast.error("Error de conexión"); }
    finally { setBulkLoading(null); }
  }

  // ── Ejecutar script sin pedidos (standalone) ────────
  async function runScriptAlone() {
    if (!selectedScript) { toast.error("Selecciona un script primero"); return; }
    setSoloRunning(true);
    setShowConsole(true);
    setConsoleLog(`[SOLO] Ejecutando ${selectedScript} sin datos de pedido…\n`);
    setConsoleProgress({ done: 0, total: 0, errors: 0, current: selectedScript });
    try {
      const res = await fetch("/api/playwright/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", script: selectedScript, headless: headlessMode }),
      });
      const data = await res.json();
      if (data.success) {
        setConsoleRunning(true);
        toast.success(`Ejecutando ${selectedScript}…`);
      } else {
        toast.error(data.message ?? "Error al iniciar");
        setShowConsole(false);
      }
    } catch { toast.error("Error de conexión"); setShowConsole(false); }
    finally { setSoloRunning(false); }
  }

  // ── Enviar aprobados a EnviaTodo ─────────────────────
  async function sendApproved() {
    if (approvedCount === 0) { toast.error("No hay pedidos aprobados"); return; }
    if (!selectedScript) { toast.error("No hay script seleccionado"); return; }
    const useDefaultOrdersNavigation = selectedScript === DEFAULT_ORDERS_FLOW;
    setShowConsole(true);
    setConsoleLog("");
    setConsoleProgress({ done: 0, total: 0, errors: 0, current: "" });
    try {
      const res = await fetch("/api/apply/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          headless: headlessMode,
          scriptName: useDefaultOrdersNavigation ? undefined : selectedScript,
          useDefaultOrdersNavigation,
          autoNavigateOrders: useDefaultOrdersNavigation,
          requiresOrdersSection: useDefaultOrdersNavigation,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setConsoleRunning(true);
        toast.success(`Automatizando ${data.total} pedido(s) aprobado(s)…`);
      } else {
        toast.error(data.message ?? "Error al iniciar");
        setShowConsole(false);
      }
    } catch { toast.error("Error de conexión"); setShowConsole(false); }
  }

  async function stopBulkApply() {
    try {
      await fetch("/api/apply/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      setConsoleRunning(false);
      toast("Automatización detenida");
    } catch { toast.error("Error de conexión"); }
  }

  async function clearConsole() {
    try {
      await fetch("/api/apply/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      setConsoleLog("");
      setConsoleProgress({ done: 0, total: 0, errors: 0, current: "" });
    } catch { /* silencioso */ }
  }

  const hasPanelOpen = !!selectedOrder;
  const hasBulkSelected = selectedIds.size > 0;
  const allVisibleSelected = orders.length > 0 && selectedIds.size === orders.length;

  return (
    <div className="flex flex-col h-screen overflow-hidden">

      {/* ── Top bar ──────────────────────────────────── */}
      <div className="shrink-0 px-5 pt-4 pb-2 space-y-2.5">

        {/* Fila 1: título + acciones globales */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-dark-100">Pedidos</h1>
            <p className="text-xs text-dark-500 truncate">
              {total.toLocaleString()} pedidos
              {approvedCount > 0 && (
                <span className="text-emerald-500 ml-1.5">· {approvedCount} aprobados listos</span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Auto-refresh */}
            <div className="flex items-center gap-1 bg-dark-800 border border-dark-700 rounded-lg px-2.5 py-1.5">
              <Clock className="w-3 h-3 text-dark-500" />
              <select
                className="bg-transparent text-xs text-dark-300 outline-none cursor-pointer"
                value={String(autoRefresh)}
                onChange={(e) => setAutoRefresh(parseInt(e.target.value))}
              >
                {AUTO_REFRESH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <button onClick={() => fetchOrders()} className="btn-secondary py-1.5 px-3 text-xs">
              <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
              Sync
            </button>

            {/* ── Selector de flujo ───────────────────────────── */}
            <div className="flex items-center gap-1.5">
              <select
                value={selectedScript ?? ""}
                onChange={(e) => setSelectedScript(e.target.value || null)}
                title="Selecciona qué flujo/script usar al enviar pedidos"
                className={cn(
                  "text-xs rounded-lg px-2.5 py-2 border outline-none cursor-pointer appearance-none font-medium transition-all",
                  selectedScript
                    ? "bg-primary-900/25 border-primary-600/50 text-primary-300 hover:border-primary-500"
                    : "bg-dark-800 border-dark-700 text-dark-400 hover:border-dark-600"
                )}
              >
                <option value="">Selecciona un script</option>
                <option value={DEFAULT_ORDERS_FLOW}>Flujo legacy: navegar a pedidos</option>
                {availableScripts.length > 0 && (
                  <optgroup label="Scripts guardados">
                    {availableScripts.map((s) => (
                      <option key={s.name} value={s.name}>
                        📄 {s.name.replace(/\.ts$/, "")} ({s.stepCount} pasos)
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>

              {/* Botón "Solo ejecutar" — solo visible si hay script seleccionado */}
              {selectedScript && selectedScript !== DEFAULT_ORDERS_FLOW && (
                <button
                  onClick={runScriptAlone}
                  disabled={soloRunning || consoleRunning}
                  title={`Ejecutar ${selectedScript} sin datos de pedido`}
                  className="flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs font-medium border transition-all bg-dark-800 border-dark-700 text-dark-400 hover:border-primary-500 hover:text-primary-300 hover:bg-primary-900/15 disabled:opacity-40"
                >
                  <Play className="w-3 h-3" />
                  Solo ejecutar
                </button>
              )}
            </div>

            {/* Toggle headless/visible para Chromium */}
            <button
              onClick={() => setHeadlessMode((h) => !h)}
              title={headlessMode ? "Chromium en segundo plano — clic para mostrar ventana" : "Chromium visible — clic para ocultar"}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-all",
                headlessMode
                  ? "bg-dark-800 border-dark-700 text-dark-400 hover:border-dark-600 hover:text-dark-300"
                  : "bg-blue-900/20 border-blue-700/50 text-blue-300 hover:border-blue-500"
              )}
            >
              {headlessMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {headlessMode ? "2do plano" : "Ventana"}
            </button>

            {/* BOTÓN PRINCIPAL: Enviar aprobados */}
            <button
              onClick={sendApproved}
              disabled={approvedCount === 0 || consoleRunning}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all",
                approvedCount > 0
                  ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30"
                  : "bg-dark-800 text-dark-600 cursor-not-allowed border border-dark-700"
              )}
            >
              {consoleRunning ? <Spinner className="w-4 h-4" /> : <Send className="w-4 h-4" />}
              {approvedCount > 0 ? `Enviar ${approvedCount} aprobado(s)` : "Enviar aprobados"}
            </button>
          </div>
        </div>

        {/* Fila 2: filtros de estado */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {QUICK_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => updateParam("status", f.value)}
              className={cn(
                "px-2.5 py-1 rounded-full text-xs font-medium transition-all border",
                status === f.value
                  ? "bg-primary-600/25 border-primary-500/40 text-primary-300"
                  : "bg-dark-800/60 border-dark-700/60 text-dark-500 hover:text-dark-300 hover:border-dark-600"
              )}
            >
              {f.label}
            </button>
          ))}
          <select
            className="text-xs bg-dark-800/60 border border-dark-700/60 rounded-full px-2.5 py-1 text-dark-500 outline-none cursor-pointer hover:border-dark-600 appearance-none"
            value={errorFilter}
            onChange={(e) => setErrorFilter(e.target.value)}
          >
            <option value="">Tipo error…</option>
            {ERROR_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>

        {/* Fila 3: búsqueda */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-dark-500" />
          <input
            id="orders-search"
            type="text"
            placeholder="Buscar pedido, cliente, ciudad, CP… (/ para enfocar)"
            className="input pl-9 text-sm"
            defaultValue={search}
            onChange={(e) => {
              const val = e.target.value;
              const w = window as unknown as Record<string, ReturnType<typeof setTimeout>>;
              clearTimeout(w._st);
              w._st = setTimeout(() => updateParam("search", val), 350);
            }}
          />
        </div>

        {/* Fila 4: toolbar bulk (solo cuando hay selección) */}
        {hasBulkSelected && (
          <div className="flex items-center gap-2 px-3 py-2 bg-primary-900/20 border border-primary-700/40 rounded-lg">
            <CheckSquare className="w-4 h-4 text-primary-400 shrink-0" />
            <span className="text-xs text-primary-300 font-semibold flex-1">
              {selectedIds.size} pedido(s) seleccionado(s)
            </span>
            <button
              onClick={() => doBulkAction("approve")}
              disabled={!!bulkLoading}
              className="btn-success py-1 px-3 text-xs gap-1"
            >
              {bulkLoading === "approve" ? <Spinner className="w-3 h-3" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Aprobar
            </button>
            <button
              onClick={() => doBulkAction("revalidate")}
              disabled={!!bulkLoading}
              className="btn-secondary py-1 px-3 text-xs gap-1"
            >
              {bulkLoading === "revalidate" ? <Spinner className="w-3 h-3" /> : <RotateCcw className="w-3.5 h-3.5" />}
              Revalidar
            </button>
            <button
              onClick={() => doBulkAction("reject")}
              disabled={!!bulkLoading}
              className="btn-danger py-1 px-3 text-xs gap-1"
            >
              {bulkLoading === "reject" ? <Spinner className="w-3 h-3" /> : <XCircle className="w-3.5 h-3.5" />}
              Rechazar
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="btn-ghost py-1 px-2 text-xs"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* ── Main content ─────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden" style={{ paddingBottom: showConsole ? "42vh" : 0 }}>

        {/* Tabla */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <Spinner className="w-8 h-8 text-primary-400" />
            </div>
          ) : orders.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm text-dark-500">
              Sin pedidos que coincidan.
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-dark-900">
                  <tr className="border-b border-dark-700/60">
                    {/* Checkbox header */}
                    <th className="px-2 py-2 w-8">
                      <input
                        type="checkbox"
                        className="rounded border-dark-600 bg-dark-800 accent-primary-500 cursor-pointer"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAll}
                        title={allVisibleSelected ? "Deseleccionar todos" : "Seleccionar todos"}
                      />
                    </th>
                    {(hasPanelOpen
                      ? ["#", "Cliente", "Error", "Conf.", "Estado"]
                      : ["#", "Cliente", "Ciudad / Estado", "CP orig.", "CP sug.", "Colonia detectada", "Colonia sugerida", "Error", "Conf.", "Estado", "Hace"]
                    ).map((h) => (
                      <th key={h} className="px-2 py-2 text-left font-medium text-dark-600 uppercase tracking-wider whitespace-nowrap text-[10px]">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-800/50">
                  {orders.map((order) => {
                    const isSelected = selectedId === order.id;
                    const isChecked = selectedIds.has(order.id);
                    return (
                      <tr
                        key={order.id}
                        onClick={() => selectOrder(order)}
                        className={cn(
                          "cursor-pointer transition-colors text-xs group",
                          isSelected
                            ? "bg-primary-900/20 border-l-2 border-l-primary-500"
                            : isChecked
                            ? "bg-primary-900/10"
                            : "hover:bg-dark-800/40"
                        )}
                      >
                        {/* Checkbox */}
                        <td className="px-2 py-1.5 w-8" onClick={(e) => toggleSelect(order.id, e)}>
                          <input
                            type="checkbox"
                            className="rounded border-dark-600 bg-dark-800 accent-primary-500 cursor-pointer"
                            checked={isChecked}
                            onChange={() => {}}
                          />
                        </td>

                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <span className="font-mono text-primary-400 font-bold">#{order.shopifyOrderNum}</span>
                        </td>
                        <td className="px-2 py-1.5">
                          <p className="text-dark-200 font-medium truncate max-w-[110px]">{order.customerName}</p>
                        </td>

                        {!hasPanelOpen && (
                          <>
                            <td className="px-2 py-1.5 text-dark-400 whitespace-nowrap">
                              {order.origCity}
                              <span className="text-dark-600">, {order.origState}</span>
                            </td>
                            <td className="px-2 py-1.5">
                              <span className="font-mono text-dark-500">{order.origZip}</span>
                            </td>
                            <td className="px-2 py-1.5">
                              {order.sugZip && order.sugZip !== order.origZip
                                ? <span className="font-mono text-yellow-400 font-bold">{order.sugZip}</span>
                                : <span className="text-dark-700">—</span>}
                            </td>
                            <td className="px-2 py-1.5 max-w-[120px]">
                              <span className="text-dark-400 truncate block" title={order.detectedColonia ?? ""}>
                                {order.detectedColonia ?? <span className="text-dark-700">—</span>}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 max-w-[120px]">
                              {order.sugColonia && order.sugColonia !== order.detectedColonia ? (
                                <span className="text-yellow-400 font-medium truncate block" title={order.sugColonia}>
                                  {order.sugColonia}
                                </span>
                              ) : <span className="text-dark-700">—</span>}
                            </td>
                          </>
                        )}

                        <td className="px-2 py-1.5">
                          <span className={`text-xs ${getErrorColor(order.errorType)}`}>
                            {getErrorLabel(order.errorType)}
                          </span>
                        </td>
                        <td className="px-2 py-1.5">
                          <span className={`font-semibold ${getConfidenceColor(order.confidence)}`}>
                            {getConfidenceLabel(order.confidence)}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <span className={`badge text-xs ${getStatusColor(order.status)}`}>
                            {getStatusLabel(order.status)}
                          </span>
                        </td>
                        {!hasPanelOpen && (
                          <td className="px-2 py-1.5 whitespace-nowrap text-dark-600">
                            {timeAgo(order.shopifyCreatedAt)}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Paginación */}
          {pages > 1 && (
            <div className="shrink-0 flex items-center justify-between px-4 py-2 border-t border-dark-800 text-xs">
              <p className="text-dark-600">Pág. {page}/{pages} · {total} pedidos</p>
              <div className="flex gap-1">
                <button onClick={() => updateParam("page", String(page - 1))} disabled={page <= 1} className="btn-secondary py-1 px-2">
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => updateParam("page", String(page + 1))} disabled={page >= pages} className="btn-secondary py-1 px-2">
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Panel lateral (resizable) */}
        {hasPanelOpen && selectedOrder && (
          <div
            className="shrink-0 h-full bg-dark-900 animate-slide-in overflow-hidden relative"
            style={{ width: panelWidth }}
          >
            {/* Handle de redimensionado — arrastra hacia la izquierda para ampliar */}
            <div
              className="panel-resize-handle"
              title="Arrastra para cambiar el ancho"
              onMouseDown={(e) => {
                e.preventDefault();
                resizingRef.current = true;
                resizeStartX.current = e.clientX;
                resizeStartW.current = panelWidth;
                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
              }}
            />
            <DetailPanel
              order={selectedOrder}
              onClose={() => { setSelectedId(null); setSelectedOrder(null); }}
              onAction={handlePanelAction}
              actionLoading={actionLoading}
            />
          </div>
        )}
      </div>

      {/* ── Consola de automatización masiva ─────────── */}
      {showConsole && (
        <BulkConsole
          running={consoleRunning}
          log={consoleLog}
          done={consoleProgress.done}
          total={consoleProgress.total}
          errors={consoleProgress.errors}
          currentOrder={consoleProgress.current}
          height={consoleHeight}
          onHeightChange={setConsoleHeight}
          onStop={stopBulkApply}
          onClear={clearConsole}
          onClose={() => {
            if (consoleRunning) { toast.error("Detén la automatización primero"); return; }
            setShowConsole(false);
          }}
        />
      )}

      {/* Modal rechazo */}
      <Modal
        open={rejectModal}
        onClose={() => setRejectModal(false)}
        title={`Rechazar pedido #${selectedOrder?.shopifyOrderNum}`}
        size="sm"
      >
        <div className="space-y-4">
          <textarea
            className="input h-20 resize-none"
            placeholder="Motivo (opcional)..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <div className="flex gap-3 justify-end">
            <button className="btn-secondary" onClick={() => setRejectModal(false)}>Cancelar</button>
            <button className="btn-danger" onClick={confirmReject}>Rechazar</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense>
      <OrdersContent />
    </Suspense>
  );
}
