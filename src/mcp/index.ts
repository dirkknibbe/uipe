import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('UI Perception Engine MCP server running on stdio');
}

main().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
