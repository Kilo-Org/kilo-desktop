import { FeatureError, type MainSdkFetch } from "@anaconda-agentic-desktop/feature-sdk/main";

import type { ModelCatalog } from "../../contracts/schemas.js";

import {
	modelCatalogApiResponseSchema,
	modelDownloadUrlResponseSchema,
} from "./catalog-api-schemas.js";
import { mapModelCatalog } from "./map-catalog-model.js";

const MODEL_CATALOG_URL = "https://anaconda.com/api/ai/model/models";

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(
			(value) => {
				signal.removeEventListener("abort", onAbort);
				resolve(value);
			},
			(error: unknown) => {
				signal.removeEventListener("abort", onAbort);
				reject(error);
			},
		);
	});
}

export interface AuthMainCapability extends Record<string, unknown> {
	session: {
		getApiKey(): Promise<string | null>;
	};
}

export interface ModelCatalogDependencies {
	fetch: MainSdkFetch;
	getApiKey(): Promise<string | null>;
}

export async function listModelCatalog({
	fetch,
	getApiKey,
}: ModelCatalogDependencies): Promise<ModelCatalog> {
	const apiKey = await getApiKey();
	if (!apiKey) {
		throw new FeatureError("Sign in to your Anaconda account to view the model catalog.");
	}

	let response: Response;
	try {
		response = await fetch(MODEL_CATALOG_URL, {
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${apiKey}`,
				"X-Anaconda-Api-Version": "3",
			},
		});
	} catch {
		throw new FeatureError("The Anaconda model catalog could not be loaded.");
	}

	if (!response.ok) {
		const message =
			response.status === 401 || response.status === 403
				? "Your Anaconda account does not have access to the model catalog."
				: "The Anaconda model catalog could not be loaded.";
		throw new FeatureError(message);
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw new FeatureError("The Anaconda model catalog returned an invalid response.");
	}

	const parsed = modelCatalogApiResponseSchema.safeParse(payload);
	if (!parsed.success) {
		throw new FeatureError("The Anaconda model catalog returned an invalid response.");
	}

	return mapModelCatalog(parsed.data);
}

export async function getModelDownloadUrl(
	{ fetch, getApiKey }: ModelCatalogDependencies,
	modelId: string,
	fileId: string,
	signal: AbortSignal,
): Promise<string> {
	const apiKey = await abortable(getApiKey(), signal);
	if (!apiKey) {
		throw new FeatureError("Sign in to your Anaconda account to download models.");
	}

	let response: Response;
	try {
		response = await fetch(
			`${MODEL_CATALOG_URL}/${encodeURIComponent(modelId)}/files/${encodeURIComponent(fileId)}/download`,
			{
				signal,
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${apiKey}`,
					"X-Anaconda-Api-Version": "3",
				},
			},
		);
	} catch (error) {
		if (signal.aborted) throw error;
		throw new FeatureError("The model download could not be started.");
	}

	if (!response.ok) {
		const message =
			response.status === 401 || response.status === 403
				? "Your Anaconda account does not have access to this model."
				: "The model download could not be started.";
		throw new FeatureError(message);
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw new FeatureError("The model download returned an invalid response.");
	}
	const parsed = modelDownloadUrlResponseSchema.safeParse(payload);
	if (!parsed.success) {
		throw new FeatureError("The model download returned an invalid response.");
	}
	return parsed.data.download_url;
}
