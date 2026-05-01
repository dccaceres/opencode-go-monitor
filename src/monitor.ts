import type { PluginInput } from '@opencode-ai/plugin';
import type { GoUsage, ScrapeResult, PluginConfig } from './types';

// Constants for the Go plan limits
const PERIOD_LIMIT = 12;     // $12 per 5-hour block
const WEEKLY_LIMIT = 30;     // $30 weekly
const MONTHLY_LIMIT = 60;    // $60 monthly
const PERIOD_HOURS = 5;      // 5 hours per period

// In-memory cache
let cachedUsage: GoUsage | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Types for the API response from console.opencode.ai
interface ApiUsageWindow {
  status: 'ok' | 'error' | 'unknown';
  usagePercent: number;
  resetsInSeconds: number;
}

interface ApiUsageResponse {
  rolling: ApiUsageWindow;
  weekly: ApiUsageWindow;
  monthly: ApiUsageWindow;
}

export async function fetchUsage(
  ctx: PluginInput,
  config: PluginConfig
): Promise<ScrapeResult> {
  // Check cache first
  const now = Date.now();
  if (cachedUsage && (now - lastFetchTime) < CACHE_TTL_MS) {
    await log(ctx, 'debug', 'Returning cached usage data');
    return { success: true, data: cachedUsage };
  }

  // Try API first, then fallback to HTML scraping
  let lastError: string | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // Try the real API endpoint first
      const result = await fetchFromConsoleApi(ctx, config);
      if (result.success && result.data) {
        cachedUsage = result.data;
        lastFetchTime = now;
        return result;
      }
      lastError = result.error;

      // If API failed, try HTML scraping as fallback
      const scrapeResult = await fetchFromHtml(ctx, config);
      if (scrapeResult.success && scrapeResult.data) {
        cachedUsage = scrapeResult.data;
        lastFetchTime = now;
        return scrapeResult;
      }
      lastError = scrapeResult.error;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : 'Unknown error';
      await log(ctx, 'warn', `Fetch attempt ${attempt}/3 failed: ${lastError}`);
    }

    if (attempt < 3) {
      await sleep(1000 * Math.pow(2, attempt - 1));
    }
  }

  // Return cached data as fallback if available
  if (cachedUsage) {
    await log(ctx, 'warn', 'All fetch attempts failed, returning cached data');
    return { success: true, data: cachedUsage };
  }

  return { success: false, data: null, error: lastError };
}

/**
 * Fetch usage data from the real OpenCode API endpoint.
 * Endpoint: https://console.opencode.ai/zen/go/v1/usage
 * Auth: Cookie with auth=YOUR_COOKIE
 */
async function fetchFromConsoleApi(
  ctx: PluginInput,
  config: PluginConfig
): Promise<ScrapeResult> {
  const url = 'https://console.opencode.ai/zen/go/v1/usage';

  // Ensure the cookie has the 'auth=' prefix
  const cookieHeader = config.authCookie.startsWith('auth=')
    ? config.authCookie
    : `auth=${config.authCookie}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    await log(ctx, 'info', `Fetching usage from API: ${url}`);

    const response = await fetch(url, {
      headers: {
        'Cookie': cookieHeader,
      },
      signal: controller.signal,
    });

    await log(ctx, 'debug', `API response status: ${response.status}`);

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          data: null,
          error: `Authentication failed (HTTP ${response.status}). Check your auth cookie.`,
        };
      }
      return {
        success: false,
        data: null,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const data = await response.json() as ApiUsageResponse;
    await log(ctx, 'info', `API data: rolling=${data.rolling.usagePercent}%, weekly=${data.weekly.usagePercent}%, monthly=${data.monthly.usagePercent}%`);

    if (!data.rolling || !data.weekly || !data.monthly) {
      return {
        success: false,
        data: null,
        error: 'API response missing expected fields (rolling, weekly, monthly)',
      };
    }

    const usage = apiResponseToUsage(data);
    return { success: true, data: usage };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { success: false, data: null, error: 'API request timed out after 10 seconds' };
    }
    return {
      success: false,
      data: null,
      error: err instanceof Error ? err.message : 'Network error',
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Convert API response to our GoUsage format.
 * The API returns usagePercent (0-100) for each window.
 * We calculate the dollar amounts from the known limits.
 */
function apiResponseToUsage(data: ApiUsageResponse): GoUsage {
  const now = new Date();

  // Calculate dollar amounts from usagePercent and known limits
  const rollingUsed = Math.round((data.rolling.usagePercent / 100) * PERIOD_LIMIT * 100) / 100;
  const weeklyUsed = Math.round((data.weekly.usagePercent / 100) * WEEKLY_LIMIT * 100) / 100;
  const monthlyUsed = Math.round((data.monthly.usagePercent / 100) * MONTHLY_LIMIT * 100) / 100;

  // Format remaining time
  const remainingTime = formatResetsInSeconds(data.rolling.resetsInSeconds);

  return {
    lastUpdated: now,
    currentPeriod: {
      used: rollingUsed,
      limit: PERIOD_LIMIT,
      percentage: data.rolling.usagePercent,
      hours: PERIOD_HOURS,
      remainingTime,
    },
    weekly: {
      used: weeklyUsed,
      limit: WEEKLY_LIMIT,
      percentage: data.weekly.usagePercent,
    },
    monthly: {
      used: monthlyUsed,
      limit: MONTHLY_LIMIT,
      percentage: data.monthly.usagePercent,
    },
  };
}

/**
 * HTML scraping fallback: parses server-side rendered data embedded in the dashboard HTML.
 * SolidJS SSR embeds data as: rollingUsage:$R[30]={status:"ok",resetInSec:17562,usagePercent:1}
 */
async function fetchFromHtml(
  ctx: PluginInput,
  config: PluginConfig
): Promise<ScrapeResult> {
  const url = `https://opencode.ai/workspace/${config.workspaceId}/go`;

  const cookieHeader = config.authCookie.startsWith('auth=')
    ? config.authCookie
    : `auth=${config.authCookie}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    await log(ctx, 'debug', `Scraping HTML from: ${url}`);

    const response = await fetch(url, {
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        success: false,
        data: null,
        error: `HTML fetch HTTP ${response.status}`,
      };
    }

    const html = await response.text();

    // Parse SSR-embedded data (SolidJS format)
    const extractWindow = (name: string): { status: string; resetsInSeconds: number; usagePercent: number } | null => {
      // Pattern: name:$R[123]={status:"ok",resetInSec:123,usagePercent:45}
      let pattern = new RegExp(`${name}:\\$R\\[\\d+\\]=\\{status:"([^"]+)",resetInSec:(\\d+),usagePercent:(\\d+)\\}`);
      let match = pattern.exec(html);

      if (!match) {
        // Fallback without $R reference
        pattern = new RegExp(`${name}=\\{status:"([^"]+)",resetInSec:(\\d+),usagePercent:(\\d+)\\}`);
        match = pattern.exec(html);
      }

      if (!match) return null;

      return {
        status: match[1],
        resetsInSeconds: parseInt(match[2], 10),
        usagePercent: parseInt(match[3], 10),
      };
    };

    const rolling = extractWindow('rollingUsage');
    const weekly = extractWindow('weeklyUsage');
    const monthly = extractWindow('monthlyUsage');

    if (!rolling && !weekly && !monthly) {
      return {
        success: false,
        data: null,
        error: 'Could not find usage data in HTML (SSR patterns not found)',
      };
    }

    const now = new Date();

    const rollingUsed = rolling ? Math.round((rolling.usagePercent / 100) * PERIOD_LIMIT * 100) / 100 : 0;
    const weeklyUsed = weekly ? Math.round((weekly.usagePercent / 100) * WEEKLY_LIMIT * 100) / 100 : 0;
    const monthlyUsed = monthly ? Math.round((monthly.usagePercent / 100) * MONTHLY_LIMIT * 100) / 100 : 0;

    const usage: GoUsage = {
      lastUpdated: now,
      currentPeriod: {
        used: rollingUsed,
        limit: PERIOD_LIMIT,
        percentage: rolling?.usagePercent ?? 0,
        hours: PERIOD_HOURS,
        remainingTime: rolling ? formatResetsInSeconds(rolling.resetsInSeconds) : `${PERIOD_HOURS}h 0m`,
      },
      weekly: {
        used: weeklyUsed,
        limit: WEEKLY_LIMIT,
        percentage: weekly?.usagePercent ?? 0,
      },
      monthly: {
        used: monthlyUsed,
        limit: MONTHLY_LIMIT,
        percentage: monthly?.usagePercent ?? 0,
      },
    };

    await log(ctx, 'info', `HTML scraped: rolling=${usage.currentPeriod.percentage}%, weekly=${usage.weekly.percentage}%, monthly=${usage.monthly.percentage}%`);
    return { success: true, data: usage };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { success: false, data: null, error: 'HTML fetch timed out after 10 seconds' };
    }
    return {
      success: false,
      data: null,
      error: err instanceof Error ? err.message : 'Network error',
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Convert seconds to a human-readable remaining time string
 */
function formatResetsInSeconds(seconds: number): string {
  if (seconds <= 0) return '0h 0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function getTestUsage(): GoUsage {
  return {
    lastUpdated: new Date(),
    currentPeriod: {
      used: 8.50,
      limit: 12,
      percentage: 71,
      hours: 5,
      remainingTime: '1h 45m',
    },
    weekly: {
      used: 18.00,
      limit: 30,
      percentage: 60,
    },
    monthly: {
      used: 42.00,
      limit: 60,
      percentage: 70,
    },
  };
}

async function log(
  ctx: PluginInput,
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
): Promise<void> {
  try {
    await ctx.client.app.log({
      body: {
        service: 'opencode-go-monitor',
        level,
        message,
      },
    });
  } catch {
    // Fallback to console if client logging fails
    console.log(`[opencode-go-monitor][${level}] ${message}`);
  }
}
