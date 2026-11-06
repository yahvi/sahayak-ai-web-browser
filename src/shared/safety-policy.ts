/**
 * Pure safety policy — no Chrome APIs (architecture §8).
 * Denylist always wins over allowlist.
 */

export type UrlClass = "sensitive" | "allowlisted" | "normal";
export type FieldClass = "password" | "otp" | "card" | "normal";

/** Host / path tokens that mark a URL sensitive (case-insensitive). */
export const SENSITIVE_HOST_TOKENS = [
  "bank",
  "banking",
  "paypal",
  "stripe",
  "razorpay",
  "paytm",
  "phonepe",
  "bhim",
  "upi",
  "netbanking",
  "wallet",
] as const;

/** Well-known finance hosts used in the URL test matrix. */
export const SENSITIVE_HOSTS = [
  "paypal.com",
  "stripe.com",
  "razorpay.com",
  "paytm.com",
  "phonepe.com",
] as const;

export const SENSITIVE_PATH_PREFIXES = [
  "/checkout",
  "/payment",
  "/pay",
  "/upi",
  "/netbanking",
] as const;

/** Default agent allowlist until Settings UI (slice 16). */
export const DEFAULT_ALLOWLIST_HOSTS = ["localhost", "127.0.0.1"] as const;

export type FieldLike = {
  type?: string | null;
  name?: string | null;
  id?: string | null;
  autocomplete?: string | null;
};

function hostMatchesSensitive(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (SENSITIVE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return true;
  }
  const labels = host.split(".");
  return SENSITIVE_HOST_TOKENS.some((token) =>
    labels.some((label) => label === token || label.includes(token)),
  );
}

function pathIsSensitive(pathname: string): boolean {
  const path = pathname.toLowerCase();
  return SENSITIVE_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

function isDefaultAllowlisted(hostname: string): boolean {
  return (DEFAULT_ALLOWLIST_HOSTS as readonly string[]).includes(
    hostname.toLowerCase(),
  );
}

function isUserAllowlisted(hostname: string, userAllowlist: string[]): boolean {
  const host = hostname.toLowerCase();
  return userAllowlist.some((entry) => {
    const normalized = entry.trim().toLowerCase();
    if (!normalized) return false;
    try {
      if (normalized.includes("://")) {
        return new URL(normalized).hostname === host;
      }
    } catch {
      /* treat as bare host */
    }
    return normalized === host || host.endsWith(`.${normalized}`);
  });
}

/**
 * Classify a page URL. A denylisted URL is always `sensitive`,
 * even if it also appears on the user allowlist.
 */
export function classifyUrl(
  url: string,
  userAllowlist: string[] = [],
): UrlClass {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "sensitive";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "sensitive";
  }

  if (hostMatchesSensitive(parsed.hostname) || pathIsSensitive(parsed.pathname)) {
    return "sensitive";
  }

  if (
    isDefaultAllowlisted(parsed.hostname) ||
    isUserAllowlisted(parsed.hostname, userAllowlist)
  ) {
    return "allowlisted";
  }

  return "normal";
}

function attr(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().trim();
}

export function classifyField(el: FieldLike): FieldClass {
  const type = attr(el.type);
  const rawAutocomplete = attr(el.autocomplete);
  const rawName = (el.name ?? "").trim();
  const rawId = (el.id ?? "").trim();

  if (type === "password") {
    return "password";
  }

  if (
    rawAutocomplete.includes("one-time-code") ||
    rawAutocomplete.includes("otp")
  ) {
    return "otp";
  }

  if (
    rawAutocomplete.includes("cc-number") ||
    rawAutocomplete.includes("cc-csc") ||
    rawAutocomplete.includes("cc-exp") ||
    rawAutocomplete.includes("cc-name")
  ) {
    return "card";
  }

  const normalizedCombined = `${rawName} ${rawId} ${rawAutocomplete}`
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_.]/g, " ")
    .toLowerCase();

  if (/\b(otp|totp|one-time|one\s+time)\b/.test(normalizedCombined)) {
    return "otp";
  }

  if (/\b(card|cvv|cvc)\b/.test(normalizedCombined)) {
    return "card";
  }

  return "normal";
}

const CONSEQUENTIAL_PATTERN =
  /\b(submit|pay|send|confirm\s+payment|place\s+order)\b/i;

/** True for Submit / Pay / Send and close payment variants. */
export function isConsequentialName(text: string): boolean {
  return CONSEQUENTIAL_PATTERN.test(text.trim());
}
