import AsyncStorage from '@react-native-async-storage/async-storage';

import {modelStore} from '../store/ModelStore';

/**
 * Minimal on-device RAG store: paste in a document's text, it gets chunked
 * and embedded via the currently-loaded local model, and later chat turns
 * can search across all indexed chunks by cosine similarity.
 *
 * Scope note: this is intentionally simple for a personal-use corpus (a
 * handful of documents, a few hundred chunks) — everything lives in one
 * AsyncStorage JSON blob and search is a linear scan. That's more than
 * fast enough at this scale on-device; it is NOT designed to scale to a
 * large document corpus, which would need a real vector index instead.
 */

const STORAGE_KEY = 'localDocsIndex';
const CHUNK_SIZE_CHARS = 800;
const CHUNK_OVERLAP_CHARS = 150;

export interface DocChunk {
  id: string;
  docTitle: string;
  chunkIndex: number;
  text: string;
  embedding: number[];
}

interface DocsIndex {
  chunks: DocChunk[];
}

async function loadIndex(): Promise<DocsIndex> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {chunks: []};
    }
    return JSON.parse(raw) as DocsIndex;
  } catch (e) {
    console.warn('[localDocsStore] Failed to load index, resetting:', e);
    return {chunks: []};
  }
}

async function saveIndex(index: DocsIndex): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(index));
}

/**
 * Simple fixed-size sliding-window chunker with overlap, splitting on
 * whitespace boundaries so words aren't cut mid-token. Good enough for
 * plain-text notes/articles; not aware of markdown/code structure.
 */
function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized.length <= CHUNK_SIZE_CHARS) {
    return normalized.length > 0 ? [normalized] : [];
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + CHUNK_SIZE_CHARS, normalized.length);
    // Extend to the next whitespace so we don't cut a word in half,
    // unless we're already at the end of the text.
    if (end < normalized.length) {
      const nextSpace = normalized.indexOf(' ', end);
      if (nextSpace !== -1 && nextSpace - end < 100) {
        end = nextSpace;
      }
    }
    chunks.push(normalized.slice(start, end).trim());
    if (end >= normalized.length) {
      break;
    }
    start = end - CHUNK_OVERLAP_CHARS;
    if (start < 0) {
      start = 0;
    }
  }
  return chunks.filter(c => c.length > 0);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Whether local document search can currently run at all. */
export function isLocalDocSearchAvailable(): boolean {
  return !!modelStore.context;
}

/**
 * Chunks and embeds a pasted document's text, storing it under `title`.
 * Re-adding the same title replaces its previous chunks. Requires a
 * locally-loaded model (embedding runs through it); throws a plain Error
 * with a user-facing message on failure so calling UI can surface it.
 */
export async function addDocument(
  title: string,
  fullText: string,
): Promise<{chunksAdded: number}> {
  const context = modelStore.context;
  if (!context) {
    throw new Error(
      'No local model is currently loaded. Load a model before adding documents.',
    );
  }
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    throw new Error('Document title cannot be empty.');
  }
  const pieces = chunkText(fullText);
  if (pieces.length === 0) {
    throw new Error('Document text is empty.');
  }

  const newChunks: DocChunk[] = [];
  for (let i = 0; i < pieces.length; i++) {
    try {
      const result = await context.embedding(pieces[i]);
      newChunks.push({
        id: `${trimmedTitle}__${i}__${Date.now()}`,
        docTitle: trimmedTitle,
        chunkIndex: i,
        text: pieces[i],
        embedding: result.embedding,
      });
    } catch (e) {
      throw new Error(
        `Failed to embed chunk ${i + 1}/${pieces.length}. The loaded model may not support embeddings. (${
          e instanceof Error ? e.message : String(e)
        })`,
      );
    }
  }

  const index = await loadIndex();
  // Replace any existing chunks for this title (re-indexing).
  const filtered = index.chunks.filter(c => c.docTitle !== trimmedTitle);
  await saveIndex({chunks: [...filtered, ...newChunks]});

  return {chunksAdded: newChunks.length};
}

export interface IndexedDocSummary {
  title: string;
  chunkCount: number;
}

export async function listDocuments(): Promise<IndexedDocSummary[]> {
  const index = await loadIndex();
  const byTitle = new Map<string, number>();
  for (const chunk of index.chunks) {
    byTitle.set(chunk.docTitle, (byTitle.get(chunk.docTitle) ?? 0) + 1);
  }
  return Array.from(byTitle.entries()).map(([title, chunkCount]) => ({
    title,
    chunkCount,
  }));
}

export async function deleteDocument(title: string): Promise<void> {
  const index = await loadIndex();
  const filtered = index.chunks.filter(c => c.docTitle !== title);
  await saveIndex({chunks: filtered});
}

export interface DocSearchResult {
  docTitle: string;
  text: string;
  score: number;
}

/**
 * Embeds the query and ranks all stored chunks by cosine similarity.
 * Returns an empty array (never throws) if no model is loaded, nothing is
 * indexed, or embedding the query fails — callers should treat an empty
 * result as "no relevant documents found", not an error.
 */
export async function searchDocuments(
  query: string,
  topK: number = 4,
): Promise<DocSearchResult[]> {
  const context = modelStore.context;
  if (!context) {
    return [];
  }
  const index = await loadIndex();
  if (index.chunks.length === 0) {
    return [];
  }

  let queryEmbedding: number[];
  try {
    const result = await context.embedding(query);
    queryEmbedding = result.embedding;
  } catch (e) {
    console.warn('[localDocsStore] Failed to embed query:', e);
    return [];
  }

  const scored = index.chunks.map(chunk => ({
    docTitle: chunk.docTitle,
    text: chunk.text,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
