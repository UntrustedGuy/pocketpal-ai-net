import {TalentEngine, TalentResult, ToolDefinition} from './types';
import {getSearchProvider, getSearchEndpoint, getTavilyApiKey} from './webSearchConfig';

interface SearxResult {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilyResult {
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

    const provider = await getSearchProvider();
    return provider === 'tavily'
      ? this.executeTavily(query)
      : this.executeSearxng(query);
  }

  private async executeSearxng(query: string): Promise<TalentResult> {
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
        const msg = `web_search: SearXNG instance returned HTTP ${res.status}`;
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
      return this.handleFetchError(e, 'SearXNG instance may be unreachable');
    }
  }

  private async executeTavily(query: string): Promise<TalentResult> {
    const apiKey = await getTavilyApiKey();
    if (!apiKey) {
      const msg =
        'web_search is not configured. The user must set a Tavily API key in Settings before this tool can be used.';
      return {type: 'error', summary: msg, errorMessage: msg};
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          api_key: apiKey,
          query,
          max_results: 5,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const msg =
          res.status === 401 || res.status === 403
            ? 'web_search: Tavily rejected the API key (check it in Settings)'
            : `web_search: Tavily returned HTTP ${res.status}`;
        return {type: 'error', summary: msg, errorMessage: msg};
      }

      const data = await res.json();
      const results: TavilyResult[] = Array.isArray(data?.results)
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
      return this.handleFetchError(e, 'Tavily may be unreachable');
    }
  }

  private handleFetchError(e: unknown, hint: string): TalentResult {
    const errMsg = e instanceof Error ? e.message : String(e);
    const isAbort = errMsg.toLowerCase().includes('abort');
    const msg = isAbort
      ? `web_search: request timed out. ${hint}.`
      : `web_search: ${errMsg}`;
    return {type: 'error', summary: msg, errorMessage: errMsg};
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
