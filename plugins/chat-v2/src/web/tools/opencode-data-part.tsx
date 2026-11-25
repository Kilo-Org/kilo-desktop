import { WrenchIcon } from "lucide-react";
import type { FC } from "react";

type OpenCodeDataPartProps = {
	name: string;
	data: unknown;
};

/** The projection's data parts: a step's retry (`opencode-retry`), a compaction (`opencode-compaction`). */
const getSummary = (name: string) => {
	if (name === "opencode-retry") return "Retry";
	if (name === "opencode-compaction") return "Compaction";
	return name.replace(/^opencode-/, "").replace(/-/g, " ");
};

export const OpenCodeDataPart: FC<OpenCodeDataPartProps> = ({ name }) => (
	<div className="bg-muted/30 text-muted-foreground my-3 flex w-min items-center gap-2 rounded-full border px-2 py-1 text-xs text-nowrap">
		<WrenchIcon className="size-3" />
		{getSummary(name)}
	</div>
);
