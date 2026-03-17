#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { Config } from '../config.js';

async function main(): Promise<void> {
  const server = createServer({
    visual: {
      provider: 'auto',
      omniparser: { endpoint: Config.vision.omniparserUrl },
      claude: { apiKey: Config.vision.anthropicApiKey },
      ollama: { baseUrl: Config.vision.ollamaUrl, model: Config.vision.ollamaModel },
    },
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('UI Perception Engine MCP server running on stdio');
}

main().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
