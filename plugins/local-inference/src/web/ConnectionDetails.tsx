import { CopyIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { useState } from "react";

import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "@anaconda-agentic-desktop/ui/components/input-group";

import type { LocalConnectionInfo } from "../contracts/schemas.js";
import { ConnectionRequestPopover } from "./ConnectionRequestPopover.js";

function ConnectionDetail({
	id,
	label,
	value,
	masked = false,
	onCopy,
}: {
	id: string;
	label: string;
	value: string | undefined;
	masked?: boolean;
	onCopy: (value: string) => void;
}) {
	const [revealed, setRevealed] = useState(false);
	const unavailable = value === undefined;

	return (
		<div className="flex min-w-0 flex-col gap-1.5">
			<label htmlFor={id} className="text-muted-foreground text-xs font-medium">
				{label}
			</label>
			<InputGroup>
				<InputGroupInput
					id={id}
					type={masked && !revealed && !unavailable ? "password" : "text"}
					value={value ?? "Unavailable"}
					readOnly
					autoComplete="off"
					spellCheck={false}
					className="font-mono text-xs"
				/>
				<InputGroupAddon align="inline-end">
					{masked ? (
						<InputGroupButton
							size="icon-xs"
							disabled={unavailable}
							aria-label={revealed ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
							aria-pressed={revealed}
							onClick={() => setRevealed((current) => !current)}
						>
							{revealed ? <EyeOffIcon /> : <EyeIcon />}
						</InputGroupButton>
					) : null}
					<InputGroupButton
						size="icon-xs"
						disabled={unavailable}
						aria-label={`Copy ${label.toLowerCase()}`}
						onClick={() => value && onCopy(value)}
					>
						<CopyIcon />
					</InputGroupButton>
				</InputGroupAddon>
			</InputGroup>
		</div>
	);
}

export function ConnectionDetails({
	connection,
	modelId,
	onCopy,
}: {
	connection: LocalConnectionInfo | undefined;
	modelId: string | undefined;
	onCopy: (value: string) => void;
}) {
	return (
		<section
			aria-labelledby="server-details-heading"
			className="min-w-0"
			data-qa-id="local-model-server-details"
		>
			<div className="flex min-w-0 flex-col gap-3">
				<div className="flex min-w-0 items-center justify-between gap-2">
					<h2 id="server-details-heading" className="text-sm font-medium">
						Connect
					</h2>
					<ConnectionRequestPopover connection={connection} modelId={modelId} onCopy={onCopy} />
				</div>
				<ConnectionDetail
					id="local-model-server-address"
					label="Server Address"
					value={connection?.baseUrl}
					onCopy={onCopy}
				/>
				<ConnectionDetail
					id="local-model-server-api-key"
					label="API Key"
					value={connection?.apiKey}
					masked
					onCopy={onCopy}
				/>
			</div>
		</section>
	);
}
