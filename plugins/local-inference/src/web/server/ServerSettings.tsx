import { useEffect, useRef, useState } from "react";

import { FieldError } from "@kilo-desktop/ui/components/field";
import { Input } from "@kilo-desktop/ui/components/input";
import { Skeleton, SkeletonText } from "@kilo-desktop/ui/components/skeleton";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kilo-desktop/ui/components/select";
import { Switch } from "@kilo-desktop/ui/components/switch";

import type {
	LocalModelLoadMode,
	LocalServerSettings,
} from "../../shared/settings/server-settings.js";

type Draft = {
	port: string;
	modelLoadMode: LocalModelLoadMode;
	serveOnLocalNetwork: boolean;
};

type ParseResult = { ok: true; value?: number } | { ok: false; error: string };

const AUTOSAVE_DELAY_MS = 400;
const MODEL_LOAD_MODE_OPTIONS: { label: string; value: LocalModelLoadMode }[] = [
	{ label: "One model", value: "one" },
	{ label: "All models", value: "all" },
];

function draftFrom(settings: LocalServerSettings): Draft {
	return {
		port: settings.port === undefined ? "" : String(settings.port),
		modelLoadMode: settings.modelLoadMode ?? "one",
		serveOnLocalNetwork: Boolean(settings.serveOnLocalNetwork),
	};
}

function parseInteger(raw: string, min: number, max: number, error: string): ParseResult {
	const text = raw.trim();
	if (!text) return { ok: true };
	const value = Number(text);
	if (!Number.isInteger(value) || value < min || value > max) {
		return { ok: false, error };
	}
	return { ok: true, value };
}

export function ServerSettings({
	settings,
	disabled,
	error,
	onSave,
}: {
	settings: LocalServerSettings;
	disabled: boolean;
	error?: string | undefined;
	onSave: (settings: LocalServerSettings) => Promise<void>;
}) {
	const initial = draftFrom(settings);
	const [port, setPort] = useState(initial.port);
	const [modelLoadMode, setModelLoadMode] = useState(initial.modelLoadMode);
	const [serveOnLocalNetwork, setServeOnLocalNetwork] = useState(initial.serveOnLocalNetwork);
	const [localError, setLocalError] = useState<string | null>(null);
	const [dirty, setDirty] = useState(false);
	const onSaveRef = useRef(onSave);
	const settingsRef = useRef(settings);

	useEffect(() => {
		onSaveRef.current = onSave;
	}, [onSave]);

	useEffect(() => {
		settingsRef.current = settings;
	}, [settings]);

	useEffect(() => {
		if (!dirty) return;

		const timeout = setTimeout(() => {
			const parsedPort = parseInteger(
				port,
				1,
				65_535,
				"Server port must be an integer from 1 to 65535.",
			);
			if (!parsedPort.ok) {
				setLocalError(parsedPort.error);
				return;
			}
			const current = settingsRef.current;
			const next: LocalServerSettings = {
				...(parsedPort.value === undefined ? {} : { port: parsedPort.value }),
				...(modelLoadMode === "all" ? { modelLoadMode } : {}),
				...(serveOnLocalNetwork ? { serveOnLocalNetwork: true } : {}),
				...(current.llamaFlags === undefined ? {} : { llamaFlags: current.llamaFlags }),
			};
			const unchanged =
				next.port === current.port &&
				modelLoadMode === (current.modelLoadMode ?? "one") &&
				Boolean(next.serveOnLocalNetwork) === Boolean(current.serveOnLocalNetwork);

			setLocalError(null);
			setDirty(false);
			if (!unchanged) {
				void onSaveRef.current(next).catch(() => undefined);
			}
		}, AUTOSAVE_DELAY_MS);

		return () => clearTimeout(timeout);
	}, [dirty, modelLoadMode, port, serveOnLocalNetwork]);

	return (
		<div className="divide-border divide-y">
			<div>
				<SummaryCard.Row>
					<SummaryCard.Content>
						<SummaryCard.Title>
							<label htmlFor="local-model-server-port">Server port</label>
						</SummaryCard.Title>
						<SummaryCard.Description>
							Leave blank to choose an available port automatically.
						</SummaryCard.Description>
					</SummaryCard.Content>
					<SummaryCard.Actions>
						<Input
							id="local-model-server-port"
							type="number"
							inputMode="numeric"
							min={1}
							max={65_535}
							placeholder="Automatic"
							value={port}
							disabled={disabled}
							onChange={(event) => {
								setPort(event.target.value);
								setLocalError(null);
								setDirty(true);
							}}
							className="h-7 w-36 text-sm"
							data-qa-id="local-model-server-port"
						/>
					</SummaryCard.Actions>
				</SummaryCard.Row>
			</div>
			<div>
				<SummaryCard.Row>
					<SummaryCard.Content>
						<SummaryCard.Title>
							<label htmlFor="local-model-server-load-mode">Models kept loaded</label>
						</SummaryCard.Title>
						<SummaryCard.Description>
							Keep one model loaded to reduce memory use, or retain every model you use.
						</SummaryCard.Description>
					</SummaryCard.Content>
					<SummaryCard.Actions>
						<Select
							items={MODEL_LOAD_MODE_OPTIONS}
							value={modelLoadMode}
							disabled={disabled}
							onValueChange={(value) => {
								if (value !== "one" && value !== "all") return;
								setModelLoadMode(value);
								setLocalError(null);
								setDirty(true);
							}}
						>
							<SelectTrigger
								id="local-model-server-load-mode"
								size="sm"
								className="w-36"
								aria-label="Models kept loaded"
								data-qa-id="local-model-server-load-mode"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									<SelectItem value="one">One model</SelectItem>
									<SelectItem value="all">All models</SelectItem>
								</SelectGroup>
							</SelectContent>
						</Select>
					</SummaryCard.Actions>
				</SummaryCard.Row>
			</div>
			<div>
				<SummaryCard.Row>
					<SummaryCard.Content>
						<SummaryCard.Title>
							<label htmlFor="local-model-server-lan">Serve on local network</label>
						</SummaryCard.Title>
						<SummaryCard.Description>
							Allow trusted devices on your Wi-Fi or LAN to connect.
						</SummaryCard.Description>
					</SummaryCard.Content>
					<SummaryCard.Actions>
						<Switch
							id="local-model-server-lan"
							checked={serveOnLocalNetwork}
							disabled={disabled}
							onCheckedChange={(checked) => {
								setServeOnLocalNetwork(checked);
								setLocalError(null);
								setDirty(true);
							}}
							aria-label="Serve on local network"
							data-qa-id="local-model-server-lan"
						/>
					</SummaryCard.Actions>
				</SummaryCard.Row>
			</div>
			{localError || error ? (
				<FieldError className="px-3 py-3 text-sm">{localError ?? error}</FieldError>
			) : null}
		</div>
	);
}

// One entry per row above, with a control placeholder sized like the real
// Input (h-7 w-36), SelectTrigger size="sm" (h-7 w-36), and default Switch.
const SKELETON_ROWS = [
	{ title: "w-24", description: "w-72", control: "h-7 w-36 rounded-lg" },
	{ title: "w-32", description: "w-80", control: "h-7 w-36" },
	{ title: "w-36", description: "w-64", control: "h-[18.4px] w-8 rounded-full" },
] as const;

export function ServerSettingsSkeleton() {
	return (
		<div
			className="divide-border divide-y"
			role="status"
			aria-busy="true"
			aria-label="Loading server settings"
		>
			{SKELETON_ROWS.map((row) => (
				<SummaryCard.Row key={row.title}>
					<SummaryCard.Content>
						<SummaryCard.Title>
							<SkeletonText className={row.title} />
						</SummaryCard.Title>
						<SummaryCard.Description>
							<SkeletonText className={row.description} />
						</SummaryCard.Description>
					</SummaryCard.Content>
					<SummaryCard.Actions>
						<Skeleton className={row.control} />
					</SummaryCard.Actions>
				</SummaryCard.Row>
			))}
		</div>
	);
}
