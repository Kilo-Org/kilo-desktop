import { z } from "zod";

import type { Contribution } from "@kilo-desktop/kernel";

import type { Tool, ToolCallContext, ToolImplementation } from "../../contracts";
import type { ToolSource } from "../../main/agent/tool-gateway/tool-catalog";

type ToolContribution = Contribution<typeof Tool>;
type Metadata = ToolContribution["metadata"];

export type RecordedCall = { readonly input: unknown; readonly context: ToolCallContext };

/** A tool that records its calls and echoes its input and caller (without the signal). */
export function echoTool(
	calls: RecordedCall[] = [],
	input: z.ZodType = z.object({ text: z.string().optional() }),
): ToolImplementation {
	return {
		description: "Echo the input.",
		input,
		run: (value, context) => {
			calls.push({ input: value, context });
			const { signal: _signal, ...caller } = context;
			return { input: value, caller };
		},
	};
}

/** A `kilo.core/tool` contribution as the kernel lists it. */
export function toolContribution(
	key: string,
	implementation: ToolImplementation | undefined = echoTool(),
	metadata: Partial<Metadata> = {},
): ToolContribution {
	const slash = key.indexOf("/");
	return {
		key: key as ToolContribution["key"],
		pointId: "kilo.core/tool",
		pluginId: key.slice(0, slash),
		id: key.slice(slash + 1),
		priority: 0,
		metadata: {
			title: key,
			approval: "auto",
			requiresSignIn: false,
			readOnly: false,
			destructive: false,
			external: true,
			...metadata,
		},
		...(implementation ? { implementation } : {}),
		implementedRemotely: false,
		source: "manifest",
	};
}

/** Stands in for the kernel's extension registry. */
export class FakeToolSource implements ToolSource {
	#contributions: readonly ToolContribution[];
	readonly #listeners = new Set<() => void>();

	constructor(contributions: readonly ToolContribution[] = []) {
		this.#contributions = contributions;
	}

	list(): readonly ToolContribution[] {
		return this.#contributions;
	}

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** Replaces the contributions and tells subscribers, as the registry does on any change. */
	set(contributions: readonly ToolContribution[]): void {
		this.#contributions = contributions;
		for (const listener of [...this.#listeners]) listener();
	}
}
