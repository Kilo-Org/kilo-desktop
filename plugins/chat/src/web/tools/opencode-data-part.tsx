import { WrenchIcon } from "lucide-react";
import type { FC } from "react";

type OpenCodeDataPartProps = {
	name: string;
	data: unknown;
};

/** The projection's step markers: they delimit model steps and render nothing. */
const HIDDEN_DATA_PARTS = new Set(["opencode-step-start", "opencode-step-finish"]);

export const isHiddenOpenCodeDataPart = (name: string): boolean => HIDDEN_DATA_PARTS.has(name);

/** Fallback for data parts no renderer claims: step markers hide, anything else shows its name. */
export const OpenCodeDataPart: FC<OpenCodeDataPartProps> = ({ name }) => {
	if (isHiddenOpenCodeDataPart(name)) return null;

	return (
		<div className="bg-muted/30 text-muted-foreground my-3 flex w-min items-center gap-2 rounded-full border px-2 py-1 text-xs text-nowrap">
			<WrenchIcon className="size-3" />
			{name.replace(/^opencode-/, "").replace(/-/g, " ")}
		</div>
	);
};
