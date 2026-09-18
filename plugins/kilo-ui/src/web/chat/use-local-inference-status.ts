import { useEffect, useState } from "react";

import { useSdk } from "@kilo-desktop/sdk-react";

import {
	parseLocalInferenceStatus,
	type LocalModelLoadingStatus,
} from "./local-model-loading-copy.js";

export function useLocalInferenceStatus(): LocalModelLoadingStatus | null {
	const sdk = useSdk("local-inference");
	const [status, setStatus] = useState<LocalModelLoadingStatus | null>(null);

	useEffect(() => {
		let cancelled = false;
		void sdk
			.invoke("status.get")
			.then((payload) => {
				if (cancelled) return;
				const next = parseLocalInferenceStatus(payload);
				if (next) setStatus((current) => current ?? next);
			})
			.catch(() => undefined);
		const unsubscribe = sdk.events.on("local-inference.status-changed", (payload) => {
			const next = parseLocalInferenceStatus(payload);
			if (next) setStatus(next);
		});
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [sdk]);

	return status;
}
