import type { SearchResult } from "../../types";
import type { StrategyDeps, StrategyOptions } from "./types";

function mergeUnique(values: string[]): string[] {
	return Array.from(new Set(values));
}

function mergeByObservationId(items: SearchResult[], limit: number): SearchResult[] {
	const deduped: SearchResult[] = [];
	const seen = new Set<string>();
	for (const item of items) {
		if (seen.has(item.observation.id)) continue;
		seen.add(item.observation.id);
		deduped.push(item);
		if (deduped.length >= limit) break;
	}
	return deduped;
}

export function executeFilterOnlyStrategy(
	deps: StrategyDeps,
	query: string,
	options: StrategyOptions,
	limit: number,
): SearchResult[] {
	const conceptTerms = mergeUnique([
		...(options.concept ? [options.concept] : []),
		...(options.concepts ?? []),
	]);
	if (conceptTerms.length > 0) {
		const matches = conceptTerms.flatMap((concept) =>
			deps.observations.searchByConcept(concept, limit, options.projectPath),
		);
		return mergeByObservationId(
			matches.map((obs) => ({
				observation: obs,
				rank: 0,
				snippet: obs.title,
				rankingSource: "graph" as const,
				explain: {
					strategy: "filter-only",
					matchedBy: ["concept-filter"],
				},
			})),
			limit,
		);
	}

	const fileTerms = mergeUnique([
		...(options.file ? [options.file] : []),
		...(options.files ?? []),
	]);
	if (fileTerms.length > 0) {
		const matches = fileTerms.flatMap((file) =>
			deps.observations.searchByFile(file, limit, options.projectPath),
		);
		return mergeByObservationId(
			matches.map((obs) => ({
				observation: obs,
				rank: 0,
				snippet: obs.title,
				rankingSource: "graph" as const,
				explain: {
					strategy: "filter-only",
					matchedBy: ["file-filter"],
				},
			})),
			limit,
		);
	}

	return deps.observations.search({
		query,
		type: options.type,
		limit,
		projectPath: options.projectPath,
		importanceMin: options.importanceMin,
		importanceMax: options.importanceMax,
		createdAfter: options.createdAfter,
		createdBefore: options.createdBefore,
		concepts: options.concepts,
		files: options.files,
	});
}
