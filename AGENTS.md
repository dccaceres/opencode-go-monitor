# OpenCode Plugin Development

This is an OpenCode plugin. OpenCode is an AI-powered coding assistant that runs in the terminal.

## Documentation

- [Plugin Documentation](https://opencode.ai/docs/plugins/)
- [SDK Reference](https://opencode.ai/docs/sdk/)
- [Community Plugins](https://opencode.ai/docs/ecosystem/#plugins)

## Project Structure

```
src/
  index.ts    # Plugin entry point - exports the plugin function
dev.ts        # Development script - runs OpenCode with this plugin loaded
```

## Plugin Architecture

A plugin is a function that receives a context object and returns hooks:

```typescript
import type { Plugin, PluginInput } from '@opencode-ai/plugin'

export const MyPlugin: Plugin = async (ctx: PluginInput) => {
  // ctx provides:
  // - client: OpenCode SDK client for API calls
  // - project: Current project information
  // - directory: Current working directory
  // - worktree: Git worktree path
  // - serverUrl: OpenCode server URL
  // - $: Bun shell for executing commands

  return {
    // Return hooks here
  }
}
```

## Available Hooks

### Event Hooks

- `event` - Subscribe to OpenCode events (session.idle, file.edited, etc.)
- `config` - Called when config is loaded

### Chat Hooks

- `chat.message` - Intercept user messages before processing
- `chat.params` - Modify LLM parameters (temperature, topP, topK)
- `chat.headers` - Add custom headers to LLM requests
- `experimental.chat.messages.transform` - Transform messages before sending to AI
- `experimental.chat.system.transform` - Transform system prompt

### Tool Hooks

- `tool.execute.before` - Modify tool arguments or block execution
- `tool.execute.after` - Process tool results

### Other Hooks

- `command.execute.before` - Intercept slash commands
- `permission.ask` - Auto-allow/deny permissions
- `shell.env` - Inject environment variables
- `experimental.session.compacting` - Customize session compaction
- `experimental.text.complete` - Called when text completion is done

### Custom Tools

Plugins can register custom tools using the `tool` helper:

```typescript
import { tool } from '@opencode-ai/plugin'

return {
  tool: {
    mytool: tool({
      description: 'What this tool does',
      args: {
        input: tool.schema.string(),
      },
      async execute(args, context) {
        return `Result: ${args.input}`
      },
    }),
  },
}
```

## Development Workflow

1. Edit `src/index.ts` to implement your plugin logic
2. Run `bun dev` to start OpenCode with your plugin loaded
3. Test your plugin by interacting with OpenCode
4. Run `bun typecheck` to verify types

## Logging

Use structured logging instead of console.log:

```typescript
await ctx.client.app.log({
  body: {
    service: 'my-plugin',
    level: 'info', // 'debug' | 'info' | 'warn' | 'error'
    message: 'Something happened',
    extra: { key: 'value' },
  },
})
```

## Publishing

1. Update `package.json` with your plugin name, description, and repository
2. Run `npm publish`
3. Users install by adding to their `opencode.json`:

```json
{
  "plugin": ["your-plugin-name@latest"]
}
```

## Common Patterns

### Blocking Tool Execution

```typescript
'tool.execute.before': async (input, output) => {
  if (input.tool === 'read' && output.args.filePath.includes('.env')) {
    throw new Error('Cannot read .env files')
  }
}
```

### Auto-Approve Permissions

```typescript
'permission.ask': async (input, output) => {
  if (input.tool === 'read') {
    output.status = 'allow'
  }
}
```

### Send Notifications on Session Complete

```typescript
event: async ({ event }) => {
  if (event.type === 'session.idle') {
    await ctx.$`osascript -e 'display notification "Done!" with title "OpenCode"'`
  }
}
```

### Inject Environment Variables

```typescript
'shell.env': async (input, output) => {
  output.env.MY_API_KEY = process.env.MY_API_KEY || ''
}
```

### Modify LLM Temperature

```typescript
'chat.params': async (input, output) => {
  output.temperature = 0.7
}
```
