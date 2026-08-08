import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';

/*
 * #18 — web search (self-built, single provider).
 *
 * One search backend today: DuckDuckGo's HTML endpoint (no API key needed,
 * no cloud dependency to start). The tool is classified
 * `external-side-effect` by the permission pipeline — a network fetch — so it
 * requires approval in Ask mode, is blocked in Plan Mode, and can never be
 * remembered as allow-session/project (see policy-engine: external-side-effect
 * never remembers).
 *
 * The result shape is a small list of { title, url, snippet } so the model
 * gets enough to pick a source without downloading pages.
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchOptions {
  /** Override the fetch impl (tests). */
  fetchImpl?: typeof fetch;
}

const SEARCH_TIMEOUT_MS = 15_000;

const searchSchema = Type.Object({
  query: Type.String({ description: 'Search query' }),
  /** Max results. Default 5. */
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
});
type SearchParams = Static<typeof searchSchema>;

function extractBetween(html: string, start: string, end: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const a = html.indexOf(start, from);
    if (a === -1) break;
    const b = html.indexOf(end, a + start.length);
    if (b === -1) break;
    out.push(html.slice(a + start.length, b));
    from = b + end.length;
  }
  return out;
}

/** Split on the result-block div marker; excludes `result__*` via lookahead. */
function resultBlocks(html: string): string[] {
  const marker = 'class="result(?!_)';
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const a = html.slice(from).search(new RegExp(marker));
    if (a === -1) break;
    const absA = from + a;
    const b = html.slice(absA + 12).search(new RegExp(marker));
    out.push(b === -1 ? html.slice(absA) : html.slice(absA, absA + 12 + b));
    from = absA + 12;
  }
  return out;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Parse DuckDuckGo's HTML results page. The classic endpoint
 * `https://html.duckduckgo.com/html/?q=…` returns a `<div class="result">`
 * per hit with `result__a` (title/link) and `result__snippet` (abstract).
 * Exported for tests.
 */
export function parseDuckDuckGoResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  for (const block of resultBlocks(html)) {
    const link = extractBetween(block, 'class="result__a" href="', '"')[0];
    const titleRaw = extractBetween(block, 'class="result__a"', '</a>')[0];
    const snippetRaw = extractBetween(block, 'class="result__snippet"', '</a>')[0];
    if (!link || !titleRaw) continue;
    // Title is everything after the anchor's `>` up to `</a>`.
    const title = decodeEntities(titleRaw.slice(titleRaw.indexOf('>') + 1)).trim();
    // DDG redirect wrapper: `//duckduckgo.com/l/?uddg=<encoded-target>&rut=…`
    const uddg = /[?&]uddg=([^&]+)/.exec(link);
    const finalUrl = uddg ? decodeURIComponent(uddg[1] ?? '') : decodeEntities(link);
    results.push({
      title,
      url: finalUrl,
      snippet: snippetRaw
        ? decodeEntities(snippetRaw.slice(snippetRaw.indexOf('>') + 1))
            .replace(/<[^>]+>/g, '')
            .trim()
        : '',
    });
  }
  return results;
}

export function createWebSearchTool(options: SearchOptions = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  return defineTool({
    name: 'web_search',
    label: 'Web search',
    description:
      'Search the web and return the top results (title, URL, snippet). Network access — requires approval in Ask mode and is blocked in Plan Mode. Use to look up docs, verify an API, find a library version, or check current information.',
    promptSnippet: 'web_search — search the web (approval-gated)',
    promptGuidelines: [
      'Use web_search when the answer depends on current or external information (docs, releases, issues, APIs).',
      'Prefer official documentation in the results; cite the URL you use.',
    ],
    parameters: searchSchema,
    executionMode: 'sequential',
    async execute(
      _toolCallId: string,
      params: SearchParams,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<{ results: SearchResult[] }>> {
      const query = params.query.trim();
      if (!query) {
        return {
          content: [{ type: 'text', text: 'Search query must not be empty.' }],
          details: { results: [] },
        };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const response = await fetchImpl(url, {
          headers: { 'user-agent': 'PiX-desktop/0.3 web_search' },
          signal: controller.signal,
        });
        if (!response.ok) {
          return {
            content: [{ type: 'text', text: `Search failed: HTTP ${response.status}` }],
            details: { results: [] },
          };
        }
        const html = await response.text();
        const results = parseDuckDuckGoResults(html).slice(0, params.limit ?? 5);
        if (!results.length) {
          return {
            content: [{ type: 'text', text: 'No results found.' }],
            details: { results: [] },
          };
        }
        const text = results
          .map(
            (result, index) =>
              `${index + 1}. ${result.title}\n   ${result.url}\n   ${result.snippet}`,
          )
          .join('\n');
        return {
          content: [{ type: 'text', text }],
          details: { results },
        };
      } catch (error) {
        const aborted = signal?.aborted || controller.signal.aborted;
        if (aborted) {
          return {
            content: [{ type: 'text', text: 'Search cancelled.' }],
            details: { results: [] },
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          details: { results: [] },
        };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    },
  });
}
