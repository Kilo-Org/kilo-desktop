import { InfoIcon, RotateCcwIcon } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@kilo-desktop/ui/components/field";
import { SliderField } from "@kilo-desktop/ui/components/slider-field";
import { Switch } from "@kilo-desktop/ui/components/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@kilo-desktop/ui/components/tabs";
import { Textarea } from "@kilo-desktop/ui/components/textarea";
import { toggleVariants } from "@kilo-desktop/ui/components/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";
import { cn } from "@kilo-desktop/ui/lib/utils";

import type { LocalModel, LocalModelSettings } from "../../contracts/index";
import {
	LLAMA_CPP_SAMPLING_DEFAULTS,
	parseLlamaFlags,
	serializeLlamaFlags,
	type LlamaOverridableModelSetting,
} from "../../shared/settings/model-settings";
import { modelDisplayName } from "./model-format";

const DEFAULT_CONTEXT_LENGTH = 4096;
const DEFAULT_MAX_RESPONSE_TOKENS = 4096;
const MIN_CONTEXT_EXPONENT = 8;
const MAX_CONTEXT_EXPONENT = 20;
const MIN_CONTEXT_LENGTH = 2 ** MIN_CONTEXT_EXPONENT;
const MAX_CONTEXT_LENGTH = 2 ** MAX_CONTEXT_EXPONENT;

function scalarSliderValue(value: number | readonly number[]): number {
	return typeof value === "number" ? value : (value[0] ?? 0);
}

function contextLengthFromExponent(exponent: number): number {
	return 2 ** Math.round(exponent);
}

function contextExponent(contextLength: number): number {
	return Math.log2(contextLength);
}

function formatTokenCount(value: number): string {
	return `${value.toLocaleString("en-US")} tokens`;
}

type NumericSettingSliderProps = {
	id: string;
	label: string;
	description: string;
	initialValue: number | undefined;
	fallbackValue: number;
	automaticLabel: string;
	min: number;
	max: number;
	step: number;
	inputAriaLabel: string;
	qaId: string;
	integer?: boolean;
	sliderMin?: number;
	sliderMax?: number;
	sliderStep?: number;
	settingFromSlider?: (value: number) => number;
	sliderFromSetting?: (value: number) => number;
	valueText?: (value: number) => string;
	onCommit: (value: number | undefined) => void;
};

function decimalPlaces(step: number): number {
	const decimal = String(step).split(".")[1];
	return decimal?.length ?? 0;
}

const identity = (value: number) => value;

function NumericSettingSlider({
	id,
	label,
	description,
	initialValue,
	fallbackValue,
	automaticLabel,
	min,
	max,
	step,
	inputAriaLabel,
	qaId,
	integer = false,
	sliderMin = min,
	sliderMax = max,
	sliderStep = step,
	settingFromSlider = identity,
	sliderFromSetting = identity,
	valueText = String,
	onCommit,
}: NumericSettingSliderProps) {
	const precision = decimalPlaces(step);
	const formatInput = (value: number) =>
		integer ? String(value) : String(Number(value.toFixed(precision)));
	const [value, setValue] = useState(initialValue);
	const [inputValue, setInputValue] = useState(
		initialValue === undefined ? "" : formatInput(initialValue),
	);
	const effectiveValue = value ?? fallbackValue;

	const applySliderValue = (sliderValue: number) => {
		const next = settingFromSlider(sliderValue);
		setValue(next);
		setInputValue(formatInput(next));
		return next;
	};
	const commitInput = () => {
		if (inputValue.trim() === "") {
			setInputValue("");
			if (value !== undefined) {
				setValue(undefined);
				onCommit(undefined);
			}
			return;
		}
		const parsed = Number(inputValue);
		if (
			!Number.isFinite(parsed) ||
			(integer && !Number.isInteger(parsed)) ||
			parsed < min ||
			parsed > max
		) {
			setInputValue(value === undefined ? "" : formatInput(value));
			return;
		}
		const next = integer ? parsed : Number(parsed.toFixed(precision));
		setValue(next);
		setInputValue(formatInput(next));
		if (next !== value) onCommit(next);
	};

	return (
		<Field>
			<SliderField
				id={id}
				label={<span className="text-sm">{label}</span>}
				labelAddon={
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									aria-label={`About ${label}`}
								/>
							}
						>
							<InfoIcon />
						</TooltipTrigger>
						<TooltipContent>{description}</TooltipContent>
					</Tooltip>
				}
				inputAddon={
					value !== undefined ? (
						<Tooltip>
							<TooltipTrigger
								render={
									<Button
										type="button"
										variant="ghost"
										size="icon-xs"
										aria-label={`Reset ${label} to automatic`}
										data-qa-id={`${qaId}-reset`}
										onClick={() => {
											setValue(undefined);
											setInputValue("");
											onCommit(undefined);
										}}
									/>
								}
							>
								<RotateCcwIcon />
							</TooltipTrigger>
							<TooltipContent>Use automatic value</TooltipContent>
						</Tooltip>
					) : null
				}
				min={sliderMin}
				max={sliderMax}
				step={sliderStep}
				value={sliderFromSetting(effectiveValue)}
				aria-label={label}
				aria-valuetext={value === undefined ? automaticLabel : valueText(value)}
				data-qa-id={qaId}
				input={{
					type: "number",
					inputMode: integer ? "numeric" : "decimal",
					min,
					max,
					step,
					value: inputValue,
					placeholder: automaticLabel,
					title: value === undefined ? `Automatic: ${automaticLabel}` : undefined,
					"aria-label":
						value === undefined
							? `${inputAriaLabel}, automatic: ${automaticLabel}`
							: inputAriaLabel,
					onChange: (event) => setInputValue(event.target.value),
					onBlur: commitInput,
					onKeyDown: (event) => {
						if (event.key === "Enter") event.currentTarget.blur();
					},
				}}
				onValueChange={(nextValue) => {
					applySliderValue(scalarSliderValue(nextValue));
				}}
				onValueCommitted={(nextValue) => {
					onCommit(applySliderValue(scalarSliderValue(nextValue)));
				}}
			/>
		</Field>
	);
}

const GENERAL_OVERRIDES = [
	"contextLength",
	"temperature",
	"maxResponseTokens",
] as const satisfies readonly LlamaOverridableModelSetting[];
const SAMPLING_OVERRIDES = [
	"topP",
	"topK",
	"minP",
	"repeatPenalty",
	"presencePenalty",
] as const satisfies readonly LlamaOverridableModelSetting[];

function countOverrides(
	settings: LocalModelSettings,
	keys: readonly LlamaOverridableModelSetting[],
): number {
	return keys.filter((key) => settings[key] !== undefined).length;
}

// Tab triggers borrow the ghost toggle look used by the marketplace type
// filters; the overrides neutralise the stock pill/underline tab styling.
const settingsTabClassName = cn(
	toggleVariants({ size: "sm" }),
	"h-7 flex-none gap-1.5 border-transparent text-foreground after:hidden hover:text-foreground dark:text-foreground",
	"group-data-[variant=line]/tabs-list:data-active:bg-muted dark:group-data-[variant=line]/tabs-list:data-active:bg-muted",
);

function SettingsTab({
	value,
	label,
	customized,
}: {
	value: string;
	label: string;
	customized: number;
}) {
	return (
		<TabsTrigger
			value={value}
			className={settingsTabClassName}
			aria-label={customized > 0 ? `${label}, ${customized} customized` : undefined}
			data-qa-id={`local-model-tab-${value}`}
		>
			{label}
			{customized > 0 ? (
				<span className="text-2xs inline-block min-w-[2ch] text-right tabular-nums opacity-60">
					{customized}
				</span>
			) : null}
		</TabsTrigger>
	);
}

/**
 * Settings are grouped into tabs rather than disclosure sections so an
 * expanded model card stays compact; tab badges surface how many values in a
 * hidden group differ from their automatic defaults.
 */
export function ModelSettingsPanel({
	model,
	error,
	onSave,
}: {
	model: LocalModel;
	error?: string | undefined;
	onSave: (settings: LocalModelSettings) => void;
}) {
	const [settings, setSettings] = useState<LocalModelSettings>(model.settings ?? {});
	// Commits can fire back-to-back within one render (slider commit + blur),
	// so merges read the ref rather than possibly-stale state.
	const latestSettings = useRef(settings);
	const [extraArguments, setExtraArguments] = useState(() =>
		serializeLlamaFlags(model.settings?.llamaFlags ?? {}),
	);
	const [extraArgumentsError, setExtraArgumentsError] = useState<string>();

	const commit = (next: LocalModelSettings) => {
		latestSettings.current = next;
		setSettings(next);
		onSave(next);
	};
	const saveNumericSetting = (key: LlamaOverridableModelSetting, value: number | undefined) => {
		const next = { ...latestSettings.current };
		if (value === undefined) delete next[key];
		else next[key] = value;
		commit(next);
	};
	const commitExtraArguments = () => {
		const parsed = parseLlamaFlags(extraArguments);
		if (!parsed.ok) {
			setExtraArgumentsError(parsed.error);
			return;
		}

		const next = { ...latestSettings.current };
		if (Object.keys(parsed.flags).length > 0) next.llamaFlags = parsed.flags;
		else delete next.llamaFlags;
		setExtraArgumentsError(undefined);
		commit(next);
	};

	return (
		<div className="flex min-w-0 flex-col gap-3">
			<Tabs defaultValue="general" className="min-w-0 flex-col gap-4">
				<TabsList
					variant="line"
					aria-label={`${modelDisplayName(model)} setting groups`}
					className="h-auto gap-1 p-0"
				>
					<SettingsTab
						value="general"
						label="General"
						customized={countOverrides(settings, GENERAL_OVERRIDES)}
					/>
					<SettingsTab
						value="sampling"
						label="Sampling"
						customized={countOverrides(settings, SAMPLING_OVERRIDES)}
					/>
					<SettingsTab
						value="advanced"
						label="Advanced"
						customized={Object.keys(settings.llamaFlags ?? {}).length}
					/>
				</TabsList>

				<TabsContent value="general" className="min-w-0">
					<FieldGroup className="gap-4">
						<Field orientation="horizontal">
							<FieldContent>
								<FieldLabel htmlFor={`local-model-kilo-context-${model.id}`}>
									Coding tools and instructions
								</FieldLabel>
								<FieldDescription>
									Off by default for faster local inference. Turn on to give this model the coding
									instructions and tools available in chat.
								</FieldDescription>
							</FieldContent>
							<Switch
								id={`local-model-kilo-context-${model.id}`}
								className="self-center"
								checked={settings.includeKiloContext === true}
								aria-label="Coding tools and instructions"
								data-qa-id="local-model-settings-kilo-context"
								onCheckedChange={(checked) => {
									commit({ ...latestSettings.current, includeKiloContext: checked });
								}}
							/>
						</Field>
						<NumericSettingSlider
							id={`local-model-context-length-${model.id}`}
							label="Context length"
							description="Larger contexts use more memory and may reduce generation speed."
							initialValue={settings.contextLength}
							fallbackValue={DEFAULT_CONTEXT_LENGTH}
							automaticLabel="Model default"
							min={MIN_CONTEXT_LENGTH}
							max={MAX_CONTEXT_LENGTH}
							step={256}
							integer
							sliderMin={MIN_CONTEXT_EXPONENT}
							sliderMax={MAX_CONTEXT_EXPONENT}
							sliderStep={1}
							settingFromSlider={contextLengthFromExponent}
							sliderFromSetting={contextExponent}
							valueText={formatTokenCount}
							inputAriaLabel="Context length in tokens"
							qaId="local-model-settings-context-length"
							onCommit={(value) => saveNumericSetting("contextLength", value)}
						/>
						<NumericSettingSlider
							id={`local-model-temperature-${model.id}`}
							label="Temperature"
							description="Lower values are more predictable; higher values produce more varied responses."
							initialValue={settings.temperature}
							fallbackValue={LLAMA_CPP_SAMPLING_DEFAULTS.temperature}
							automaticLabel={String(LLAMA_CPP_SAMPLING_DEFAULTS.temperature)}
							min={0}
							max={2}
							step={0.1}
							inputAriaLabel="Temperature value"
							qaId="local-model-settings-temperature"
							onCommit={(value) => saveNumericSetting("temperature", value)}
						/>
						<NumericSettingSlider
							id={`local-model-max-tokens-${model.id}`}
							label="Max tokens"
							description="Limits the number of tokens generated in each response."
							initialValue={settings.maxResponseTokens}
							fallbackValue={DEFAULT_MAX_RESPONSE_TOKENS}
							automaticLabel="Unlimited"
							min={1}
							max={MAX_CONTEXT_LENGTH}
							step={1}
							integer
							sliderMin={0}
							sliderMax={MAX_CONTEXT_EXPONENT}
							sliderStep={1}
							settingFromSlider={contextLengthFromExponent}
							sliderFromSetting={contextExponent}
							valueText={formatTokenCount}
							inputAriaLabel="Max tokens value"
							qaId="local-model-settings-max-tokens"
							onCommit={(value) => saveNumericSetting("maxResponseTokens", value)}
						/>
					</FieldGroup>
				</TabsContent>

				<TabsContent value="sampling" className="min-w-0">
					<FieldGroup className="gap-4">
						<NumericSettingSlider
							id={`local-model-top-p-${model.id}`}
							label="Top P"
							description="Limits sampling to tokens within this cumulative probability."
							initialValue={settings.topP}
							fallbackValue={LLAMA_CPP_SAMPLING_DEFAULTS.topP}
							automaticLabel={String(LLAMA_CPP_SAMPLING_DEFAULTS.topP)}
							min={0}
							max={1}
							step={0.01}
							inputAriaLabel="Top P value"
							qaId="local-model-settings-top-p"
							onCommit={(value) => saveNumericSetting("topP", value)}
						/>
						<NumericSettingSlider
							id={`local-model-top-k-${model.id}`}
							label="Top K"
							description="Limits sampling to the most likely tokens; 0 disables the limit."
							initialValue={settings.topK}
							fallbackValue={LLAMA_CPP_SAMPLING_DEFAULTS.topK}
							automaticLabel={String(LLAMA_CPP_SAMPLING_DEFAULTS.topK)}
							min={0}
							max={100}
							step={1}
							integer
							inputAriaLabel="Top K value"
							qaId="local-model-settings-top-k"
							onCommit={(value) => saveNumericSetting("topK", value)}
						/>
						<NumericSettingSlider
							id={`local-model-min-p-${model.id}`}
							label="Min P"
							description="Filters tokens below this probability relative to the most likely token."
							initialValue={settings.minP}
							fallbackValue={LLAMA_CPP_SAMPLING_DEFAULTS.minP}
							automaticLabel={String(LLAMA_CPP_SAMPLING_DEFAULTS.minP)}
							min={0}
							max={1}
							step={0.01}
							inputAriaLabel="Min P value"
							qaId="local-model-settings-min-p"
							onCommit={(value) => saveNumericSetting("minP", value)}
						/>
						<NumericSettingSlider
							id={`local-model-repeat-penalty-${model.id}`}
							label="Repetition penalty"
							description="Higher values discourage repeated token sequences; 1.0 disables the penalty."
							initialValue={settings.repeatPenalty}
							fallbackValue={LLAMA_CPP_SAMPLING_DEFAULTS.repeatPenalty}
							automaticLabel={String(LLAMA_CPP_SAMPLING_DEFAULTS.repeatPenalty)}
							min={0}
							max={2}
							step={0.1}
							inputAriaLabel="Repetition penalty value"
							qaId="local-model-settings-repeat-penalty"
							onCommit={(value) => saveNumericSetting("repeatPenalty", value)}
						/>
						<NumericSettingSlider
							id={`local-model-presence-penalty-${model.id}`}
							label="Presence penalty"
							description="Higher values favor tokens that have not appeared yet; 0 disables the penalty."
							initialValue={settings.presencePenalty}
							fallbackValue={LLAMA_CPP_SAMPLING_DEFAULTS.presencePenalty}
							automaticLabel={String(LLAMA_CPP_SAMPLING_DEFAULTS.presencePenalty)}
							min={0}
							max={2}
							step={0.1}
							inputAriaLabel="Presence penalty value"
							qaId="local-model-settings-presence-penalty"
							onCommit={(value) => saveNumericSetting("presencePenalty", value)}
						/>
					</FieldGroup>
				</TabsContent>

				<TabsContent value="advanced" className="min-w-0">
					<FieldGroup>
						<Field className="gap-3" data-invalid={Boolean(extraArgumentsError)}>
							<FieldLabel htmlFor={`local-model-extra-arguments-${model.id}`}>
								Extra Arguments
							</FieldLabel>
							<Textarea
								id={`local-model-extra-arguments-${model.id}`}
								value={extraArguments}
								aria-invalid={Boolean(extraArgumentsError) || undefined}
								placeholder={"--n-gpu-layers 99\n--flash-attn on"}
								className="min-h-24 resize-y font-mono text-xs"
								data-qa-id="local-model-settings-extra-arguments"
								onChange={(event) => {
									setExtraArguments(event.target.value);
									setExtraArgumentsError(undefined);
								}}
								onBlur={commitExtraArguments}
							/>
							<FieldDescription>
								Paste llama.cpp flags exactly as you would on the command line. Matching values
								override the model settings in the other tabs; app-managed flags are refused.
							</FieldDescription>
							{extraArgumentsError ? <FieldError>{extraArgumentsError}</FieldError> : null}
						</Field>
					</FieldGroup>
				</TabsContent>
			</Tabs>
			{error ? (
				<Field data-invalid>
					<FieldError>{error}</FieldError>
				</Field>
			) : null}
		</div>
	);
}
