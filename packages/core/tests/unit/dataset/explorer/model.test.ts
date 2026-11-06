import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicExplorerModel, EXPLORER_SYSTEM_PROMPT, costUsd } from '../../../../src/dataset/explorer/model.js';

vi.mock('@anthropic-ai/sdk');

const mockCreate = vi.fn();
const turn = {
  observation: '<untrusted_page_content>\nbutton "Menu"\n</untrusted_page_content>',
  history: [{ call: { tool: 'get_scene' as const, args: {}, rationale: 'look' }, resultSummary: 'ok' }],
  visitedStates: 2,
  budget: { steps: 3, usd: 0.1 },
};

beforeEach(() => {
  vi.mocked(Anthropic).mockImplementation(() => ({ messages: { create: mockCreate } }) as unknown as Anthropic);
  mockCreate.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('AnthropicExplorerModel', () => {
  it('anthropic_model_maps_tool_use_block_to_explorer_call', async () => {
    mockCreate.mockResolvedValue({
      content: [
        { type: 'text', text: 'thinking out loud' },
        { type: 'tool_use', id: 't1', name: 'act', input: { type: 'hover', x: 5, y: 6, target: 'Menu', rationale: 'menus animate' } },
      ],
      usage: { input_tokens: 1200, output_tokens: 80 },
    });
    const model = new AnthropicExplorerModel({ apiKey: 'k', model: 'claude-test' });

    const out = await model.next(turn);

    expect(out).toEqual({
      call: { tool: 'act', args: { type: 'hover', x: 5, y: 6, target: 'Menu' }, rationale: 'menus animate' },
      inputTokens: 1200,
      outputTokens: 80,
    });
    const req = mockCreate.mock.calls[0][0];
    expect(req.model).toBe('claude-test');
    expect(req.system).toBe(EXPLORER_SYSTEM_PROMPT);
    expect(req.tool_choice).toEqual({ type: 'any' });
    expect(req.tools.map((t: { name: string }) => t.name).sort()).toEqual(['act', 'done', 'get_affordances', 'get_scene', 'navigate']);
    for (const t of req.tools) expect(t.input_schema.required).toContain('rationale');
    expect(JSON.stringify(req.messages)).toContain('button \\"Menu\\"');
  });

  it('defaults the model id from UIPE_EXPLORER_MODEL', async () => {
    vi.stubEnv('UIPE_EXPLORER_MODEL', 'claude-env');
    mockCreate.mockResolvedValue({ content: [{ type: 'tool_use', id: 't', name: 'done', input: { rationale: 'x' } }], usage: { input_tokens: 1, output_tokens: 1 } });
    await new AnthropicExplorerModel({ apiKey: 'k' }).next(turn);
    expect(mockCreate.mock.calls[0][0].model).toBe('claude-env');
  });

  it('throws when the response has no tool_use block', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'no' }], usage: { input_tokens: 1, output_tokens: 1 } });
    await expect(new AnthropicExplorerModel({ apiKey: 'k' }).next(turn)).rejects.toThrow(/tool_use/);
  });

  it('system prompt carries the exploration priorities and the untrusted-content rule', () => {
    expect(EXPLORER_SYSTEM_PROMPT).toMatch(/distinct UI states/);
    expect(EXPLORER_SYSTEM_PROMPT).toMatch(/<untrusted_page_content>/);
    expect(EXPLORER_SYSTEM_PROMPT).toMatch(/never .*instructions/i);
  });
});

describe('costUsd', () => {
  it('cost_usd_uses_env_prices', () => {
    expect(costUsd(1_000_000, 1_000_000)).toBeCloseTo(18);
    vi.stubEnv('UIPE_EXPLORER_PRICE_IN', '1');
    vi.stubEnv('UIPE_EXPLORER_PRICE_OUT', '2');
    expect(costUsd(500_000, 250_000)).toBeCloseTo(1);
  });
});
