export type OrderStatus =
  | "PENDING"
  | "ANALYZING"
  | "CORRECTABLE"
  | "NEEDS_REVIEW"
  | "CRITICAL"
  | "APPROVED"
  | "REJECTED"
  | "APPLIED"
  | "OK";

export type ErrorType =
  | "CP_INCORRECTO"
  | "COLONIA_MAL_ESCRITA"
  | "SIN_COLONIA"
  | "SIN_COLONIA_CP_INCORRECTO"
  | "DIRECCION_INVALIDA"
  | "DIRECCION_LARGA"
  | "NOMBRE_LARGO"
  | "MULTIPLE_ERRORES"
  | "OK";

export type ConfidenceLevel = "ALTA" | "MEDIA" | "BAJA" | "CRITICA" | "UNKNOWN";

export type LogLevel = "INFO" | "WARN" | "ERROR" | "SUCCESS" | "DEBUG";

export interface ShopifyAddress {
  name?: string;
  first_name?: string;
  last_name?: string;
  address1: string;
  address2?: string;
  city: string;
  province: string;
  province_code?: string;
  zip: string;
  country: string;
  country_code?: string;
  phone?: string;
}

export interface ShopifyOrder {
  id: string;
  order_number: string | number;
  name: string;
  created_at: string;
  financial_status?: string;
  fulfillment_status?: string | null;
  customer: {
    first_name: string;
    last_name: string;
    email?: string;
    phone?: string;
  };
  shipping_address: ShopifyAddress;
  billing_address?: ShopifyAddress;
  admin_graphql_api_id: string;
}

export interface ColoniaSugerida {
  colonia: string;
  cp: string;
  matchPct?: number;
}

export interface ValidationResult {
  errorType: ErrorType;
  confidence: ConfidenceLevel;
  suggestedAddress?: {
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    zip?: string;
    colonia?: string;
    reference?: string;
  };
  detectedColonia?: string;
  errorDetails?: string;
  notes?: string;
  source?: "sepomex" | "micodigopostal" | "manual";
  /** Lista de colonias para el picker de UI (SIN_COLONIA o confianza baja) */
  coloniasSugeridas?: ColoniaSugerida[];
}

export interface ColoniaRecord {
  id: number;
  colonia: string;
  cp: string;
  municipio: string;
  estado: string;
  coloniaNorm: string;
}

export interface OrderWithDetails {
  id: string;
  shopifyId: string;
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
  sugAddress1?: string | null;
  sugAddress2?: string | null;
  sugCity?: string | null;
  sugState?: string | null;
  sugZip?: string | null;
  sugColonia?: string | null;
  sugReference?: string | null;
  detectedColonia?: string | null;
  originalColonia?: string | null;
  errorType?: string | null;
  errorDetails?: string | null;
  confidence: string;
  validationNotes?: string | null;
  status: string;
  shopifyLink?: string | null;
  mapLink?: string | null;
  shopifyCreatedAt?: Date | null;
  syncedAt: Date;
  approvedAt?: Date | null;
  rejectedAt?: Date | null;
  rejectedReason?: string | null;
  appliedAt?: Date | null;
  enviatodoId?: string | null;
  sugColoniasJson?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DashboardStats {
  total: number;
  pending: number;
  correctable: number;
  needsReview: number;
  critical: number;
  approved: number;
  rejected: number;
  applied: number;
  ok: number;
  recentActivity: RecentActivity[];
}

export interface RecentActivity {
  id: string;
  action: string;
  message: string;
  level: string;
  orderId?: string | null;
  createdAt: Date;
}

export interface AppSettings {
  // Shopify
  shopifyStoreUrl: string;
  shopifyAccessToken: string;
  shopifyApiVersion: string;

  // EnviaTodo
  enviatodoEmail: string;
  enviatodoPassword: string;
  enviatodoUrl: string;

  // Validaciones
  maxNombreChars: string;
  maxDireccionChars: string;
  palabrasReferencia: string;

  // Playwright
  playwrightHeadless: string;
}
