import type { PluginInput } from '@opencode-ai/plugin';

export async function logMessage(
  ctx: PluginInput,
  level: 'info' | 'warn' | 'error',
  message: string
): Promise<void> {
  try {
    await ctx.client.app.log({
      body: { service: 'opencode-go-monitor', level, message },
    });
  } catch {
    console.log(`[opencode-go-monitor] ${message}`);
  }
}