import AsyncStorage from '@react-native-async-storage/async-storage';

export type WebSearchProvider = 'searxng' | 'tavily';

const PROVIDER_KEY = 'webSearchProvider';
const SEARXNG_ENDPOINT_KEY = 'webSearchEndpoint';
const TAVILY_API_KEY_KEY = 'webSearchTavilyApiKey';

export async function getSearchProvider(): Promise<WebSearchProvider> {
  try {
    const value = await AsyncStorage.getItem(PROVIDER_KEY);
    return value === 'tavily' ? 'tavily' : 'searxng';
  } catch {
    return 'searxng';
  }
}

export async function setSearchProvider(
  provider: WebSearchProvider,
): Promise<void> {
  try {
    await AsyncStorage.setItem(PROVIDER_KEY, provider);
  } catch (e) {
    console.error('Failed to save web search provider:', e);
  }
}

/**
 * Reads the user-configured SearXNG instance URL.
 * Returns null if not yet set.
 */
export async function getSearchEndpoint(): Promise<string | null> {
  try {
    const value = await AsyncStorage.getItem(SEARXNG_ENDPOINT_KEY);
    return value && value.trim().length > 0 ? value.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Persists the user's SearXNG instance URL. Pass an empty string
 * or null to clear it.
 */
export async function setSearchEndpoint(
  url: string | null,
): Promise<void> {
  try {
    if (!url || url.trim().length === 0) {
      await AsyncStorage.removeItem(SEARXNG_ENDPOINT_KEY);
    } else {
      await AsyncStorage.setItem(SEARXNG_ENDPOINT_KEY, url.trim());
    }
  } catch (e) {
    console.error('Failed to save web search endpoint:', e);
  }
}

/**
 * Reads the user-configured Tavily API key.
 * Returns null if not yet set.
 */
export async function getTavilyApiKey(): Promise<string | null> {
  try {
    const value = await AsyncStorage.getItem(TAVILY_API_KEY_KEY);
    return value && value.trim().length > 0 ? value.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Persists the user's Tavily API key. Pass an empty string
 * or null to clear it.
 */
export async function setTavilyApiKey(key: string | null): Promise<void> {
  try {
    if (!key || key.trim().length === 0) {
      await AsyncStorage.removeItem(TAVILY_API_KEY_KEY);
    } else {
      await AsyncStorage.setItem(TAVILY_API_KEY_KEY, key.trim());
    }
  } catch (e) {
    console.error('Failed to save Tavily API key:', e);
  }
}
