import { WrenchIcon } from "lucide-react";
import type { FC } from "react";

type OpenCodeDataPartProps = {
	name: string;
	data: unknown;
};

const getSummary = (name: string, data: unknown) => {
	if (
		name === "opencode-unsupported-part" &&
		typeof data === "object" &&
		data !== null &&
		"type" in data &&
		typeof data.type === "string"
	) {
		return `Unsupported part: ${data.type}`;
	}

	if (name === "opencode-snapshot") return "Snapshot";
	if (name === "opencode-retry") return "Retry";
	if (name === "opencode-compaction") return "Compaction";
	if (name === "opencode-agent") return "Agent event";

	return name.replace(/^opencode-/, "").replace(/-/g, " ");
};

const HIDDEN_DATA_PARTS = new Set([
	"opencode-step-start",
	"opencode-step-finish",
	"opencode-patch",
	"opencode-subtask",
]);

export const isHiddenOpenCodeDataPart = (name: string): boolean => HIDDEN_DATA_PARTS.has(name);

export const OpenCodeDataPart: FC<OpenCodeDataPartProps> = ({ name, data }) => {
	if (isHiddenOpenCodeDataPart(name)) {
		return null;
	}

	const summary = getSummary(name, data);

	return (
		<div className="bg-muted/30 text-muted-foreground my-3 flex w-min items-center gap-2 rounded-full border px-2 py-1 text-xs text-nowrap">
			<WrenchIcon className="size-3" />
			{summary}
		</div>
	);
};
