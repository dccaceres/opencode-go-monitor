import type { Plugin, PluginInput } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import type { Part } from '@opencode-ai/sdk';
import type { GoUsage, PluginConfig } from './types';
import { fetchModels } from './models';
import { fetchUsage, getTestUsage } from './monitor';
import { checkThresholds, showNotification } from './notifier';
import { logMessage } from './commands';

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

  const formatUsage = (u: GoUsage) => {
    const { currentPeriod, weekly, monthly } = u;
    return `${quote(currentPeriod.percentage)}  5h  $${currentPeriod.used.toFixed(2)} / $${currentPeriod.limit}  ·  ${currentPeriod.remainingTime}\n${quote(weekly.percentage)}  Sem $${weekly.used.toFixed(2)} / $${weekly.limit}  ·  $${(weekly.limit - weekly.used).toFixed(2)} libres\n${quote(monthly.percentage)}  Mes $${monthly.used.toFixed(2)} / $${monthly.limit}  ·  $${(monthly.limit - monthly.used).toFixed(2)} libres`;
  };

  return {
    config: async (cfg) => {
      cfg.command = cfg.command ?? {};
      cfg.command['go-quota'] = {
        template: 'Estos son el consumo actual de tu plan Opencode Go.',
        description: 'Consumo del plan Go',
      };
      cfg.command['go-limits'] = {
        template: 'Estos son los limites actuales del Plan de Opencode Go.',
        description: 'Límites del plan Go',
      };
      cfg.command['go-refresh'] = {
        template: 'Se ha actualizado el estado de consumo de tu plan de Opencode Go.',
        description: 'Actualizar consumo del plan Go',
      };
      cfg.command['go-models'] = {
        template: 'Estos son los modelos actuales del plan Opencode Go.',
        description: 'Listar modelos disponibles del plan Go',
      };
      await logMessage(ctx, 'info', 'Go Monitor loaded. /go-quota /go-limits /go-refresh /go-models');
    },

    tool: {
      'go-quota': tool({
        description: 'Show current Go plan usage',
        args: {},
        async execute() {
          const u = await getCurrentUsage(ctx, cfg);
          return formatUsage(u ?? getTestUsage());
        },
      }),

      'go-limits': tool({
        description: 'Show Go plan limits',
        args: {},
        async execute() {
          return `⚡ 5h $12  ·  📆 Sem $30  ·  🗓️ Mes $60\n💡 Al pasarte: créditos Zen\n📌 Modelos disponibles: usá /go-models`;
        },
      }),

      'go-refresh': tool({
        description: 'Force refresh Go plan data',
        args: {},
        async execute() {
          const u = await getCurrentUsage(ctx, cfg);
          if (!u) return '❌ No se pudieron actualizar los datos';
          return formatUsage(u);
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

    'command.execute.before': async (
      input: { command: string; sessionID: string; arguments: string },
      output: { parts: Part[] },
    ) => {
      let text: string;

      switch (input.command) {
        case 'go-quota': {
          const u = await getCurrentUsage(ctx, cfg);
          text = formatUsage(u ?? getTestUsage());
          break;
        }
        case 'go-refresh': {
          const u = await getCurrentUsage(ctx, cfg);
          text = u ? formatUsage(u) : '❌ No se pudieron actualizar los datos';
          break;
        }
        case 'go-limits':
          text = '⚡ 5h $12  ·  📆 Sem $30  ·  🗓️ Mes $60\n💡 Al pasarte: créditos Zen\n📌 Modelos disponibles: usá /go-models';
          break;
        case 'go-models':
          text = await fetchModels(ctx, cfg);
          break;
        default:
          return;
      }

      output.parts.push({
        id: crypto.randomUUID(),
        sessionID: input.sessionID,
        messageID: crypto.randomUUID(),
        type: 'text',
        text,
      });
    },
  };
};