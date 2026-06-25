# ForgeFlow Local Release Notes

ForgeFlow Local is the small downloadable version of ForgeFlow.

## User Path

1. Start the local server.
2. Open the local browser page.
3. Import orders.
4. Confirm SKU, material, and equipment data.
5. Review today's production decision.
6. Optionally enable AI explanation with OpenAI or DeepSeek.

## Runtime Requirements

- Node.js 20 or newer
- Python 3 for CLI demos and validation scripts
- A browser
- Optional: OpenAI or DeepSeek API Key for AI explanations

## Release Package Contents

The release builder copies only the product-facing files:

- `server.js`
- `outputs/forgeflow-p0b-decision-console.html`
- release test dataset
- templates and examples
- scripts needed for demo, validation, smoke test, and packaging
- README, Quickstart, privacy, changelog, and license files
- one-click launchers

It intentionally excludes old logs, local state, SQLite files, and historical acceptance archives.

## AI Explanation Boundary

The local deterministic planner computes the schedule. AI receives a compact summary and returns boss-readable explanation text. The UI validates the explanation against known facts and falls back to the rule explanation if the provider call fails.
