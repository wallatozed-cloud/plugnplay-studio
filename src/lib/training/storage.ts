export const AGE_STORAGE_KEY = "pnp-studio-age";
export const CONSENT_STORAGE_KEY = "pnp-studio-training-consent";
export const CONTRIBUTOR_STORAGE_KEY = "pnp-studio-contributor";

export type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** localStorage, or a store that forgets writes when the webview blocks it. */
export function browserStore(): KeyValueStore {
  return {
    getItem(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      localStorage.setItem(key, value);
    },
    removeItem(key) {
      localStorage.removeItem(key);
    },
  };
}
