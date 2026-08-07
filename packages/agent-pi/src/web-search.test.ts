import { describe, expect, it } from 'vitest';

import { createWebSearchTool, parseDuckDuckGoResults } from './web-search.js';

function toolText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.text ?? '';
}

const SAMPLE_HTML = `
<div class="result results_links results_links_deep web-result">
  <div class="result__body">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs&amp;rut=abc">Example Docs</a>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">The <b>official</b> example documentation &amp; guides.</a>
  </div>
</div>
<div class="result results_links results_links_deep web-result">
  <div class="result__body">
    <a rel="nofollow" class="result__a" href="https://example.org/">Example Org</a>
    <a class="result__snippet" href="https://example.org/">Another result without redirect.</a>
  </div>
</div>
`;

describe('parseDuckDuckGoResults', () => {
  it('parses title, decoded URL (with uddg unwrap) and snippet', () => {
    const results = parseDuckDuckGoResults(SAMPLE_HTML);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: 'Example Docs',
      url: 'https://example.com/docs',
      snippet: 'The official example documentation & guides.',
    });
    expect(results[1]?.url).toBe('https://example.org/');
  });
});

describe('createWebSearchTool', () => {
  it('returns parsed results from a stub fetch', async () => {
    const tool = createWebSearchTool({ fetchImpl: (async () => new Response(SAMPLE_HTML)) as typeof fetch });
    const result = await tool.execute(
      'call-1',
      { query: 'example' },
      undefined,
      undefined,
      {} as never,
    );
    expect(result.details?.results).toHaveLength(2);
    expect(toolText(result)).toContain('Example Docs');
  });

  it('handles non-200 responses', async () => {
    const tool = createWebSearchTool({
      fetchImpl: (async () => new Response('nope', { status: 500 })) as typeof fetch,
    });
    const result = await tool.execute('call-1', { query: 'x' }, undefined, undefined, {} as never);
    expect(toolText(result)).toContain('HTTP 500');
  });

  it('returns empty for no results', async () => {
    const tool = createWebSearchTool({ fetchImpl: (async () => new Response('<html>nothing</html>')) as typeof fetch });
    const result = await tool.execute('call-1', { query: 'x' }, undefined, undefined, {} as never);
    expect(result.details?.results).toEqual([]);
    expect(toolText(result)).toContain('No results');
  });

  it('aborts on signal and reports cancellation', async () => {
    const controller = new AbortController();
    const tool = createWebSearchTool({
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
        return new Response('');
      }) as typeof fetch,
    });
    const promise = tool.execute(
      'call-1',
      { query: 'x' },
      controller.signal,
      undefined,
      {} as never,
    );
    setTimeout(() => controller.abort(), 20);
    const result = await promise;
    expect(toolText(result)).toContain('Search cancelled');
  });
});
