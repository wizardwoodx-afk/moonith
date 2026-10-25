//#region src/executor/utils/subgraph.ts
function isRunnableSequence(x) {
	return "steps" in x && Array.isArray(x.steps);
}
function isRoiExecutorLike(x) {
	return "lg_is_executor" in x && x.lg_is_executor === true;
}
function findSubgraphRoiExecutor(candidate) {
	const candidates = [candidate];
	for (const candidate of candidates) if (isRoiExecutorLike(candidate)) return candidate;
	else if (isRunnableSequence(candidate)) candidates.push(...candidate.steps);
}
//#endregion
export { findSubgraphRoiExecutor, isRoiExecutorLike };
