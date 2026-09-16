# JunieVest — The Research Desk

JunieVest turns financial questions into specific, researched investment briefs: a direct call, evidence, an actionable approach, downside scenarios, and what would change the view. It keeps the conversation in context and asks focused questions when the request is too vague to answer usefully.

A question such as **“Should I invest in SpaceX today?”** goes straight to research. The agent checks current listing/access status, valuation, costs and catalysts, then gives a provisional **yes or no** with explicit assumptions. It does not hard-code SpaceX's status or a predetermined recommendation. “Help me invest” can instead trigger up to three clickable clarification questions.

## Run locally

Requires **Node 22.12+ (or Node 24+)** and npm.

```sh
npm ci
cp .env.example .env
# Fill in the three server settings below.
npm run dev
```

| Setting | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY` | Server-side model access |
| `OPENROUTER_MODEL` | An OpenRouter model ID supporting JSON object responses; choose a capable reasoning model in your account |
| `TAVILY_API_KEY` | Fresh web searches for every substantive answer |
| `OPENROUTER_TIMEOUT_MS` | Model call deadline, including response-body reading; defaults to `180000`, range `1000`–`300000` |
| `OPENROUTER_MAX_TOKENS` | Combined reasoning + final-answer token budget; defaults to `12000`, range `1000`–`32000` |
| `OPENROUTER_REASONING_EFFORT` | `low` (default), `medium`, `high`, or `provider` to omit the reasoning override |
| `PUBLIC_ORIGIN` | Optional exact external origin, such as `https://invest.example`, behind a reverse proxy |
| `PORT` / `HOST` | Production listener; defaults to `3000` / `0.0.0.0` |

Get credentials and model IDs from [OpenRouter](https://openrouter.ai/models) and [Tavily](https://docs.tavily.com/). The model is deliberately configurable so an aging model ID is not embedded in the app.

**Migration:** remove the old `VITE_OPENROUTER_API_KEY` setting and use `OPENROUTER_API_KEY`. `VITE_` variables are compiled into the public browser bundle; if an old build was published with a real key, rotate that key. No credentials are sent to the browser by the new API.

The UI reports setup status. Missing credentials, unavailable search, empty results and failed evidence checks produce actionable errors; they never fall back to canned answers or unresearched market claims.

## How the harness works

1. **Plan or clarify.** Read the full conversation and optional investor context. Resolve follow-ups against the original task. Ask only for missing details that materially change the answer, or produce 2–3 complementary public research queries, including a current-week lookup.
2. **Research.** Execute fresh Tavily searches server-side. Deduplicate URLs, reject unsafe link schemes, cap evidence size, and preserve source publication and retrieval dates separately. Search queries are instructed to omit private investor details.
3. **Build the brief.** Generate a structured decision or analysis. A decision must have a yes/no verdict. Reasons and risks cite retrieved source IDs; the server attaches the actual source URLs. Limited evidence requires low confidence and cannot support “yes.” Sufficient evidence requires cited sources from at least two different hostnames (a diversity check, not proof of editorial independence).
4. **Review.** A separate model pass checks whether citations support claims, dates are used honestly, the answer addresses the requested action, and the strategy accounts for material risks. It may request one revision, then rejects a brief that still fails. This is an additional model check, not a guarantee of factual accuracy.
5. **Continue.** Structured clarification answers and complete briefs carry into subsequent turns. Failed/cancelled requests are retryable without duplicating user messages or polluting model history with error text.

Each JSON generation has at most one format/validation repair. There are at most 3 searches and 10 model requests per turn, including all repairs and the review revision. The complete turn has a 10-minute deadline; model calls default to 3 minutes each, and searches retain their 45-second deadline. The browser waits 10 seconds beyond the server deadline so it can display the server's error. Cancellation propagates upstream. There is no background or recursive agent loop, and a timed-out generation is not automatically retried.

### Reasoning models and response errors

Reasoning models can spend more than 45 seconds generating reasoning before returning any final JSON. The older harness cancelled these calls at 45 seconds and incorrectly reported an aborted response-body read as “unreadable response.” The current transport distinguishes provider deadlines, malformed JSON, missing final answers, exhausted completion budgets (`finish_reason: length`), and interrupted connections. It requests `stream: false`, but can also assemble final-answer deltas if a provider returns SSE; reasoning deltas are never rendered as answers.

For a model such as `deepseek/deepseek-v4-flash-20260731`, start with the defaults: `OPENROUTER_TIMEOUT_MS=180000`, `OPENROUTER_MAX_TOKENS=12000`, and `OPENROUTER_REASONING_EFFORT=low`. Reasoning effort support depends on the model/provider; use `provider` to keep its default behavior. Increasing the token budget raises the potential cost ceiling. Changing these server settings requires a restart. Ensure a deployment's reverse proxy permits the full turn duration; a shorter gateway timeout can still interrupt an otherwise healthy model call.

Opening `/api/chat` directly in a browser sends GET and correctly returns `405 method_not_allowed`. Chat submission uses POST with JSON. If a submitted chat request gets this error, inspect redirects and proxy routing for a POST-to-GET conversion. Use `/api/health` for a browser-readable setup check.

Research uses web extracts, **not an exchange quote feed**. Retrieval today does not prove an article or price is current. Missing or conflicting price/access evidence must be surfaced as a limitation; the agent should withhold a buy call until it can support it. No trades are executed.

## App and deployment

React 19 + TypeScript + Vite, with a Node HTTP API and Zod contracts. The same API middleware runs in development, preview and production.

```sh
npm run build
npm start
```

The production server serves the built UI and `/api/chat` on the same origin. Static-only hosting is no longer sufficient: deploy the Node process with its `dist`, `dist-server`, production dependencies and server environment. `npm run preview` also includes the API for local checks.

The server validates request sizes, limits requests per socket IP (12/minute, 2 concurrent), rejects browser requests from other origins, redacts upstream errors, and sets `no-store` on API responses. For a public multi-user deployment, put authentication and shared rate/budget enforcement at your gateway. The built-in limiter is process-local, does not trust forwarded IP headers, and will group users behind the same proxy.

Conversations and optional investing context live in browser memory and reset on reload; a new brief retains the optional context. They are sent to OpenRouter for each turn. Public research queries are sent to Tavily. The app does not persist or log conversations. Provider retention policies still apply. History is bounded (40 messages / 60,000 total characters); when full, start a new brief rather than silently dropping prior constraints.

## Validation

```sh
npm run test:run      # Harness, API, transport, and React behavior
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e      # Desktop + mobile browser flows with synthetic API fixtures
```

Browser tests can use a preinstalled Chromium via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Screenshots are saved to `AIR_ARTIFACTS_DIR` when set. Provider calls are mocked in automated tests; fixture briefs are synthetic, not investment advice.

After setting real credentials, run the optional live regression cases (normal provider charges apply):

```sh
npm run build
npm run eval:live
```

This checks vague requests, SpaceX yes/no routing, a creative AI strategy, prompt injection, and clarification memory. It writes a report to `AIR_ARTIFACTS_DIR` or `test-results`. Review those briefs for factual accuracy, freshness, citation support, suitability and practical value: passing a shape check is not enough. No live market output or provider latency is claimed by the offline test suite.

Core implementation: `server/agent.ts` (orchestration), `server/prompts.ts` (policy), `server/http.ts` (API), `src/shared/agent.ts` (contracts), and `src/components/ResearchBrief.tsx` (brief and clarification UI).
