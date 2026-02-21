import type { User } from "@supabase/supabase-js";

export function getUserAuthProviders(user: User): Set<string> {
  const providers = new Set<string>();

  const appMeta: any = (user as any)?.app_metadata;
  const primaryProvider = (appMeta?.provider ?? "").toString().trim().toLowerCase();
  if (primaryProvider) providers.add(primaryProvider);

  const metaProviders = appMeta?.providers;
  if (Array.isArray(metaProviders)) {
    for (const p of metaProviders) {
      const v = (p ?? "").toString().trim().toLowerCase();
      if (v) providers.add(v);
    }
  }

  const identities: any[] | undefined = (user as any)?.identities;
  if (Array.isArray(identities)) {
    for (const ident of identities) {
      const v = (ident?.provider ?? "").toString().trim().toLowerCase();
      if (v) providers.add(v);
    }
  }

  // Supabase commonly uses 'email' for email/password auth.
  // Some setups may report 'password' in identities (rare), but we normalize to what we see.
  return providers;
}

export function isGoogleOauthOnlyAccount(user: User): boolean {
  const providers = getUserAuthProviders(user);
  const hasGoogle = providers.has("google");
  const hasEmail = providers.has("email");

  // If Google is present and email provider is NOT present, treat as OAuth-only.
  // (If both exist, the user likely has linked email auth and can manage email/password normally.)
  return hasGoogle && !hasEmail;
}
