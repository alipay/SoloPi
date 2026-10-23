
export type CommonSite = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
};

export const COMMON_SITES_STORAGE_KEY = 'glassbox.commonSites.v1';
export const COMMON_SITES_CHANGED_EVENT = 'glassbox:common-sites-changed';
export const DEFAULT_COMMON_SITES: CommonSite[] = [];

function isValidSite(value: unknown): value is CommonSite {
  if (!value || typeof value !== 'object') return false;
  const site = value as Partial<CommonSite>;
  if (!site.id || !site.name || !site.url) return false;
  try {
    const parsed = new URL(site.url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch (_error) {
    return false;
  }
}

export function readCommonSites(): CommonSite[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COMMON_SITES_STORAGE_KEY) || '[]');
    if (Array.isArray(parsed)) {
      const sites = parsed.filter(isValidSite).map((site) => ({ ...site, enabled: site.enabled !== false }));
      return sites;
    }
  } catch (_error) {
    // Invalid local preferences fall back to the maintained defaults.
  }
  return DEFAULT_COMMON_SITES;
}

export function writeCommonSites(sites: CommonSite[]) {
  window.localStorage.setItem(COMMON_SITES_STORAGE_KEY, JSON.stringify(sites));
  window.dispatchEvent(new CustomEvent(COMMON_SITES_CHANGED_EVENT));
}

export function createCommonSite(): CommonSite {
  return {
    id: `site-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: '新站点',
    url: 'https://',
    enabled: true,
  };
}
