// =============================================================================
// open-mem — OpenCode Session Bridge for AI Calls
// =============================================================================
//
// When no direct API key is available, this bridge routes AI calls through
// OpenCode's session infrastructure, which already has auth configured.
// =============================================================================

import type { LanguageModel } from "ai";

// The OpenCode SDK client type (loosely typed to avoid hard dependency)
type OpenCodeClient = {
	session: {
		create: (options: any) => Promise<any>;
		prompt: (options: any) => Promise<any>;
		delete: (options: any) => Promise<any>;
	};
};

/**
 * Create a generateText-compatible function that routes through OpenCode's session API.
 *
 * This creates a dedicated background session for open-mem's AI calls,
 * reuses it across all compression/summarization requests, and extracts
 * the text response.
 */
export function createOpenCodeBridge(client: unknown) {
	const sdk = client as OpenCodeClient;

	// Validate the client has the methods we need
	if (!sdk?.session?.create || !sdk?.session?.prompt) {
		return null;
	}

	let sessionId: string | null = null;
	let sessionCreating: Promise<string> | null = null;

	async function getOrCreateSession(): Promise<string> {
		if (sessionId) return sessionId;

		// Prevent concurrent session creation
		if (sessionCreating) return sessionCreating;

		sessionCreating = (async () => {
			try {
				const result = await sdk.session.create({
					body: { title: "[open-mem] AI compression" },
				});
				const id = result?.data?.id;
				if (!id) throw new Error("No session ID returned");
				sessionId = id;
				return id;
			} finally {
				sessionCreating = null;
			}
		})();

		return sessionCreating;
	}

	/**
	 * A generateText-compatible function that routes through OpenCode.
	 *
	 * Matches the signature: ({ model, prompt, system, maxOutputTokens }) => Promise<{ text, ... }>
	 */
	async function bridgeGenerateText(options: {
		model: LanguageModel;
		prompt?: string;
		system?: string;
		maxOutputTokens?: number;
		[key: string]: any;
	}): Promise<{
		text: string;
		finishReason: string;
		usage: { promptTokens: number; completionTokens: number; totalTokens: number };
	}> {
		const sid = await getOrCreateSession();

		const promptText = options.prompt || "";

		const result = await sdk.session.prompt({
			path: { id: sid },
			body: {
				parts: [{ type: "text" as const, text: promptText }],
				system: options.system,
				tools: {}, // disable all tools — we just want text generation
				noReply: false,
			},
		});

		// Extract text from response parts
		const parts = result?.data?.parts || [];
		const text = parts
			.filter((p: any) => p.type === "text")
			.map((p: any) => p.text || "")
			.join("");

		return {
			text,
			finishReason: "stop",
			usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
		};
	}

	/**
	 * Cleanup: delete the background session.
	 */
	async function cleanup(): Promise<void> {
		if (sessionId) {
			try {
				await sdk.session.delete({ path: { id: sessionId } });
			} catch {
				// Ignore cleanup errors
			}
			sessionId = null;
		}
	}

	return { generateText: bridgeGenerateText, cleanup };
}
