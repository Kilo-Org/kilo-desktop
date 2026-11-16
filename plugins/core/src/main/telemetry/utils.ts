/**
 * Masks an email for logs — `user@example.com` → `u***@example.com`. Telemetry
 * diagnostics identify the person without logging PII; matches LaunchDarkly's
 * identify log format.
 */
export function maskEmail(email: string | undefined): string {
	if (!email) return "none";
	const at = email.indexOf("@");
	if (at <= 0) return "***";
	return `${email[0]}***@${email.slice(at + 1)}`;
}

const SECONDS_PER_DAY = 60 * 60 * 24;
const DAYS_IN_PERIOD = 65;

/** Rolling ~65-day cohort bucket: `floor(now_seconds / (86400 * 65))`. */
export function calculatePeriodId(timestamp: number = Date.now()): number {
	return Math.floor(timestamp / 1000 / (SECONDS_PER_DAY * DAYS_IN_PERIOD));
}
