import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'webSearchEndpoint';

/**
 * Reads the user-configured SearXNG instance URL.
 * Returns null if not yet set.
 */
export async function getSearchEndpoint(): Promise<string | null> {
  try {
    const value = await AsyncStorage.getItem(STORAGE_KEY);
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
      await AsyncStorage.removeItem(STORAGE_KEY);
    } else {
      await AsyncStorage.setItem(STORAGE_KEY, url.trim());
    }
  } catch (e) {
    console.error('Failed to save web search endpoint:', e);
  }
}
