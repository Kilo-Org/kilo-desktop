import { useEffect, useState } from "react";

import { toast } from "@kilo-desktop/ui/components/sonner";

import { modelDisplayName } from "./models/model-format";
import { LOCAL_MODEL_LOADING_TITLE } from "./local-model-loading-copy";
import { useLocalModelsState, useModelServerState } from "./local-inference";

const TOAST_ID = "local-model-loading";

/**
 * Origin's "Loading model..." toast while a local model loads for a prompt,
 * shown in every window (a `kilo.shell/status-bar-item` view that renders
 * nothing); dismissing it hides it until the next load.
 */
export function LocalModelLoadingToast() {
	const loadingModelId = useModelServerState(({ status }) =>
		status.status === "loading-model" ? status.modelId : null,
	);
	const loading =
		useLocalModelsState(({ models }) =>
			loadingModelId === null
				? null
				: (models.find((model) => model.id === loadingModelId) ?? loadingModelId),
		) ?? loadingModelId;
	const subtitle =
		loading === null ? null : typeof loading === "string" ? loading : modelDisplayName(loading);
	const [dismissed, setDismissed] = useState(false);
	if (subtitle === null && dismissed) setDismissed(false);

	useEffect(() => {
		if (subtitle === null || dismissed) {
			toast.dismiss(TOAST_ID);
			return;
		}
		toast.loading(LOCAL_MODEL_LOADING_TITLE, {
			id: TOAST_ID,
			description: subtitle,
			duration: Number.POSITIVE_INFINITY,
			closeButton: true,
			onDismiss: () => setDismissed(true),
		});
	}, [dismissed, subtitle]);

	useEffect(() => () => void toast.dismiss(TOAST_ID), []);

	return null;
}
