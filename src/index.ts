import type { Plugin, PluginInput } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import type { GoUsage, PluginConfig } from './types';
import { fetchUsage, getTestUsage } from './monitor';
import { checkThresholds, showNotification } from './notifier';
import { logMessage } from './commands';
import { fetchModels } from './models';

function loadConfig(): PluginConfig | null {
  const workspaceId = process.env.OPENCODE_GO_WORKSPACE_ID;
  const authCookie = process.env.OPENCODE_GO_AUTH_COOKIE;
  if (!workspaceId || !authCookie) return null;
  return { workspaceId, authCookie, refreshIntervalMs: 5 * 60 * 1000 };
}

async function getCurrentUsage(ctx: PluginInput, config: PluginConfig): Promise<GoUsage | null> {
  const result = await fetchUsage(ctx, config);
  if (!result.success || !result.data) {
    await logMessage(ctx, 'error', `Failed to fetch usage: ${result.error ?? 'Unknown error'}`);
    return null;
  }
  return result.data;
}

async function checkAndNotify(ctx: PluginInput, usage: GoUsage): Promise<void> {
  const alerts = checkThresholds(ctx, usage);
  for (const alert of alerts) {
    await showNotification(ctx, alert.level, alert.message);
  }
}

async function runMonitoringCycle(ctx: PluginInput, config: PluginConfig): Promise<void> {
  const usage = await getCurrentUsage(ctx, config);
  if (!usage) return;
  await checkAndNotify(ctx, usage);
}

export const OpencodeGoMonitorPlugin: Plugin = async (ctx) => {
  const config = loadConfig();

  if (!config) {
    return {
      event: async ({ event }) => {
        if (event.type === 'session.idle') {
          try {
            await ctx.client.app.log({
              body: { service: 'opencode-go-monitor', level: 'warn',
                message: 'Plugin is not configured. Set OPENCODE_GO_WORKSPACE_ID and OPENCODE_GO_AUTH_COOKIE.' },
            });
          } catch { /* silent */ }
        }
      },
    };
  }

  const cfg: PluginConfig = config;

  void runMonitoringCycle(ctx, cfg);
  setInterval(() => { void runMonitoringCycle(ctx, cfg); }, cfg.refreshIntervalMs);

  const quote = (p: number) => {
    const lleno = Math.round(p / 10);
    const vacio = 10 - lleno;
    const barra = '█'.repeat(lleno) + '░'.repeat(vacio);
    const emoji = p >= 90 ? '🔴' : p >= 70 ? '🟡' : '🟢';
    return `${emoji} ${barra} ${p}%`;
  };

  return {
    config: async (cfg) => {
      cfg.command = cfg.command ?? {};
      cfg.command['go-quota'] = {
        template: 'consumo',
        model: 'opencode/big-pickle',
        description: 'Consumo del plan Go',
      };
      cfg.command['go-limits'] = {
        template: 'limites',
        model: 'opencode/big-pickle',
        description: 'Límites del plan Go',
      };
      cfg.command['go-refresh'] = {
        template: 'actualizar',
        model: 'opencode/big-pickle',
        description: 'Actualizar consumo del plan Go',
      };
      cfg.command['go-models'] = {
        template: 'modelos',
        model: 'opencode/big-pickle',
        description: 'Listar modelos disponibles del plan Go',
      };
      await logMessage(ctx, 'info', 'Go Monitor loaded. /go-quota /go-limits /go-refresh /go-models');
    },

    tool: {
      'go-quota': tool({
        description: 'Show current Go plan usage',
        args: {},
        async execute() {
          let u = await getCurrentUsage(ctx, cfg);
          if (!u) u = getTestUsage();
          const { currentPeriod, weekly, monthly } = u;
          return `${quote(currentPeriod.percentage)}  5h  $${currentPeriod.used.toFixed(2)} / $${currentPeriod.limit}  ·  ${currentPeriod.remainingTime}\n${quote(weekly.percentage)}  Sem $${weekly.used.toFixed(2)} / $${weekly.limit}  ·  $${(weekly.limit - weekly.used).toFixed(2)} libres\n${quote(monthly.percentage)}  Mes $${monthly.used.toFixed(2)} / $${monthly.limit}  ·  $${(monthly.limit - monthly.used).toFixed(2)} libres`;
        },
      }),

      'go-limits': tool({
        description: 'Show Go plan limits',
        args: {},
        async execute() {
          return `⚡ 5h $12  ·  📆 Sem $30  ·  🗓️ Mes $60\n🤖 MiniMax M2.5 · Kimi K2.5 · GLM-5\n💡 Al pasarte: créditos Zen`;
        },
      }),

      'go-refresh': tool({
        description: 'Force refresh Go plan data',
        args: {},
        async execute() {
          let u = await getCurrentUsage(ctx, cfg);
          if (!u) return '❌ No se pudieron actualizar los datos';
          const { currentPeriod, weekly, monthly } = u;
          return `${quote(currentPeriod.percentage)}  5h  $${currentPeriod.used.toFixed(2)} / $${currentPeriod.limit}  ·  ${currentPeriod.remainingTime}\n${quote(weekly.percentage)}  Sem $${weekly.used.toFixed(2)} / $${weekly.limit}  ·  $${(weekly.limit - weekly.used).toFixed(2)} libres\n${quote(monthly.percentage)}  Mes $${monthly.used.toFixed(2)} / $${monthly.limit}  ·  $${(monthly.limit - monthly.used).toFixed(2)} libres`;
        },
      }),

      'go-models': tool({
        description: 'List available Go plan models',
        args: {},
        async execute() {
          return await fetchModels(ctx, cfg);
        },
      }),
    },
  };
};