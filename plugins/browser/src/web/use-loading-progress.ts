import { useEffect, useRef, useState } from "react";

const TICK_INTERVAL_MS = 120;
const FADE_OUT_DELAY_MS = 220;
const SEED_PERCENT = 4;
const ASYMPTOTE_PERCENT = 90;

export function useLoadingProgress(loading: boolean): number {
	const [progress, setProgress] = useState(0);
	const progressRef = useRef(0);
	progressRef.current = progress;

	useEffect(() => {
		if (!loading) {
			if (progressRef.current === 0) return;
			setProgress(100);
			const timer = window.setTimeout(() => setProgress(0), FADE_OUT_DELAY_MS);
			return () => window.clearTimeout(timer);
		}

		setProgress((value) => (value > 0 && value < 95 ? value : SEED_PERCENT));
		const interval = window.setInterval(() => {
			const current = progressRef.current;
			if (current >= ASYMPTOTE_PERCENT) return;
			setProgress(
				Math.min(ASYMPTOTE_PERCENT, current + Math.max(0.5, (ASYMPTOTE_PERCENT - current) * 0.08)),
			);
		}, TICK_INTERVAL_MS);

		return () => window.clearInterval(interval);
	}, [loading]);

	return progress;
}
