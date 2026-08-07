// Minimal MCP stdio server used by mcp-bridge.test.ts. Exposes two tools:
// `echo` (returns its argument) and `add` (returns a + b). Run via node.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'fixture-server', version: '1.0.0' });

server.registerTool('echo', { description: 'Echo the text argument', inputSchema: { text: z.string() } }, async ({ text }) => ({
  content: [{ type: 'text', text: `echo:${text}` }],
}));

server.registerTool('add', { description: 'Add two numbers', inputSchema: { a: z.number(), b: z.number() } }, async ({ a, b }) => ({
  content: [{ type: 'text', text: String(a + b) }],
}));

const transport = new StdioServerTransport();
await server.connect(transport);
