import type { Config } from '@opencode-ai/sdk'
import { spawn } from 'bun'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const scriptDir = dirname(import.meta.path)

console.log('Starting OpenCode with plugin loaded from source...')
console.log('')

const pluginPath = pathToFileURL(scriptDir).href
console.log(`Plugin path: ${pluginPath}`)

const config = { plugin: [pluginPath] } satisfies Config

const OPENCODE_CONFIG_CONTENT = JSON.stringify(config)

console.log(`OPENCODE_CONFIG_CONTENT='${OPENCODE_CONFIG_CONTENT}' opencode`)

const proc = spawn(['opencode'], {
	env: {
		...process.env,
		OPENCODE_CONFIG_CONTENT,
	},
	stdin: 'inherit',
	stdout: 'inherit',
	stderr: 'inherit',
})

await proc.exited
