// Test fixtures other plugins' tests may use (`@kilo-desktop/plugin-core/testing`):
// the bundled kilo2 in an isolated home, a stand-in Kilo API and a stand-in model.
export {
	installKiloPlugin,
	kilo2Executable,
	startKilo2,
	startStandInKiloApi,
	type Kilo2,
	type StandInKiloApi,
	type StandInMarketplace,
} from "./kilo2";
export {
	STAND_IN_MODEL,
	standInProviderConfig,
	startStandInModel,
	type StandInModel,
	type StandInReply,
	type StandInRequest,
} from "./stand-in-model";
