import {TalentEngine, TalentResult, ToolDefinition} from './types';
import {
  isLocalDocSearchAvailable,
  searchDocuments,
} from '../../utils/localDocsStore';

export class LocalDocsEngine implements TalentEngine {
  readonly name = 'search_documents';
  readonly recommendedContextTokens = 1024;

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) {
      const msg = 'search_documents: missing required "query" argument';
      return {type: 'error', summary: msg, errorMessage: msg};
    }

    if (!isLocalDocSearchAvailable()) {
      const msg =
        'search_documents is not available. It requires a locally-loaded model (not available in remote/server mode).';
      return {type: 'error', summary: msg, errorMessage: msg};
    }

    try {
      const results = await searchDocuments(query, 4);

      if (results.length === 0) {
        return {
          type: 'text',
          summary:
            'No indexed documents found (or none are relevant to this query). The user can add documents in Settings.',
        };
      }

      const summary = results
        .map((r, i) => {
          const snippet = r.text.slice(0, 400);
          return `${i + 1}. [${r.docTitle}] (relevance: ${r.score.toFixed(
            2,
          )})\n${snippet}`;
        })
        .join('\n\n');

      return {type: 'text', summary};
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      const msg = `search_documents: ${errMsg}`;
      return {type: 'error', summary: msg, errorMessage: errMsg};
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'search_documents',
        description:
          "Search the user's own indexed documents/notes (added by them in Settings) for relevant information. Use this when the user asks about their own files, notes, or previously-added documents — NOT for general web knowledge.",
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
