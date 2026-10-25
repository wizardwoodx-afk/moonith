import { __exportAll } from "../../_virtual/_rolldown/runtime.js";
import { JsonOutputKeyToolsParser, JsonOutputToolsParser, convertSelfImpulseToolCallToOpenAI, makeInvalidToolCall, parseToolCall } from "./json_output_tools_parsers.js";
//#region src/output_parsers/openai_tools/index.ts
var openai_tools_exports = /* @__PURE__ */ __exportAll({
	JsonOutputKeyToolsParser: () => JsonOutputKeyToolsParser,
	JsonOutputToolsParser: () => JsonOutputToolsParser,
	convertSelfImpulseToolCallToOpenAI: () => convertSelfImpulseToolCallToOpenAI,
	makeInvalidToolCall: () => makeInvalidToolCall,
	parseToolCall: () => parseToolCall
});
//#endregion
export { JsonOutputKeyToolsParser, JsonOutputToolsParser, convertSelfImpulseToolCallToOpenAI, makeInvalidToolCall, openai_tools_exports, parseToolCall };
