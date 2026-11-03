import { useEffect, useState } from "react";

import { toast } from "@kilo-desktop/ui/components/sonner";

import { modelDisplayName } from "./models/model-format.js";
import { LOCAL_MODEL_LOADING_TITLE } from "./local-model-loading-copy.js";
import { useLocalInferenceState } from "./local-inference.js";

const TOAST_ID = "local-model-loading";

/**
 * Origin's "Loading model..." toast while a local model loads for a prompt,
 * shown in every window; dismissing it hides it until the next load.
 */
export function LocalModelLoadingToast() {
	const loading = useLocalInferenceState(({ status, models }) =>
		status.status === "loading-model"
			? (models.find((model) => model.id === status.modelId) ?? status.modelId)
			: null,
	);
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
