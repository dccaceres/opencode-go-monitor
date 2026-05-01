import type { PluginInput } from '@opencode-ai/plugin';
import type { GoUsage, AlertThreshold, NotifierState, AlertLevel } from './types';

const ALERT_THRESHOLDS: readonly AlertThreshold[] = [
  {
    percentage: 70,
    level: 'warning',
    message: (period: string, pct: number) =>
      `⚠️ ${period}: ${pct}% usado — se acerca al límite`,
  },
  {
    percentage: 90,
    level: 'warning',
    message: (period: string, pct: number) =>
      `🔶 ${period}: ${pct}% usado — casi al límite`,
  },
  {
    percentage: 100,
    level: 'error',
    message: (period: string) =>
      `🔴 ${period}: LÍMITE ALCANZADO — pasando a créditos Zen`,
  },
];

const COOLDOWN_MS = 3600000; // 1 hora entre alertas del mismo umbral

const state: NotifierState = {
  lastAlerted: {},
  cooldownMs: COOLDOWN_MS,
};

export function checkThresholds(
  _ctx: PluginInput,
  usage: GoUsage
): Array<{ period: string; level: AlertLevel; message: string }> {
  const alerts: Array<{ period: string; level: AlertLevel; message: string }> = [];
  const now = Date.now();

  const periods = [
    { name: 'Ventana actual', data: usage.currentPeriod },
    { name: 'Semanal', data: usage.weekly },
    { name: 'Mensual', data: usage.monthly },
  ] as const;

  for (const { name, data } of periods) {
    for (const threshold of ALERT_THRESHOLDS) {
      const key = `${name}:${threshold.percentage}`;

      const lastAlert = state.lastAlerted[key];
      if (lastAlert && (now - lastAlert) < state.cooldownMs) {
        continue;
      }

      if (data.percentage >= threshold.percentage) {
        alerts.push({
          period: name,
          level: threshold.level,
          message: threshold.message(name, data.percentage),
        });
        state.lastAlerted[key] = now;
      }
    }
  }

  return alerts;
}

export async function showNotification(
  ctx: PluginInput,
  level: AlertLevel,
  message: string
): Promise<void> {
  await ctx.client.app.log({
    body: {
      service: 'opencode-go-monitor',
      level: level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info',
      message,
    },
  });

  try {
    await ctx.client.tui.showToast({
      body: {
        title: 'Plan Go',
        message,
        variant: level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'info',
        duration: 5000,
      },
    });
  } catch {
    console.log(`[opencode-go-monitor] ${message}`);
  }
}
