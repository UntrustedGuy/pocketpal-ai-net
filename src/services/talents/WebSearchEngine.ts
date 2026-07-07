import {TalentEngine, TalentResult, ToolDefinition} from './types';
import {getSearchEndpoint} from './webSearchConfig';

interface SearxResult {
  title?: string;
  url?: string;
  content?: string;
}

export class WebSearchEngine implements TalentEngine {
  readonly name = 'web_search';
  readonly recommendedContextTokens = 1024;

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) {
      const msg = 'web_search: missing required "query" argument';
      return {type: 'error', summary: msg, errorMessage: msg};
    }

    const endpoint = await getSearchEndpoint();
    if (!endpoint) {
      const msg =
        'web_search is not configured. The user must set a SearXNG instance URL in Settings before this tool can be used.';
      return {type: 'error', summary: msg, errorMessage: msg};
    }

    try {
      const url = `${endpoint.replace(/\/$/, '')}/search?q=${encodeURIComponent(
        query,
      )}&format=json`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(url, {signal: controller.signal});
      clearTimeout(timeout);

      if (!res.ok) {
        const msg = `web_search: instance returned HTTP ${res.status}`;
        return {type: 'error', summary: msg, errorMessage: msg};
      }

      const data = await res.json();
      const results: SearxResult[] = Array.isArray(data?.results)
        ? data.results.slice(0, 5)
        : [];

      if (results.length === 0) {
        return {type: 'text', summary: `No results found for "${query}".`};
      }

      const summary = results
        .map((r, i) => {
          const title = r.title ?? '(untitled)';
          const snippet = (r.content ?? '').slice(0, 300);
          return `${i + 1}. ${title}\n${r.url ?? ''}\n${snippet}`;
        })
        .join('\n\n');

      return {type: 'text', summary};
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      const isAbort = errMsg.toLowerCase().includes('abort');
      const msg = isAbort
        ? 'web_search: request timed out. The SearXNG instance may be unreachable.'
        : `web_search: ${errMsg}`;
      return {type: 'error', summary: msg, errorMessage: errMsg};
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'web_search',
        description:
          'Search the internet for current information. Use this when the user asks about recent events, current facts, or anything that may have changed since training.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query.',
            },
          },
          required: ['query'],
        },
      },
    };
  }
}
