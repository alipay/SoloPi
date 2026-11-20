import { createElement, createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type LanguagePreference = 'system' | 'zh-CN' | 'en';

const storageKey = 'solopi-desktop.language';
const validPreference = (value: string | null): LanguagePreference =>
  value === 'en' || value === 'zh-CN' ? value : 'system';

function readPreference(): LanguagePreference {
  try {
    return validPreference(window.localStorage.getItem(storageKey));
  } catch {
    return 'system';
  }
}

function resolveLanguage(locale: string): Exclude<LanguagePreference, 'system'> {
  return /^zh(?:[-_]|$)/i.test(locale) ? 'zh-CN' : 'en';
}

const LanguageContext = createContext<{
  preference: LanguagePreference;
  language: Exclude<LanguagePreference, 'system'>;
  setPreference: (value: LanguagePreference) => void;
  t: (chinese: string, english: string) => string;
}>({
  preference: 'system',
  language: 'zh-CN',
  setPreference: () => {},
  t: (chinese) => chinese,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState(readPreference);
  const [system, setSystem] = useState(() => resolveLanguage(navigator.language));
  const language = preference === 'system' ? system : preference;

  useEffect(() => {
    let requestVersion = 0;
    const updateSystem = async () => {
      const version = ++requestVersion;
      let locale = navigator.language;
      try {
        const preferred = await window.glassbox?.ipcRenderer?.invoke('settings:system-language');
        if (typeof preferred === 'string' && preferred) locale = preferred;
      } catch {
        // Browser previews and older Electron hosts can use the renderer locale.
      }
      if (version === requestVersion) setSystem(resolveLanguage(locale));
    };
    const syncPreference = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) setPreference(readPreference());
    };
    window.addEventListener('languagechange', updateSystem);
    window.addEventListener('focus', updateSystem);
    window.addEventListener('storage', syncPreference);
    void updateSystem();
    return () => {
      requestVersion++;
      window.removeEventListener('languagechange', updateSystem);
      window.removeEventListener('focus', updateSystem);
      window.removeEventListener('storage', syncPreference);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const changePreference = (value: LanguagePreference) => {
    setPreference(value);
    try {
      window.localStorage.setItem(storageKey, value);
    } catch {
      // Keep the in-memory selection when browser storage is unavailable.
    }
  };

  return createElement(LanguageContext.Provider, { value: {
    preference,
    language,
    setPreference: changePreference,
    t: (chinese, english) => language === 'en' ? english : chinese,
  } }, children);
}

export const useLanguage = () => useContext(LanguageContext);
