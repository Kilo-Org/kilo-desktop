import { useEffect, useEffectEvent, useState } from "react";

const TICK_INTERVAL_MS = 120;
const FADE_OUT_DELAY_MS = 220;
const SEED_PERCENT = 4;
const ASYMPTOTE_PERCENT = 90;

export function useLoadingProgress(loading: boolean): number {
	const [progress, setProgress] = useState(0);
	const [wasLoading, setWasLoading] = useState(false);
	const isIdle = useEffectEvent(() => progress === 0);

	if (wasLoading !== loading) {
		setWasLoading(loading);
		if (loading) setProgress((value) => (value > 0 && value < 95 ? value : SEED_PERCENT));
		else if (progress !== 0) setProgress(100);
	}

	useEffect(() => {
		if (!loading) {
			if (isIdle()) return;
			const timer = window.setTimeout(() => setProgress(0), FADE_OUT_DELAY_MS);
			return () => window.clearTimeout(timer);
		}

		const interval = window.setInterval(() => setProgress(advance), TICK_INTERVAL_MS);

		return () => window.clearInterval(interval);
	}, [loading]);

	return progress;
}

function advance(current: number): number {
	if (current >= ASYMPTOTE_PERCENT) return current;
	return Math.min(ASYMPTOTE_PERCENT, current + Math.max(0.5, (ASYMPTOTE_PERCENT - current) * 0.08));
}
