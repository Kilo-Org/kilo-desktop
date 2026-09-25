const SECONDS_PER_DAY = 60 * 60 * 24;
const DAYS_IN_PERIOD = 65;

/** Rolling ~65-day install cohort bucket: `floor(now_seconds / (86400 * 65))`. */
export function calculatePeriodId(timestamp: number = Date.now(), periodOffset = 0): number {
	return Math.floor(timestamp / 1000 / (SECONDS_PER_DAY * DAYS_IN_PERIOD)) + periodOffset;
}
