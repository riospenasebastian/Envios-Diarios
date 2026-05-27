"use client";

import { useEffect, useState, useRef } from "react";
import toast from "react-hot-toast";
import {
  Save, Eye, EyeOff, Upload, Database, Chrome, Settings,
  ShoppingBag, Truck, RefreshCw, CheckCircle2, Terminal,
  Play, Square, Code2, FileCode, Trash2, ChevronDown, ChevronUp,
  Copy, Zap, BookOpen, AlertTriangle, StopCircle, List, FilePlus2, ClipboardPaste,
} from "lucide-react";
import Spinner from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────

interface SettingsData {
  shopifyStoreUrl: string;
  shopifyAccessToken: string;
  shopifyApiVersion: string;
  enviatodoEmail: string;
  enviatodoPassword: string;
  enviatodoUrl: string;
  maxNombreChars: string;
  maxDireccionChars: string;
  palabrasReferencia: string;
  playwrightHeadless: string;
  _hasShopifyToken?: boolean;
  _hasEnviatodoPassword?: boolean;
}

interface ScriptMeta {
  name: string;
  size: number;
  lastModified: string;
  stepCount: number;
  steps: string[];
  isTemplate: boolean;
}

type RunStatus = "idle" | "running" | "done" | "error" | "stopped";

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "justo ahora";
  if (m < 60) return `hace ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d}d`;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

function defaultScriptName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `flujo_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function statusColor(s: RunStatus) {
  return {
    idle: "text-dark-500 bg-dark-800",
    running: "text-yellow-400 bg-yellow-900/20 border-yellow-800/40",
    done: "text-emerald-400 bg-emerald-900/20 border-emerald-800/40",
    error: "text-red-400 bg-red-900/20 border-red-800/40",
    stopped: "text-dark-400 bg-dark-800/60 border-dark-700/40",
  }[s];
}

function statusLabel(s: RunStatus) {
  return { idle: "Inactivo", running: "Ejecutando…", done: "Completado ✓", error: "Error ✗", stopped: "Detenido" }[s];
}

// ─────────────────────────────────────────────────────────
// Sub-componentes de UI
// ─────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children, id }: {
  title: string; icon: React.ElementType; children: React.ReactNode; id?: string;
}) {
  return (
    <div className="card" id={id}>
      <div className="card-header flex items-center gap-2">
        <Icon className="w-4 h-4 text-primary-400" />
        <h2 className="text-sm font-semibold text-dark-200">{title}</h2>
      </div>
      <div className="card-body space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-dark-300">{label}</label>
      {children}
      {hint && <p className="text-xs text-dark-500">{hint}</p>}
    </div>
  );
}

function PasswordInput({ value, onChange, placeholder, hasValue }: {
  value: string; onChange: (v: string) => void; placeholder?: string; hasValue?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        className="input pr-9"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hasValue && !value ? "••••••••  (guardado)" : placeholder}
      />
      <button type="button" onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-dark-500 hover:text-dark-300 transition-colors">
        {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

/** Lista numerada de pasos con iconos de color */
function StepsList({ steps, maxVisible = 999 }: { steps: string[]; maxVisible?: number }) {
  const visible = steps.slice(0, maxVisible);
  const hidden = steps.length - visible.length;
  return (
    <ol className="space-y-1">
      {visible.map((step, i) => (
        <li key={i} className="flex items-start gap-2 text-xs">
          <span className="shrink-0 w-5 h-5 rounded-full bg-dark-700 text-dark-400 flex items-center justify-center text-[10px] font-mono mt-0.5">
            {i + 1}
          </span>
          <span className="text-dark-300 leading-relaxed">{step}</span>
        </li>
      ))}
      {hidden > 0 && (
        <li className="text-xs text-dark-500 ml-7">… y {hidden} paso(s) más</li>
      )}
    </ol>
  );
}

/** Panel de logs con scroll automático al final */
function LogsPanel({ logs, label = "Logs:" }: { logs: string; label?: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs]);
  return (
    <pre
      ref={ref}
      className="bg-dark-950 border border-dark-700 rounded-lg p-3 text-xs text-dark-400 overflow-auto max-h-48 font-mono whitespace-pre-wrap break-all"
    >
      {logs || `[esperando ${label}…]`}
    </pre>
  );
}

// ─────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ inserted: number; sheets: number } | null>(null);
  const [playwrightAction, setPlaywrightAction] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<boolean | null>(null);

  // Codegen
  const [codegenRunning, setCodegenRunning] = useState(false);
  const [codegenCode, setCodegenCode] = useState("");
  const [codegenUrl, setCodegenUrl] = useState("");
  const [codegenLogs, setCodegenLogs] = useState("");
  const [codegenError, setCodegenError] = useState(false);
  const [codegenSteps, setCodegenSteps] = useState<string[]>([]);
  const [showCodegenRaw, setShowCodegenRaw] = useState(false);
  const [showCodegenLogs, setShowCodegenLogs] = useState(false);

  // Upload / importar flujo
  const [uploadTab, setUploadTab] = useState<"file" | "paste">("file");
  const [uploadDragOver, setUploadDragOver] = useState(false);
  const [pasteCode, setPasteCode] = useState("");
  const uploadInputRef = useRef<HTMLInputElement>(null);

  // Guardar script grabado
  const [saveScriptName, setSaveScriptName] = useState("");
  const [savingScript, setSavingScript] = useState(false);
  const [savedScriptName, setSavedScriptName] = useState<string | null>(null);

  // Biblioteca de scripts
  const [scripts, setScripts] = useState<ScriptMeta[]>([]);
  const [scriptsLoading, setScriptsLoading] = useState(false);
  const [expandedScript, setExpandedScript] = useState<string | null>(null);
  const [expandedScriptCode, setExpandedScriptCode] = useState("");
  const [expandedScriptSteps, setExpandedScriptSteps] = useState<string[]>([]);
  const [showExpandedCode, setShowExpandedCode] = useState(false);

  // Runner
  const [runnerRunning, setRunnerRunning] = useState(false);
  const [runnerLogs, setRunnerLogs] = useState("");
  const [runnerStatus, setRunnerStatus] = useState<RunStatus>("idle");
  const [runnerScript, setRunnerScript] = useState("");

  // ── API helpers ───────────────────────────────────────

  async function fetchSettings() {
    const res = await fetch("/api/settings");
    const data = await res.json();
    setSettings(data);
    const initial: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) {
      if (!k.startsWith("_")) initial[k] = v as string;
    }
    setForm(initial);
    setLoading(false);
  }

  async function fetchSessionStatus() {
    const res = await fetch("/api/playwright", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status" }),
    });
    const data = await res.json();
    setSessionStatus(data.hasSession);
  }

  async function fetchScripts() {
    setScriptsLoading(true);
    try {
      const res = await fetch("/api/playwright/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list" }),
      });
      const d = await res.json();
      if (d.success) setScripts(d.scripts);
    } catch { /* silencioso */ }
    setScriptsLoading(false);
  }

  // ── Efectos ───────────────────────────────────────────

  // Polling codegen
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    async function pollCodegen() {
      try {
        const res = await fetch("/api/playwright/codegen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status" }),
        });
        const d = await res.json();
        setCodegenRunning(d.running);
        if (d.output) setCodegenLogs(d.output);
        setCodegenError(d.status === "error");
      } catch { /* silencioso */ }
    }
    pollCodegen();
    interval = setInterval(pollCodegen, codegenRunning ? 1500 : 10000);
    return () => clearInterval(interval);
  }, [codegenRunning]);

  // Polling runner
  useEffect(() => {
    if (!runnerRunning) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/playwright/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status" }),
        });
        const d = await res.json();
        setRunnerLogs(d.output ?? "");
        setRunnerStatus(d.status as RunStatus);
        if (!d.running) setRunnerRunning(false);
      } catch { /* silencioso */ }
    }, 1500);
    return () => clearInterval(interval);
  }, [runnerRunning]);

  useEffect(() => { fetchSettings(); fetchSessionStatus(); fetchScripts(); }, []);

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // ── Guardar configuración ─────────────────────────────

  async function saveSettings() {
    setSaving(true);
    try {
      const toSave: Record<string, string> = {};
      for (const [k, v] of Object.entries(form)) {
        if (!k.startsWith("_") && v !== "••••••••") toSave[k] = v;
      }
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toSave),
      });
      const data = await res.json();
      if (data.success) { toast.success("Configuración guardada"); await fetchSettings(); }
      else toast.error(data.message ?? "Error al guardar");
    } catch { toast.error("Error de conexión"); }
    finally { setSaving(false); }
  }

  // ── SEPOMEX import ────────────────────────────────────

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/sepomex/import", { method: "POST", body: fd });
      const data = await res.json();
      if (data.success) {
        setImportResult({ inserted: data.inserted, sheets: data.sheets });
        toast.success(`${data.inserted.toLocaleString()} colonias importadas de ${data.sheets} hoja(s)`);
      } else toast.error(data.message ?? "Error importando SEPOMEX");
    } catch { toast.error("Error de conexión"); }
    finally { setImporting(false); e.target.value = ""; }
  }

  // ── Playwright session ────────────────────────────────

  async function playwrightDo(action: string) {
    setPlaywrightAction(action);
    try {
      const res = await fetch("/api/playwright", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success) { toast.success(data.message ?? "Acción completada"); await fetchSessionStatus(); }
      else toast.error(data.message ?? "Error");
    } catch { toast.error("Error de conexión"); }
    finally { setPlaywrightAction(null); }
  }

  // ── Codegen ───────────────────────────────────────────

  async function startCodegen() {
    setCodegenLogs("");
    setCodegenError(false);
    setCodegenCode("");
    setCodegenSteps([]);
    setSavedScriptName(null);
    setSaveScriptName(defaultScriptName());
    setCodegenRunning(true);
    try {
      const res = await fetch("/api/playwright/codegen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          url: codegenUrl || form.enviatodoUrl || "https://app.enviatodo.com/#Login/login",
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Chrome abierto — graba tus acciones en EnviaTodo");
        setShowCodegenLogs(true);
      } else {
        toast.error(data.message ?? "Error al iniciar");
        setCodegenRunning(false);
      }
    } catch { toast.error("Error de conexión"); setCodegenRunning(false); }
  }

  async function stopCodegen() {
    try {
      const res = await fetch("/api/playwright/codegen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      const data = await res.json();
      if (data.output) setCodegenLogs(data.output);
      if (data.code) {
        setCodegenCode(data.code);
        toast.success("Grabación detenida — analizando pasos…");
        // Parsear pasos
        const parseRes = await fetch("/api/playwright/scripts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "parse", code: data.code }),
        });
        const parseData = await parseRes.json();
        if (parseData.success) setCodegenSteps(parseData.steps);
      } else {
        toast("Grabación detenida (sin archivo generado)");
      }
    } catch { toast.error("Error de conexión"); }
    finally { setCodegenRunning(false); }
  }

  async function handleSaveScript() {
    if (!codegenCode || !saveScriptName.trim()) {
      toast.error("Ponle un nombre al script primero");
      return;
    }
    setSavingScript(true);
    try {
      const res = await fetch("/api/playwright/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", name: saveScriptName.trim(), code: codegenCode }),
      });
      const data = await res.json();
      if (data.success) {
        setSavedScriptName(data.name);
        toast.success(`Script guardado: ${data.name}`);
        await fetchScripts();
      } else {
        toast.error(data.error ?? "Error al guardar");
      }
    } catch { toast.error("Error de conexión"); }
    finally { setSavingScript(false); }
  }

  // ── Importar flujo (archivo o pegado) ────────────────

  /** Carga código en el estado de codegen (igual que detener grabación). */
  async function handleLoadCode(code: string, filename?: string) {
    const trimmed = code.trim();
    if (!trimmed) { toast.error("El código está vacío"); return; }
    setCodegenCode(trimmed);
    setSavedScriptName(null);
    setShowCodegenRaw(false);
    // Nombre sugerido a partir del archivo o timestamp
    const suggestedName = filename
      ? filename.replace(/\.(ts|js|txt)$/i, "")
      : defaultScriptName();
    setSaveScriptName(suggestedName);
    // Parsear pasos (reutiliza el endpoint existente)
    try {
      const parseRes = await fetch("/api/playwright/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "parse", code: trimmed }),
      });
      const parseData = await parseRes.json();
      if (parseData.success) setCodegenSteps(parseData.steps ?? []);
    } catch { /* silencioso */ }
    toast.success("Flujo cargado — revisa los pasos y guárdalo");
  }

  async function handleFileUpload(file: File) {
    if (!file) return;
    const text = await file.text();
    await handleLoadCode(text, file.name);
  }

  // ── Script library ────────────────────────────────────

  async function handleExpandScript(name: string) {
    if (expandedScript === name) {
      setExpandedScript(null);
      return;
    }
    try {
      const res = await fetch("/api/playwright/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read", name }),
      });
      const data = await res.json();
      if (data.success) {
        setExpandedScript(name);
        setExpandedScriptCode(data.code);
        setExpandedScriptSteps(data.steps);
        setShowExpandedCode(false);
      }
    } catch { toast.error("Error cargando script"); }
  }

  async function handleDeleteScript(name: string) {
    if (!confirm(`¿Eliminar "${name}"?`)) return;
    try {
      const res = await fetch("/api/playwright/scripts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", name }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Script eliminado");
        if (expandedScript === name) setExpandedScript(null);
        await fetchScripts();
      } else toast.error(data.error ?? "Error al eliminar");
    } catch { toast.error("Error de conexión"); }
  }

  function handleCopyScript(code: string) {
    navigator.clipboard.writeText(code);
    toast.success("Código copiado al portapapeles");
  }

  // ── Runner ────────────────────────────────────────────

  async function startRunner(scriptName: string) {
    if (runnerRunning) { toast.error("Ya hay una ejecución activa"); return; }
    setRunnerScript(scriptName);
    setRunnerLogs("");
    setRunnerStatus("running");
    setRunnerRunning(true);
    try {
      const res = await fetch("/api/playwright/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", script: scriptName }),
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.message ?? "Error al iniciar");
        setRunnerRunning(false);
        setRunnerStatus("error");
      } else {
        toast.success(`Ejecutando ${scriptName}…`);
      }
    } catch { toast.error("Error de conexión"); setRunnerRunning(false); setRunnerStatus("error"); }
  }

  async function stopRunner() {
    try {
      await fetch("/api/playwright/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      setRunnerRunning(false);
      setRunnerStatus("stopped");
      toast("Ejecución detenida");
    } catch { toast.error("Error de conexión"); }
  }

  async function clearRunner() {
    await fetch("/api/playwright/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear" }),
    });
    setRunnerLogs("");
    setRunnerStatus("idle");
    setRunnerScript("");
  }

  // ── Render ────────────────────────────────────────────

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Spinner className="w-8 h-8 text-primary-400" /></div>;
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-3xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-dark-100">Configuración</h1>
          <p className="text-sm text-dark-400 mt-0.5">Integraciones y parámetros del sistema</p>
        </div>
        <button onClick={saveSettings} disabled={saving} className="btn-primary">
          {saving ? <Spinner /> : <Save className="w-4 h-4" />}
          Guardar todo
        </button>
      </div>

      {/* ── Shopify ──────────────────────────────────── */}
      <Section title="Shopify" icon={ShoppingBag} id="shopify">
        <Field label="URL de la tienda" hint="Solo el dominio: mi-tienda.myshopify.com">
          <input type="text" className="input" placeholder="mi-tienda.myshopify.com"
            value={form.shopifyStoreUrl ?? ""} onChange={(e) => set("shopifyStoreUrl", e.target.value)} />
        </Field>
        <Field label="Access Token" hint="Shopify Admin → Configuración → Apps → Desarrollar apps → Token de Admin API">
          <PasswordInput
            value={form.shopifyAccessToken ?? ""} onChange={(v) => set("shopifyAccessToken", v)}
            placeholder="shpat_xxxxxxxxxxxx" hasValue={settings?._hasShopifyToken}
          />
        </Field>
        <Field label="Versión API" hint="Recomendado: 2024-07">
          <input type="text" className="input w-36" placeholder="2024-07"
            value={form.shopifyApiVersion ?? "2024-07"} onChange={(e) => set("shopifyApiVersion", e.target.value)} />
        </Field>
        <div className="p-3 rounded-lg bg-dark-800/60 border border-dark-700/40 text-xs text-dark-400 space-y-1">
          <p className="font-medium text-dark-300">Filtros automáticos:</p>
          <p>✅ Solo pagados · ✅ Sin guía generada · ✅ Últimos 7 días</p>
        </div>
      </Section>

      {/* ── EnviaTodo ─────────────────────────────────── */}
      <Section title="EnviaTodo" icon={Truck}>
        <Field label="URL base">
          <input type="text" className="input" value={form.enviatodoUrl ?? ""}
            onChange={(e) => set("enviatodoUrl", e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Email / Usuario">
            <input type="email" className="input" placeholder="correo@ejemplo.com"
              value={form.enviatodoEmail ?? ""} onChange={(e) => set("enviatodoEmail", e.target.value)} />
          </Field>
          <Field label="Contraseña">
            <PasswordInput value={form.enviatodoPassword ?? ""} onChange={(v) => set("enviatodoPassword", v)}
              placeholder="Contraseña" hasValue={settings?._hasEnviatodoPassword} />
          </Field>
        </div>
      </Section>

      {/* ── SEPOMEX ───────────────────────────────────── */}
      <Section title="Base postal SEPOMEX" icon={Database}>
        <Field label="Subir archivo Excel SEPOMEX"
          hint="CPdescarga.xlsx — columnas: d_codigo, d_asenta, D_mnpio, d_estado. Se importan TODAS las hojas.">
          <div className="flex items-center gap-3">
            <label className={cn("btn-secondary cursor-pointer", importing && "opacity-50 cursor-not-allowed")}>
              {importing ? <Spinner /> : <Upload className="w-4 h-4" />}
              {importing ? "Importando…" : "Seleccionar .xlsx"}
              <input type="file" accept=".xlsx,.xls" onChange={handleImport} className="hidden" disabled={importing} />
            </label>
          </div>
          {importResult && (
            <div className="flex items-center gap-2 mt-2 text-xs text-emerald-400 bg-emerald-900/15 border border-emerald-800/30 rounded-lg px-3 py-2">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              {importResult.inserted.toLocaleString()} colonias importadas de {importResult.sheets} hoja(s)
            </div>
          )}
        </Field>
      </Section>

      {/* ── Playwright / Sesión ───────────────────────── */}
      <Section title="Playwright / Sesión EnviaTodo" icon={Chrome}>
        <div className="flex items-center gap-3 p-3 rounded-lg bg-dark-800/50 border border-dark-700">
          <div className={cn("w-2 h-2 rounded-full shrink-0",
            sessionStatus === true ? "bg-emerald-400" : sessionStatus === false ? "bg-red-400" : "bg-dark-500")} />
          <span className="text-sm text-dark-300">
            Sesión: {sessionStatus === true ? "activa ✅" : sessionStatus === false ? "no existe" : "verificando…"}
          </span>
        </div>
        <div className="flex flex-wrap gap-3">
          <button onClick={() => playwrightDo("login")} disabled={!!playwrightAction} className="btn-secondary">
            {playwrightAction === "login" ? <Spinner /> : <Chrome className="w-4 h-4" />}
            Iniciar sesión EnviaTodo
          </button>
          <button onClick={() => playwrightDo("reset")} disabled={!!playwrightAction} className="btn-secondary">
            {playwrightAction === "reset" ? <Spinner /> : <RefreshCw className="w-4 h-4" />}
            Resetear cookies
          </button>
        </div>
        <Field label="Modo del navegador">
          <select className="input w-64" value={form.playwrightHeadless ?? "false"}
            onChange={(e) => set("playwrightHeadless", e.target.value)}>
            <option value="false">Visible (recomendado)</option>
            <option value="true">Invisible / headless</option>
          </select>
        </Field>
      </Section>

      {/* ══════════════════════════════════════════════════
          PLAYWRIGHT STUDIO — Sección completa
          ══════════════════════════════════════════════════ */}

      {/* ── A: Grabador de flujos ─────────────────────── */}
      <Section title="Grabador de flujos" icon={Code2} id="codegen">

        {/* Instrucciones */}
        <div className="p-3 rounded-lg bg-blue-900/10 border border-blue-800/30 text-xs text-blue-300">
          <p className="font-semibold mb-1.5">Cómo grabar un flujo:</p>
          <ol className="list-decimal ml-4 space-y-0.5 text-blue-400">
            <li>Haz clic en <strong className="text-blue-300">Iniciar grabación</strong> — se abrirá Chrome 1920×1080.</li>
            <li>Navega por EnviaTodo y realiza las acciones que quieres automatizar.</li>
            <li>Haz clic en <strong className="text-blue-300">Detener grabación</strong>.</li>
            <li>Revisa los pasos detectados y guarda el script con un nombre.</li>
          </ol>
        </div>

        {/* ── Importar flujo externo ─────────────────────────────── */}
        <div className="border border-dark-700 rounded-xl overflow-hidden">
          {/* Header con tabs */}
          <div className="flex items-center gap-0 bg-dark-800/60 border-b border-dark-700">
            <button
              onClick={() => setUploadTab("file")}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors",
                uploadTab === "file"
                  ? "border-primary-500 text-primary-300 bg-dark-800/80"
                  : "border-transparent text-dark-400 hover:text-dark-200"
              )}
            >
              <FilePlus2 className="w-3.5 h-3.5" />
              Subir archivo
            </button>
            <button
              onClick={() => setUploadTab("paste")}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors",
                uploadTab === "paste"
                  ? "border-primary-500 text-primary-300 bg-dark-800/80"
                  : "border-transparent text-dark-400 hover:text-dark-200"
              )}
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
              Pegar código
            </button>
            <span className="ml-auto px-4 text-xs text-dark-600">Importar flujo</span>
          </div>

          {/* Tab: Archivo */}
          {uploadTab === "file" && (
            <div className="p-4">
              {/* Zona drag-and-drop */}
              <div
                onDragOver={(e) => { e.preventDefault(); setUploadDragOver(true); }}
                onDragLeave={() => setUploadDragOver(false)}
                onDrop={async (e) => {
                  e.preventDefault();
                  setUploadDragOver(false);
                  const file = e.dataTransfer.files[0];
                  if (file) await handleFileUpload(file);
                }}
                onClick={() => uploadInputRef.current?.click()}
                className={cn(
                  "relative flex flex-col items-center justify-center gap-2 py-8 rounded-lg border-2 border-dashed cursor-pointer transition-all",
                  uploadDragOver
                    ? "border-primary-400 bg-primary-900/15 text-primary-300"
                    : "border-dark-600 bg-dark-900/40 text-dark-500 hover:border-dark-500 hover:bg-dark-800/50 hover:text-dark-300"
                )}
              >
                <Upload className="w-8 h-8 opacity-60" />
                <div className="text-center">
                  <p className="text-sm font-medium">Arrastra un archivo o haz clic</p>
                  <p className="text-xs text-dark-600 mt-0.5">Acepta .ts · .js · .txt</p>
                </div>
              </div>
              {/* Input oculto */}
              <input
                ref={uploadInputRef}
                type="file"
                accept=".ts,.js,.txt"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) await handleFileUpload(file);
                  e.target.value = "";
                }}
              />
            </div>
          )}

          {/* Tab: Pegar código */}
          {uploadTab === "paste" && (
            <div className="p-4 space-y-3">
              <textarea
                rows={8}
                className="input font-mono text-xs resize-y"
                placeholder={"// Pega aquí tu script de Playwright...\nimport { chromium } from '@playwright/test';\n..."}
                value={pasteCode}
                onChange={(e) => setPasteCode(e.target.value)}
                spellCheck={false}
              />
              <button
                onClick={async () => {
                  await handleLoadCode(pasteCode);
                  setPasteCode("");
                }}
                disabled={!pasteCode.trim()}
                className="btn-primary w-full justify-center"
              >
                <FilePlus2 className="w-4 h-4" />
                Cargar flujo
              </button>
            </div>
          )}
        </div>

        {/* Separador visual antes de grabación */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-dark-700/60" />
          <span className="text-xs text-dark-600 font-medium">o graba uno nuevo</span>
          <div className="flex-1 h-px bg-dark-700/60" />
        </div>

        {/* Controles */}
        <div className="flex items-center gap-3">
          <input type="text" className="input text-sm flex-1"
            placeholder={`URL (default: ${form.enviatodoUrl || "https://app.enviatodo.com/#Login/login"})`}
            value={codegenUrl} onChange={(e) => setCodegenUrl(e.target.value)} />
          {!codegenRunning ? (
            <button onClick={startCodegen} className="btn-primary shrink-0 gap-2">
              <Play className="w-4 h-4" /> Iniciar grabación
            </button>
          ) : (
            <button onClick={stopCodegen} className="btn-danger shrink-0 gap-2 animate-pulse">
              <Square className="w-4 h-4" /> Detener grabación
            </button>
          )}
        </div>

        {/* Badges de estado */}
        {codegenRunning && (
          <div className="flex items-center gap-2 text-xs text-yellow-400 bg-yellow-900/15 border border-yellow-800/30 rounded-lg px-3 py-2.5">
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse shrink-0" />
            <span>Grabando… navega en Chrome y haz clic en <strong>Detener grabación</strong> cuando termines.</span>
          </div>
        )}
        {codegenError && (
          <div className="flex items-start gap-2 text-xs text-red-300 bg-red-900/15 border border-red-800/30 rounded-lg px-3 py-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Error al iniciar grabación</p>
              <p className="text-dark-400 mt-0.5">
                Asegúrate de tener el browser instalado:
                <code className="ml-1 text-primary-400">npx playwright install chromium</code>
              </p>
            </div>
          </div>
        )}

        {/* Logs (colapsable) */}
        {codegenLogs && (
          <div className="space-y-1">
            <button
              onClick={() => setShowCodegenLogs((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-dark-400 hover:text-dark-200 transition-colors"
            >
              {showCodegenLogs ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              Logs del proceso
            </button>
            {showCodegenLogs && <LogsPanel logs={codegenLogs} label="salida del proceso" />}
          </div>
        )}

        {/* ── Resultado de la grabación ──────────────── */}
        {codegenCode && !codegenRunning && (
          <div className="border border-dark-700 rounded-xl overflow-hidden">
            {/* Header del resultado */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-dark-800/70 border-b border-dark-700">
              <div className="flex items-center gap-2 text-sm text-dark-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="font-medium">Flujo grabado</span>
                {codegenSteps.length > 0 && (
                  <span className="text-xs text-dark-500">· {codegenSteps.length} pasos detectados</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowCodegenRaw((v) => !v)}
                  className="btn-ghost text-xs py-1 gap-1"
                >
                  <Code2 className="w-3 h-3" />
                  {showCodegenRaw ? "Ocultar código" : "Ver código"}
                </button>
                <button
                  onClick={() => handleCopyScript(codegenCode)}
                  className="btn-ghost text-xs py-1 gap-1"
                >
                  <Copy className="w-3 h-3" /> Copiar
                </button>
              </div>
            </div>

            {/* Pasos detectados */}
            {codegenSteps.length > 0 && (
              <div className="px-4 py-3 bg-dark-900/50">
                <p className="text-xs font-medium text-dark-300 flex items-center gap-1.5 mb-2">
                  <List className="w-3.5 h-3.5 text-primary-400" />
                  Pasos detectados
                </p>
                <StepsList steps={codegenSteps} />
              </div>
            )}

            {/* Código raw (colapsable) */}
            {showCodegenRaw && (
              <div className="border-t border-dark-700">
                <pre className="bg-dark-950 p-3 text-xs text-emerald-400 overflow-auto max-h-56 font-mono">
                  {codegenCode}
                </pre>
              </div>
            )}

            {/* Guardar script */}
            <div className="px-4 py-3 bg-dark-800/40 border-t border-dark-700 space-y-2">
              {savedScriptName ? (
                <div className="flex items-center gap-2 text-xs text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  Guardado como <strong>{savedScriptName}</strong>
                  <span className="text-dark-500">· visible en la biblioteca de scripts abajo</span>
                </div>
              ) : (
                <>
                  <p className="text-xs text-dark-400 font-medium">Guardar script en la biblioteca:</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      className="input text-sm flex-1"
                      placeholder="Nombre del script (sin .ts)"
                      value={saveScriptName}
                      onChange={(e) => setSaveScriptName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSaveScript()}
                    />
                    <button onClick={handleSaveScript} disabled={savingScript} className="btn-primary shrink-0">
                      {savingScript ? <Spinner /> : <Save className="w-4 h-4" />}
                      Guardar script
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Tip si no hay nada grabado */}
        {!codegenCode && !codegenRunning && (
          <div className="p-3 rounded-lg bg-dark-800/50 border border-dark-700 text-xs text-dark-500">
            <p className="font-medium text-dark-400 mb-1">Si el browser no se abre:</p>
            <pre className="text-emerald-500 font-mono">npx playwright install chromium</pre>
          </div>
        )}

      </Section>

      {/* ── B: Biblioteca de scripts ──────────────────── */}
      <Section title="Scripts guardados" icon={BookOpen} id="scripts">
        <div className="flex items-center justify-between">
          <p className="text-xs text-dark-400">
            {scripts.length === 0
              ? "No hay scripts guardados. Graba uno arriba."
              : `${scripts.length} script(s) en playwright/scripts/`}
          </p>
          <button onClick={fetchScripts} disabled={scriptsLoading} className="btn-ghost text-xs py-1 gap-1">
            {scriptsLoading ? <Spinner className="w-3 h-3" /> : <RefreshCw className="w-3 h-3" />}
            Actualizar
          </button>
        </div>

        {scripts.length > 0 && (
          <div className="space-y-2">
            {scripts.map((sc) => (
              <div
                key={sc.name}
                className="border border-dark-700 rounded-xl overflow-hidden transition-colors hover:border-dark-600"
              >
                {/* Cabecera del script */}
                <div className="flex items-center gap-3 px-4 py-3 bg-dark-800/50">
                  <FileCode className="w-4 h-4 text-primary-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-dark-200 truncate">{sc.name}</span>
                      {sc.isTemplate && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-900/30 text-yellow-500 border border-yellow-800/40">
                          plantilla
                        </span>
                      )}
                      {!sc.isTemplate && sc.stepCount > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-900/30 text-primary-400 border border-primary-800/40">
                          {sc.stepCount} pasos
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-dark-500 mt-0.5">
                      {fmtBytes(sc.size)} · {timeAgo(sc.lastModified)}
                    </p>
                  </div>

                  {/* Acciones */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => startRunner(sc.name)}
                      disabled={runnerRunning}
                      className="btn-primary py-1.5 px-3 text-xs gap-1"
                      title="Ejecutar script"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      Ejecutar
                    </button>
                    <button
                      onClick={() => handleExpandScript(sc.name)}
                      className="btn-ghost py-1.5 px-2 text-xs"
                      title="Ver pasos y código"
                    >
                      {expandedScript === sc.name
                        ? <ChevronUp className="w-4 h-4" />
                        : <ChevronDown className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => handleDeleteScript(sc.name)}
                      className="btn-ghost py-1.5 px-2 text-xs text-red-500 hover:text-red-400"
                      title="Eliminar"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Preview de pasos (colapsado por defecto) */}
                {expandedScript !== sc.name && sc.steps.length > 0 && (
                  <div className="px-4 py-2 bg-dark-900/30 border-t border-dark-700/50">
                    <p className="text-xs text-dark-500 truncate">
                      {sc.steps[0]}{sc.steps.length > 1 ? ` … (+${sc.steps.length - 1} más)` : ""}
                    </p>
                  </div>
                )}

                {/* Expandido: pasos completos + código */}
                {expandedScript === sc.name && (
                  <div className="border-t border-dark-700">
                    {/* Tabs: Pasos / Código */}
                    <div className="flex border-b border-dark-700">
                      <button
                        onClick={() => setShowExpandedCode(false)}
                        className={cn(
                          "flex-1 py-2 text-xs font-medium transition-colors",
                          !showExpandedCode ? "text-primary-400 bg-dark-800/60" : "text-dark-500 hover:text-dark-300"
                        )}
                      >
                        <List className="inline w-3.5 h-3.5 mr-1" />
                        Pasos ({expandedScriptSteps.length})
                      </button>
                      <button
                        onClick={() => setShowExpandedCode(true)}
                        className={cn(
                          "flex-1 py-2 text-xs font-medium transition-colors",
                          showExpandedCode ? "text-primary-400 bg-dark-800/60" : "text-dark-500 hover:text-dark-300"
                        )}
                      >
                        <Code2 className="inline w-3.5 h-3.5 mr-1" />
                        Código
                      </button>
                    </div>

                    {!showExpandedCode ? (
                      <div className="px-4 py-3 bg-dark-900/40">
                        {expandedScriptSteps.length > 0 ? (
                          <StepsList steps={expandedScriptSteps} />
                        ) : (
                          <p className="text-xs text-dark-500 italic">
                            No se detectaron pasos automáticamente — es un script de plantilla o tiene formato especial.
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="relative">
                        <button
                          onClick={() => handleCopyScript(expandedScriptCode)}
                          className="absolute top-2 right-2 btn-ghost text-xs py-1 z-10 gap-1"
                        >
                          <Copy className="w-3 h-3" /> Copiar
                        </button>
                        <pre className="bg-dark-950 p-4 text-xs text-emerald-400 overflow-auto max-h-72 font-mono">
                          {expandedScriptCode}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {scripts.length === 0 && !scriptsLoading && (
          <div className="text-center py-6 text-xs text-dark-500">
            <FileCode className="w-8 h-8 mx-auto mb-2 text-dark-700" />
            <p>Graba tu primer flujo usando el <strong>Grabador de flujos</strong> de arriba.</p>
          </div>
        )}
      </Section>

      {/* ── C: Ejecución en vivo ──────────────────────── */}
      {(runnerRunning || runnerStatus !== "idle") && (
        <Section title="Ejecución en vivo" icon={Zap} id="runner">

          {/* Estado */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border",
                statusColor(runnerStatus)
              )}>
                {runnerRunning && (
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                )}
                {statusLabel(runnerStatus)}
              </div>
              {runnerScript && (
                <span className="text-xs text-dark-400">
                  <FileCode className="inline w-3.5 h-3.5 mr-1 text-dark-500" />
                  {runnerScript}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {runnerRunning && (
                <button onClick={stopRunner} className="btn-danger text-xs py-1.5 gap-1">
                  <StopCircle className="w-3.5 h-3.5" /> Detener
                </button>
              )}
              {!runnerRunning && runnerStatus !== "idle" && (
                <button onClick={clearRunner} className="btn-ghost text-xs py-1.5 gap-1">
                  <Trash2 className="w-3.5 h-3.5" /> Limpiar
                </button>
              )}
            </div>
          </div>

          {/* Logs */}
          {runnerLogs && <LogsPanel logs={runnerLogs} label="ejecución" />}

          {runnerStatus === "done" && (
            <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-900/10 border border-emerald-800/30 rounded-lg px-3 py-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Script ejecutado correctamente. Revisa EnviaTodo para confirmar los cambios.
            </div>
          )}
          {runnerStatus === "error" && (
            <div className="flex items-start gap-2 text-xs text-red-300 bg-red-900/10 border border-red-800/30 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Error durante la ejecución</p>
                <p className="text-dark-400 mt-0.5">
                  Si dice "tsx not found": <code className="text-primary-400">npm install -D tsx</code>
                </p>
              </div>
            </div>
          )}
        </Section>
      )}

      {/* ── Validaciones ─────────────────────────────── */}
      <Section title="Reglas de validación" icon={Settings}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Máx. chars nombre" hint="EnviaTodo acepta máx. 30">
            <input type="number" className="input" min={1} max={100}
              value={form.maxNombreChars ?? "30"} onChange={(e) => set("maxNombreChars", e.target.value)} />
          </Field>
          <Field label="Máx. chars dirección" hint="EnviaTodo acepta máx. 42">
            <input type="number" className="input" min={1} max={200}
              value={form.maxDireccionChars ?? "42"} onChange={(e) => set("maxDireccionChars", e.target.value)} />
          </Field>
        </div>
        <Field label="Palabras clave de referencia" hint="Separadas por coma. Se detectan para mover al campo de referencias.">
          <textarea className="input h-20 resize-none" value={form.palabrasReferencia ?? ""}
            onChange={(e) => set("palabrasReferencia", e.target.value)} />
        </Field>
      </Section>

      <div className="flex justify-end pb-4">
        <button onClick={saveSettings} disabled={saving} className="btn-primary">
          {saving ? <Spinner /> : <Save className="w-4 h-4" />}
          Guardar configuración
        </button>
      </div>
    </div>
  );
}
