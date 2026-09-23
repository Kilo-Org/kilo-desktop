import { useEffect } from "react";

import { type GitPrStatusTarget, useGitPrStatusStore } from "./git-pr-status-store.js";

export function GitPrStatusTargets({
	targets,
}: {
	readonly targets: readonly GitPrStatusTarget[];
}) {
	const setTargets = useGitPrStatusStore((state) => state.setTargets);
	const clearTargets = useGitPrStatusStore((state) => state.clearTargets);
	useEffect(() => {
		setTargets(targets);
	}, [setTargets, targets]);
	useEffect(() => () => clearTargets(), [clearTargets]);
	return null;
}
