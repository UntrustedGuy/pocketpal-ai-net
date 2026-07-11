import * as RNFS from '@dr.pogodin/react-native-fs';
import type {LlamaContext} from 'llama.rn';

/**
 * Loosely-typed message shape covering both the app's internal ChatMessage
 * type AND llama.rn's own RNLlamaOAICompatibleMessage wire type (which has
 * `role: string` rather than a literal union, and an optional content
 * field). This file only reads `role`/`content` for fingerprinting — it
 * never needs the stricter app-level type.
 */
interface FingerprintableMessage {
  role: string;
  content?:
    | string
    | Array<{type?: string; text?: string; image_url?: {url: string}}>;
}

/**
 * Persists and restores the native llama.cpp KV cache to/from disk, keyed
 * per conversation. This is DIFFERENT from llama.cpp's automatic in-memory
 * prompt-prefix reuse (which already happens for free within a single live
 * context as long as you keep sending a growing, unmodified prefix). What
 * this file adds is disk persistence across:
 *   - switching between two different conversations that share one loaded
 *     model/context (today this forces a full prompt reprocess of whichever
 *     conversation you switch back to), and
 *   - closing and reopening the app entirely.
 *
 * Every function here is fail-safe: on any error, or on a fingerprint
 * mismatch (edited message, different model/settings, forked conversation),
 * it silently no-ops or returns false. A cache miss just means "reprocess
 * normally" — it must never change chat output or throw.
 */

const SESSION_CACHE_DIRNAME = 'session-cache';

function getSessionCacheDir(): string {
  return `${RNFS.CachesDirectoryPath}/${SESSION_CACHE_DIRNAME}`;
}

async function ensureCacheDirExists(): Promise<void> {
  const dir = getSessionCacheDir();
  try {
    const exists = await RNFS.exists(dir);
    if (!exists) {
      await RNFS.mkdir(dir);
    }
  } catch (e) {
    console.warn('[conversationSessionCache] Failed to ensure cache dir:', e);
  }
}

function sanitizeId(conversationId: string): string {
  // Conversation ids are app-generated (randId()-style), but defensively
  // strip anything that isn't filesystem-safe before using it in a path.
  return conversationId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function sessionFilePath(conversationId: string): string {
  return `${getSessionCacheDir()}/${sanitizeId(conversationId)}.session`;
}

function sessionMetaPath(conversationId: string): string {
  return `${getSessionCacheDir()}/${sanitizeId(conversationId)}_meta.json`;
}

function extractMessageText(content: FingerprintableMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (part.type === 'text') {
          return part.text ?? '';
        }
        if (part.type === 'image_url') {
          return part.image_url?.url ?? '';
        }
        return '';
      })
      .join('|');
  }
  return '';
}

export interface SessionFingerprintSettings {
  modelId?: string;
  n_ctx?: number;
  cache_type_k?: string;
  cache_type_v?: string;
}

/**
 * A stable, order-sensitive text fingerprint of a message array plus the
 * context settings that would affect the KV cache's validity. Deliberately
 * NOT a cryptographic hash — this only needs to detect "did anything that
 * matters change", not resist tampering. Uses a simple 32-bit rolling hash
 * (djb2) so it stays dependency-free and fast even on long histories.
 */
export function computeSessionFingerprint(
  messages: FingerprintableMessage[],
  settings: SessionFingerprintSettings,
): string {
  const parts: string[] = [
    settings.modelId ?? '',
    String(settings.n_ctx ?? ''),
    settings.cache_type_k ?? '',
    settings.cache_type_v ?? '',
  ];
  for (const msg of messages) {
    parts.push(`${msg.role}:${extractMessageText(msg.content)}`);
  }
  const combined = parts.join('\u0001');

  // djb2
  let hash = 5381;
  for (let i = 0; i < combined.length; i++) {
    hash = (hash * 33) ^ combined.charCodeAt(i);
  }
  // Force unsigned 32-bit, hex-encode.
  return (hash >>> 0).toString(16) + ':' + combined.length;
}

interface SessionMeta {
  fingerprint: string;
  savedAt: number;
}

/**
 * Snapshots the context's current KV cache to disk for `conversationId`,
 * tagged with a fingerprint of the exact message history (including the
 * assistant's just-generated reply) that produced this state. Call this
 * right after a completion finishes successfully.
 *
 * Never throws — a failed snapshot just means the next restore attempt
 * for this conversation will miss, which is a performance-only regression.
 */
export async function saveConversationSession(
  context: LlamaContext | undefined,
  conversationId: string | undefined,
  messagesIncludingReply: FingerprintableMessage[],
  settings: SessionFingerprintSettings,
): Promise<void> {
  if (!context || !conversationId) {
    return;
  }
  try {
    await ensureCacheDirExists();
    const path = sessionFilePath(conversationId);
    await context.saveSession(path);

    const meta: SessionMeta = {
      fingerprint: computeSessionFingerprint(messagesIncludingReply, settings),
      savedAt: Date.now(),
    };
    await RNFS.writeFile(sessionMetaPath(conversationId), JSON.stringify(meta), 'utf8');
  } catch (e) {
    console.warn(
      '[conversationSessionCache] Failed to save session for',
      conversationId,
      e,
    );
  }
}

/**
 * Attempts to restore a previously-saved KV cache for `conversationId`,
 * but ONLY if the saved fingerprint exactly matches `expectedPrefixMessages`
 * (the conversation history as it stands right before the new trailing
 * user message). On any mismatch, missing file, or error, this safely
 * returns false and does nothing to the context — the caller should just
 * proceed with a normal completion in that case.
 *
 * Never throws.
 */
export async function tryRestoreConversationSession(
  context: LlamaContext | undefined,
  conversationId: string | undefined,
  expectedPrefixMessages: FingerprintableMessage[],
  settings: SessionFingerprintSettings,
): Promise<boolean> {
  if (!context || !conversationId) {
    return false;
  }
  try {
    const metaPath = sessionMetaPath(conversationId);
    const metaExists = await RNFS.exists(metaPath);
    if (!metaExists) {
      return false;
    }
    const raw = await RNFS.readFile(metaPath, 'utf8');
    const meta = JSON.parse(raw) as SessionMeta;

    const expectedFingerprint = computeSessionFingerprint(
      expectedPrefixMessages,
      settings,
    );
    if (meta.fingerprint !== expectedFingerprint) {
      // History diverged (edit, branch, model/setting change) — safe skip.
      return false;
    }

    const path = sessionFilePath(conversationId);
    const sessionExists = await RNFS.exists(path);
    if (!sessionExists) {
      return false;
    }

    await context.loadSession(path);
    return true;
  } catch (e) {
    console.warn(
      '[conversationSessionCache] Failed to restore session for',
      conversationId,
      e,
    );
    return false;
  }
}

/**
 * Deletes the cached session (and its metadata) for a conversation, e.g.
 * when the conversation itself is deleted. Safe to call even if nothing
 * was ever cached for this id.
 */
export async function deleteConversationSession(
  conversationId: string,
): Promise<void> {
  try {
    const path = sessionFilePath(conversationId);
    const metaPath = sessionMetaPath(conversationId);
    if (await RNFS.exists(path)) {
      await RNFS.unlink(path);
    }
    if (await RNFS.exists(metaPath)) {
      await RNFS.unlink(metaPath);
    }
  } catch (e) {
    console.warn(
      '[conversationSessionCache] Failed to delete session for',
      conversationId,
      e,
    );
  }
}
