export type CookiePreferences = {
  necessary: true;
  functional: boolean;
  updatedAt: string;
};

export const DEFAULT_COOKIE_PREFS: CookiePreferences = {
  necessary: true,
  functional: false,
  updatedAt: "",
};

export function parseCookiePreferences(raw: string | null): CookiePreferences | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CookiePreferences>;
    if (typeof parsed.functional !== "boolean") return null;
    return {
      necessary: true,
      functional: parsed.functional,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    return null;
  }
}

export function createCookiePreferences(functional: boolean, now = new Date()): CookiePreferences {
  return {
    necessary: true,
    functional,
    updatedAt: now.toISOString(),
  };
}
