import { z } from 'zod';

// Bounds for the attacker-influenced `act` tool args (mcp-3). Without them a
// prompt-injected agent could call act{wait, ms: 2147483647} and park the only
// MCP thread for ~24 days, or pass NaN/Infinity coords into Playwright.
const MAX_WAIT_MS = 30_000;
const MAX_COORD = 100_000; // generous vs any real viewport
const MAX_SCROLL = 1_000_000;

export const actInputSchema = z.object({
  type: z.enum(['click', 'clickSelector', 'type', 'scroll', 'hover', 'wait', 'navigate', 'back', 'pressKey', 'setViewport'])
    .describe('Action type to execute'),
  // min/max bounds also reject NaN/Infinity (both fail the comparison), so no .finite() needed.
  x: z.number().min(-MAX_COORD).max(MAX_COORD).optional().describe('X coordinate (for click, hover)'),
  y: z.number().min(-MAX_COORD).max(MAX_COORD).optional().describe('Y coordinate (for click, hover)'),
  selector: z.string().max(2000).optional().describe('CSS selector (for clickSelector, type)'),
  text: z.string().max(10_000).optional().describe('Text to type (for type action)'),
  direction: z.enum(['up', 'down']).optional().describe('Scroll direction (for scroll)'),
  amount: z.number().min(-MAX_SCROLL).max(MAX_SCROLL).optional().describe('Scroll amount in pixels (for scroll)'),
  ms: z.number().min(0).max(MAX_WAIT_MS).optional().describe('Wait duration in milliseconds (for wait)'),
  url: z.string().max(4096).optional().describe('URL to navigate to (for navigate)'),
  key: z.string().max(64).optional().describe('Key to press (for pressKey, e.g. "Enter", "Escape")'),
  width: z.number().min(1).max(20_000).optional().describe('Viewport width in pixels (for setViewport)'),
  height: z.number().min(1).max(20_000).optional().describe('Viewport height in pixels (for setViewport)'),
  visible: z.boolean().optional().describe('Filter to visible elements only (default true, for clickSelector)'),
});
