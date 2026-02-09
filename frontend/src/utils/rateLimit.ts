export function isRateLimitErrorMessage(message: string): boolean {
  const m = (message || "").toLowerCase();

  // Supabase/Auth providers typically respond with 429 + one of these phrases.
  return (
    (m.includes("rate") && m.includes("limit")) ||
    m.includes("email rate limit") ||
    m.includes("too many requests") ||
    m.includes("too many request") ||
    m.includes("over_email_send_rate_limit") ||
    m.includes("for security purposes") ||
    (m.includes("try again") && m.includes("later")) ||
    // sometimes status is embedded in the message
    m.includes(" 429") ||
    m.startsWith("429")
  );
}

export function getCooldownMsFromRateLimitErrorMessage(
  message: string,
  options?: {
    fallbackMs?: number;
  }
): number {
  const raw = message || "";
  const m = raw.toLowerCase();

  // Examples:
  // - "For security purposes, you can only request this after 60 seconds."
  // - "Please try again in 2 minutes"
  // - "Please wait 5m 00s before trying again."
  const afterSeconds = m.match(/after\s+(\d+)\s*second/);
  if (afterSeconds) return Math.max(0, Number(afterSeconds[1]) * 1000);

  const inSeconds = m.match(/in\s+(\d+)\s*second/);
  if (inSeconds) return Math.max(0, Number(inSeconds[1]) * 1000);

  const afterMinutes = m.match(/after\s+(\d+)\s*minute/);
  if (afterMinutes) return Math.max(0, Number(afterMinutes[1]) * 60_000);

  const inMinutes = m.match(/in\s+(\d+)\s*minute/);
  if (inMinutes) return Math.max(0, Number(inMinutes[1]) * 60_000);

  // Formats like: "wait 5m 00s" / "wait 5m" / "wait 300s"
  const waitMinutesSeconds = m.match(/wait\s+(\d+)\s*m\s*(\d+)\s*s/);
  if (waitMinutesSeconds) {
    const minutes = Number(waitMinutesSeconds[1]);
    const seconds = Number(waitMinutesSeconds[2]);
    return Math.max(0, minutes * 60_000 + seconds * 1000);
  }

  const waitMinutes = m.match(/wait\s+(\d+)\s*m(\b|\s)/);
  if (waitMinutes) return Math.max(0, Number(waitMinutes[1]) * 60_000);

  const waitSeconds = m.match(/wait\s+(\d+)\s*s(\b|\s)/);
  if (waitSeconds) return Math.max(0, Number(waitSeconds[1]) * 1000);

  const minutesWord = m.match(/(\d+)\s*min(ute)?s?/);
  if (minutesWord) return Math.max(0, Number(minutesWord[1]) * 60_000);

  // If it's a security throttle but the duration isn't stated, assume 60s.
  if (m.includes("for security purposes") || m.includes("security")) return 60_000;

  // Fallback to avoid repeated attempts that can extend the
  // provider-side throttle window.
  const fallbackMs = options?.fallbackMs;
  if (typeof fallbackMs === "number" && Number.isFinite(fallbackMs) && fallbackMs >= 0) {
    return fallbackMs;
  }

  return 15 * 60_000;
}
