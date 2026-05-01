// Period types for usage tracking
export type PeriodType = '5hour' | 'weekly' | 'monthly';

export interface PeriodUsage {
  used: number;        // in USD
  limit: number;       // in USD
  percentage: number;  // 0-100
  hours?: number;      // for 5-hour period
  remainingTime?: string; // e.g. "3h 15m"
}

export interface GoUsage {
  lastUpdated: Date;
  currentPeriod: PeriodUsage;
  weekly: PeriodUsage;
  monthly: PeriodUsage;
}

export type AlertLevel = 'info' | 'warning' | 'error';

export interface AlertThreshold {
  percentage: number;
  level: AlertLevel;
  message: (period: string, percentage: number) => string;
}

export interface NotifierState {
  lastAlerted: Record<string, number>; // period:threshold -> timestamp
  cooldownMs: number; // default: 3600000 (1 hour)
}

export interface PluginConfig {
  workspaceId: string;
  authCookie: string;
  refreshIntervalMs: number; // default: 300000 (5 minutes)
}

export interface ScrapeResult {
  success: boolean;
  data: GoUsage | null;
  error?: string;
}
