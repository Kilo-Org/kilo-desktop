import { useEffect, useState } from "react";

/** "just now", "5 min ago", "2 h ago", then the date. */
export function relativeTime(timestamp: number, now: number): string {
	const seconds = Math.round((now - timestamp) / 1000);
	if (seconds < 45) return "just now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} h ago`;
	return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** How long something ran: "42s", "3m 05s", "1h 02m". */
export function duration(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
	return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** The current time, updated every `everyMs` while mounted (one timer per caller). */
export function useNow(everyMs = 30_000): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), everyMs);
		return () => clearInterval(timer);
	}, [everyMs]);
	return now;
}
