import { FilesIcon } from "lucide-react";

import { PierreFileIcon } from "./PierreFileIcon.js";

export interface FilesTabIconProps {
	readonly className?: string;
	readonly iconKey?: string;
}

export function FilesTabIcon({ className, iconKey }: FilesTabIconProps) {
	return iconKey ? (
		<PierreFileIcon path={iconKey} {...(className ? { className } : {})} />
	) : (
		<FilesIcon className={className} />
	);
}
