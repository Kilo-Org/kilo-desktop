import { useEffect, useState } from "react";

import { toast } from "@kilo-desktop/ui/components/sonner";

import {
	isLocalModelLoadingStatus,
	localModelLoadingCopy,
	resolveLocalModelName,
} from "./local-model-loading-copy.js";
import { useLocalInferenceStatus } from "./use-local-inference-status.js";

const TOAST_ID = "local-model-loading";

export function LocalModelLoadingToast({
	models = [],
}: {
	models?: ReadonlyArray<{ modelID: string; name: string }>;
}) {
	const status = useLocalInferenceStatus();
	const [dismissed, setDismissed] = useState(false);
	const loading = isLocalModelLoadingStatus(status);
	if (!loading && dismissed) setDismissed(false);

	const modelName =
		status?.status === "loading-model" ? resolveLocalModelName(status.modelId, models) : undefined;
	const copy = status ? localModelLoadingCopy(status, modelName) : null;
	const title = copy?.title;
	const subtitle = copy?.subtitle;

	useEffect(() => {
		if (!loading || dismissed || !title) {
			toast.dismiss(TOAST_ID);
			return;
		}
		toast.loading(title, {
			id: TOAST_ID,
			description: subtitle,
			duration: Number.POSITIVE_INFINITY,
			closeButton: true,
			onDismiss: () => setDismissed(true),
		});
	}, [dismissed, loading, subtitle, title]);

	useEffect(
		() => () => {
			toast.dismiss(TOAST_ID);
		},
		[],
	);

	return null;
}
