### Junie Wealth Coach — Security Analysis Findings (sec-analysis-findings-1.md)

Date: 2025-10-06
Scope: Frontend React + Vite TypeScript application (no backend present in repo)
Reviewer: Junie by JetBrains

Overview
- The project is a client-side React app built with Vite. It renders a chat UI and calls OpenRouter’s chat completions API directly from the browser using a VITE_ environment variable for the API key.
- Good engineering hygiene: strict TypeScript, modern React, solid test setup, no use of dangerouslySetInnerHTML, and no dynamic eval.
- Primary risks stem from exposing a server-side secret (OpenRouter API key) to the client and a lack of security headers/CSP typically provided by a backend or host configuration.

Methodology
- Reviewed package.json, Vite/TS configs, HTML entry, React components, and chat service code.
- Looked for: XSS vectors, secret exposure, unsafe network calls, dependency/CI hardening gaps, and data exposure through logs.

Key Findings
1) Exposed API Secret in Client (High)
   - Evidence: src/services/chatService.ts reads import.meta.env.VITE_OPENROUTER_API_KEY and sends it in Authorization from the browser.
   - Risk: Any user with devtools (or by inspecting bundles or environment) can obtain the key. If leaked, the key can be abused for billable API traffic and impersonation.
   - Recommendation: Move OpenRouter calls server-side (own proxy or edge function). The browser should send only user input; the server adds the Authorization header using a secret stored server-side. Lock the server endpoint with authentication/rate limits.

2) Missing Content Security Policy (Medium)
   - Evidence: index.html lacks a CSP. Vite dev/preview do not inject CSP by default.
   - Risk: If any XSS is introduced later (e.g., via third‑party content, future features), absence of CSP increases impact (script execution, data exfiltration).
   - Recommendation: Serve app with a strict CSP header from the hosting platform. Suggested starting policy:
     - default-src 'self';
     - script-src 'self' 'nonce-<generated>';
     - style-src 'self' 'nonce-<generated>' 'unsafe-inline' (if needed temporarily);
     - img-src 'self' data:;
     - connect-src 'self' https://openrouter.ai; (or your proxy origin only);
     - frame-ancestors 'none';
     - base-uri 'self';
     - form-action 'self'.
     Avoid meta CSP if possible; prefer HTTP headers. Integrate nonces via your framework/host, or lock down with hashes when feasible.

3) Verbose Error Logging May Expose Sensitive Details (Low→Medium)
   - Evidence: chatService.ts logs response.status, statusText, and errorText for failed calls; also logs full errors for network failures.
   - Risk: In production, logs visible in the browser console could reveal implementation details or hints useful to an attacker; errorText might include upstream messages.
   - Recommendation: Gate verbose logs behind a development flag (e.g., if (import.meta.env.DEV) console.error(...)). In production, prefer minimal, user‑safe messages and server‑side logging.

4) Privacy/Origin Exposure via Custom Headers (Low)
   - Evidence: Adds HTTP-Referer: window.location.origin and X-Title headers to API request.
   - Risk: Leaks site origin to OpenRouter explicitly (which they may request), and additional metadata. Not a direct vulnerability, but consider privacy implications.
   - Recommendation: If using a server proxy, set only headers required by the upstream. Consider omitting/refining these headers from the client.

5) Dependency and Supply-Chain Hygiene (Advisory)
   - Evidence: Modern deps (React 19, Vite 7, Vitest 3). No audit script or automated update checks in repo.
   - Risk: Future vulnerabilities in dependencies could go unnoticed.
   - Recommendation: Add CI steps: npm audit --production (or use a security scanner), enable Dependabot/Renovate, and pin/lock versions via lockfile updates in CI. Consider Snyk/GitHub Security.

6) CSRF/Session Considerations (Forward-looking)
   - Evidence: Pure client → third‑party API; no same-origin cookies.
   - Risk: Low today. If you add your own backend later, re‑assess CSRF (SameSite cookies, CSRF tokens, double-submit).
   - Recommendation: Document security requirements for any future server (authn, CSRF protection, input validation, rate limiting, abuse controls).

7) Source Maps & Build Leakage (Advisory)
   - Evidence: No explicit build.sourcemap in vite.config.ts; Vite defaults to false in production.
   - Risk: If enabled later and publicly hosted, source maps can ease reverse‑engineering.
   - Recommendation: Keep production source maps disabled or upload privately (error tracking only).

8) XSS Review of Rendering (Informational)
   - Evidence: ChatMessage renders {message.text} inside a div without dangerouslySetInnerHTML.
   - Risk: React escapes by default; plain HTML in model output will render as text, not executable code.
   - Recommendation: Continue to avoid dangerouslySetInnerHTML. If rich content is needed later, sanitize with a robust library (DOMPurify) and strict allowlists.

9) Storage/Secrets in Repo (Informational)
   - Evidence: No .env in repo; API key expected at runtime via Vite env.
   - Risk: Low for accidental commit, but ensure local dev uses .env (excluded) and CI secrets.
   - Recommendation: Add .env.example with non‑secret placeholders and ensure .gitignore excludes .env.

Concrete Remediation Plan (Prioritized)
1. Implement a minimal server proxy for OpenRouter (e.g., serverless function) and remove VITE_OPENROUTER_API_KEY usage from the client. Store the key as a server secret; add rate limiting and input validation.
2. Add a CSP at the hosting layer with nonces; tighten connect-src to only your proxy. Add frame-ancestors 'none'.
3. Reduce production console logging; centralize error handling and redact upstream error bodies.
4. Enable automated dependency security: Dependabot/Renovate and CI npm audit; review monthly.
5. Provide .env.example and docs: how to set OPENROUTER_API_KEY in server env; remove VITE_ secret usage from client.
6. Add security test checklist in PR template (headers present, no dangerouslySetInnerHTML, no client secrets).

Validation Checklist
- [ ] API key absent from client bundle and network calls from browsers.
- [ ] CSP header present in production with strong defaults and correct connect-src.
- [ ] Production build shows minimal logs; errors handled gracefully.
- [ ] Dependency scanner active; no high‑severity issues outstanding.
- [ ] Docs updated; onboarding doesn’t leak secrets.

Notes
- Current code passes basic XSS scrutiny and uses strict TS settings. The most urgent issue is the client‑side API key exposure.
