import { Serializable } from "../load/serializable.js";
//#region src/example_selectors/base.ts
/**
* Base class for example selectors.
*/
var BaseExampleSelector = class extends Serializable {
	lc_namespace = [
		"selfimpulse_core",
		"example_selectors",
		"base"
	];
};
//#endregion
export { BaseExampleSelector };
