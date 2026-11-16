import { EarthIcon } from "lucide-react";
import { useEffect, useState } from "react";

/** A Browser pane's tab icon: its page's favicon (a `data:` image), else the globe. */
export function BrowserIcon({ className, iconKey }: { className?: string; iconKey?: string }) {
	const [failedIcon, setFailedIcon] = useState<string>();
	useEffect(() => setFailedIcon(undefined), [iconKey]);
	return iconKey?.startsWith("data:image/") && failedIcon !== iconKey ? (
		<img
			src={iconKey}
			alt=""
			className={className}
			draggable={false}
			onError={() => setFailedIcon(iconKey)}
		/>
	) : (
		<EarthIcon className={className} />
	);
}
