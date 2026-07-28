import { QueryClient } from "@tanstack/svelte-query";

import type { IpcMethodChannel, IpcMethodInput, IpcMethodOutput } from "$shared";

export class DesktopApiError extends Error {
	override readonly name = "DesktopApiError";

	constructor(
		readonly code:
			"VALIDATION" | "AUTHORIZATION" | "CANCELLED" | "BUSINESS" | "TRANSPORT" | "INTERNAL",
		message: string,
	) {
		super(message);
	}
}

type InvokeArguments<TChannel extends IpcMethodChannel> =
	IpcMethodInput<TChannel> extends undefined
		? [input?: undefined]
		: [input: IpcMethodInput<TChannel>];

export async function invokeDesktop<TChannel extends IpcMethodChannel>(
	channel: TChannel,
	...arguments_: InvokeArguments<TChannel>
): Promise<IpcMethodOutput<TChannel>> {
	if (typeof window === "undefined" || !window.desktopApi) {
		throw new DesktopApiError("TRANSPORT", "The desktop bridge is unavailable.");
	}

	const result = await window.desktopApi.invoke(channel, ...arguments_);
	if (!result.ok) {
		throw new DesktopApiError(result.error.code, result.error.message);
	}
	return result.value;
}

export function createDesktopQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 30_000,
				gcTime: 5 * 60_000,
				refetchOnWindowFocus: false,
				retry: (failureCount, error) =>
					failureCount < 1 &&
					error instanceof DesktopApiError &&
					(error.code === "TRANSPORT" || error.code === "INTERNAL"),
			},
			mutations: {
				retry: false,
			},
		},
	});
}
