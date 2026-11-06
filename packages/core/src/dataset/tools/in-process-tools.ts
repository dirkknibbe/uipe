import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface ToolResult { text: string; isError: boolean; image?: { data: string; mimeType: string } }

export class InProcessTools {
  private constructor(private readonly client: Client) {}

  static async connect(server: McpServer): Promise<InProcessTools> {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'uipe-dataset-explorer', version: '0.1.0' });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    return new InProcessTools(client);
  }

  async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const res = await this.client.callTool({ name, arguments: args });
    const content = (res.content ?? []) as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    const text = content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
    const img = content.find((c) => c.type === 'image');
    return {
      text,
      isError: res.isError === true,
      ...(img?.data && img.mimeType ? { image: { data: img.data, mimeType: img.mimeType } } : {}),
    };
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
