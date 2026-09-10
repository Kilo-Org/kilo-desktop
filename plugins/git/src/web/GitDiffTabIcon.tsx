import { GitCompareIcon } from "lucide-react";

export interface GitDiffTabIconProps {
	readonly className?: string;
	/** Contribution-owned value whose meaning is opaque to the host. */
	readonly iconKey?: string;
}

export function GitDiffTabIcon({ className }: GitDiffTabIconProps) {
	return <GitCompareIcon className={className} />;
}
