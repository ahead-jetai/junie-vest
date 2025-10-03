### JunieVest Security Analysis

Date: 2025-10-03
Scope: Frontend-only React + Vite project in this repository
Method: Manual static review of source, configs, and build/test tooling (no dynamic testing or dependency scanning executed in this run).

---

### Executive Summary
Overall risk posture: Medium. The app is a client-side SPA that calls OpenRouter directly from the browser. There is no evidence of DOM XSS or obvious code injection in the current components. However, several risks exist, primarily around secret exposure (API key in the client), privacy (unnecessary headers), error/log handling, lack of request controls, and missing defense-in-depth headers/policies that should be provided by the hosting environment.

Top risks to address next:
- Move model API calls behind a server-side proxy to remove the need for a browser-exposed API key.
- Add basic request controls (timeouts/abort, retries limits) and safer logging.
- Set security headers (CSP, Referrer-Policy, Permissions-Policy, etc.) at the hosting layer.
- Consider LLM-specific protections for prompt injection and sensitive data handling.

---

### Findings and Recommendations

1) API key exposed in client (High)
- Evidence: src/services/chatService.ts uses VITE_OPENROUTER_API_KEY and sends Authorization: Bearer from the browser.
- Impact: Anyone with browser/devtools can extract the key; key leakage allows abuse of the account and unexpected costs.
- Recommendation: Create a minimal backend/proxy (e.g., serverless function) that:
  - Stores the provider API key server-side only.
  - Accepts requests from the SPA and forwards to OpenRouter.
  - Implements authentication/authorization and rate limiting where applicable.
  - Optionally signs requests with a short-lived token so the frontend never sees the provider key.

2) Unnecessary/duplicative origin leakage via custom headers (Medium)
- Evidence: chatService sets 'HTTP-Referer': window.location.origin and 'X-Title'. Browsers already send a Referer header (config-dependent), and forcing origin disclosure may leak context to a third party.
- Impact: Increased privacy exposure; potential inconsistencies or provider rejection of non-standard header names.
- Recommendation: Remove custom 'HTTP-Referer' header. If OpenRouter requires a Referer/Title, set only what is required and ensure values are static, not derived from runtime URL. Prefer configuring such headers server-side on the proxy.

3) Lack of request timeout/abort and retry policies (Medium)
- Evidence: fetch(...) without AbortController or timeout; no retry/backoff.
- Impact: Hung requests degrade UX; uncontrolled retries can amplify traffic or costs.
- Recommendation: Add AbortController with a reasonable timeout (e.g., 30s), a single retry with jitter on network errors, and clear user feedback. Ensure retries do not duplicate chargeable requests without safeguards.

4) Verbose error logging in production (Low → Medium depending on hosting)
- Evidence: console.error logs raw response text and error objects in chatService.
- Impact: Sensitive data from provider or user prompts might be logged in shared environments or exposed to users via console.
- Recommendation: Gate detailed logs behind NODE_ENV !== 'production' checks; sanitize error details; prefer user-safe messages while recording minimal technical info.

5) Missing security headers and policies at delivery layer (Medium)
- Evidence: index.html lacks meta-based fallbacks; no CSP/Referrer/Permissions policy configuration shown. Vite dev server is for development only.
- Impact: Reduces defense-in-depth against XSS, clickjacking, data exfiltration, and browser feature abuse.
- Recommendation (set via hosting/CDN):
  - Content-Security-Policy (example starting point):
    default-src 'self'; connect-src 'self' https://openrouter.ai; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'self'; frame-ancestors 'none';
  - Referrer-Policy: no-referrer
  - Permissions-Policy: camera=(), microphone=(), geolocation=()
  - X-Content-Type-Options: nosniff
  - X-Frame-Options: DENY (or use CSP frame-ancestors)
  - Strict-Transport-Security: max-age=31536000; includeSubDomains; preload (HTTPS-only)

6) LLM safety and prompt-injection considerations (Medium)
- Evidence: User input is forwarded directly to the model with a static “system” prompt; no content filtering or guardrails present client-side.
- Impact: Model may generate unsafe content, leak sensitive data, or follow malicious instructions embedded in user input.
- Recommendation: Implement server-side content policy and moderation (pre/post filters), instruction hierarchy enforcement, and output constraints. Consider adding a separate safety model or heuristics. Clearly disclose data handling to users and avoid sending unnecessary metadata.

7) DOM XSS review in components (Low)
- Evidence: ChatMessage renders message.text as plain content, not via dangerouslySetInnerHTML; React escapes by default. No direct innerHTML usage found.
- Impact: Low risk of XSS from message content under current rendering approach.
- Recommendation: Keep using plain text rendering. If rich text is introduced later, use a sanitizer (e.g., DOMPurify) and limit allowed tags/attributes.

8) Supply-chain and dependency posture (Informational → Medium)
- Evidence: Dependencies pinned by semver ranges; no lockfile review/audit performed in this pass.
- Impact: Potential for transitive vulnerabilities.
- Recommendation: Enable automated dependency scanning (npm audit, GitHub Dependabot). Consider using exact versions or a lockfile in CI. Verify vite/plugin-react and testing libs for known advisories periodically.

9) Build/test artifacts exposure (Low)
- Evidence: Coverage output to ./coverage; no evidence of publishing it.
- Impact: If deployed publicly, coverage reports could reveal file paths and internals.
- Recommendation: Ensure coverage and test artifacts are ignored in production deploys.

10) Environment variable management (Informational)
- Evidence: README instructs to create .env with VITE_ prefix (exposed to client by design).
- Recommendation: Provide an example .env.example excluding secrets, document that VITE_* are public, and move secrets to server-side configs.

---

### Code References
- src/services/chatService.ts: API key usage, headers, fetch config, logging.
- src/components/ChatMessage.tsx and ChatInterface.tsx: message rendering and inputs.
- index.html: absence of meta security headers.
- vite.config.ts, eslint.config.js: build/test setup (no clear security misconfigurations found).

---

### Suggested Minimal Code Changes (client-only)
If introducing small client changes before a backend proxy is available:
- Remove custom 'HTTP-Referer' header; keep 'X-Title' only if required and static.
- Add a fetch timeout using AbortController.
- Add production-aware logging (suppress detailed logs in production builds).
Note: These are defense-in-depth and UX improvements; they do not fix the core issue of secret exposure, which requires a backend.

---

### Hardening Checklist for Next Iteration
- [ ] Implement server-side proxy with key management and rate limiting
- [ ] Add request timeout/abort + controlled retry
- [ ] Configure CSP, HSTS, Referrer-Policy, Permissions-Policy at hosting
- [ ] Add moderation/guardrails for LLM inputs/outputs
- [ ] Enable dependency scanning and CI security gates
- [ ] Document data handling and privacy disclosures

---

Prepared by: Junie (JetBrains Autonomous Programmer)
