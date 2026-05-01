import type { PluginInput } from '@opencode-ai/plugin';
import type { PluginConfig } from './types';

export async function fetchModels(ctx: PluginInput, config: PluginConfig): Promise<string> {
  const cookieHeader = config.authCookie.startsWith('auth=')
    ? config.authCookie
    : `auth=${config.authCookie}`;

  try {
    const res = await fetch('https://opencode.ai/zen/go/v1/models', {
      headers: { Cookie: cookieHeader },
    });

    if (!res.ok) return '❌ No se pudieron obtener los modelos.';

    const data = await res.json() as { data: Array<{ id: string }> };

    if (!data.data || data.data.length === 0) return 'No hay modelos disponibles.';

    const modelos = data.data.map(m => m.id);
    const maxLen = Math.max(...modelos.map(m => m.length));

    const lineas: string[] = [
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '      🤖  Modelos del plan Go',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '',
    ];

    for (const m of modelos) {
      lineas.push(`  ${m.padEnd(maxLen + 2)} 🟢`);
    }

    lineas.push('');
    lineas.push(`  Total: ${modelos.length} modelos`);
    lineas.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lineas.push('');

    return lineas.join('\n');
  } catch {
    return '❌ Error al consultar modelos.';
  }
}
