import { useEffect, useState } from "react";

/** Compact relative label, as the session list shows it: `now`, `5m`, `3h`, `2d`, then a date. */
export function formatRelativeTime(timestampMs: number, nowMs: number): string {
	const minutes = Math.floor(Math.max(0, nowMs - timestampMs) / 60_000);
	if (minutes < 1) return "now";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d`;
	return new Date(timestampMs).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function RelativeTime({ timestamp }: { readonly timestamp: number }) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(timer);
	}, []);
	return <>{formatRelativeTime(timestamp, now)}</>;
}
