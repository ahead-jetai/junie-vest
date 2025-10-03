# Junie Wealth Coach – Security Analysis Results

Date: 2025-10-03
Scope: Frontend repository (Vite + React + TypeScript)
Reviewer: Junie (JetBrains autonomous assistant)

## Executive Summary
Overall risk posture: Low-to-Medium for a frontend-only app. The most critical issue is the exposure of a long‑lived API key in the browser (Critical). Other findings are primarily best‑practice hardening items (CSP, security headers, dependency hygiene).

Top priorities:
1) Remove client-side secret usage and proxy OpenRouter calls through a backend. [Critical]
2) Add security headers (CSP, Referrer-Policy, Permissions-Policy, X-Content-Type-Options, X-Frame-Options) at the deploy edge. [High]
3) Establish supply‑chain hygiene: lockfile review, `npm audit`, dependency pinning/updates, automated PRs. [Medium]

## Methodology
- Manual inspection of project structure, code, and configs.
- Heuristic review of dependencies and scripts for supply‑chain risks.
- Static review for client-side injection, secret handling, and dangerous APIs.

Artifacts reviewed:
- package.json, vite.config.ts, tsconfig.*.json, eslint.config.js, index.html
- src/components/*, src/services/chatService.ts, tests

## Findings

### 1) Client-side secret usage (Critical)
File: src/services/chatService.ts
- The OpenRouter API key is read from `import.meta.env.VITE_OPENROUTER_API_KEY` and sent from the browser in the `Authorization: Bearer` header when calling `https://openrouter.ai/api/v1/chat/completions`.
- Any key embedded in a Vite `VITE_*` client env var is exposed to end users (build artifacts and network requests). This allows key theft, quota abuse, and impersonation.

Recommendation:
- Remove API key usage from the client. Create a minimal backend (e.g., serverless function) to:
  - Hold the secret server-side.
  - Enforce authentication/rate limiting/abuse detection.
  - Sanitize/validate requests and set model/temperature on the server, not the client.
  - Optionally add content filtering and logging with redaction.

### 2) Missing security headers and CSP (High)
File: index.html (and deploy config)
- No Content-Security-Policy (CSP) is present. While current code does not use `dangerouslySetInnerHTML`, third‑party scripts or future changes could enable XSS vectors.
- No additional headers: `Referrer-Policy`, `Permissions-Policy`, `X-Content-Type-Options`, `X-Frame-Options`/`Frame-Options`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`.

Recommendation:
- Configure at your web server/host (preferred) or via meta tags as a stopgap:
  - CSP example (tighten as needed):
    - default-src 'self';
    - img-src 'self' data:;
    - style-src 'self' 'unsafe-inline';
    - script-src 'self';
    - connect-src 'self' https://openrouter.ai; (or your backend domain once proxy is added)
    - base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  - Add headers:
    - Referrer-Policy: no-referrer
    - Permissions-Policy: camera=(), microphone=(), geolocation=()
    - X-Content-Type-Options: nosniff
    - X-Frame-Options: DENY (or frame-ancestors 'none' in CSP)
    - Cross-Origin-Opener-Policy: same-origin
    - Cross-Origin-Resource-Policy: same-origin

### 3) Dependency and supply-chain hygiene (Medium)
- package-lock.json is present, which is good for determinism.
- No postinstall/prepare scripts or suspicious lifecycle hooks identified in package.json.
- Dependencies appear modern (React 19.x, Vite 7.x). Even so, vulnerabilities can emerge.

Recommendation:
- Run `npm audit --production` and address advisories; consider `npm audit fix` where safe.
- Pin direct dependencies to exact versions (no carets) for reproducible builds; update via Renovate/Dependabot.
- Add a CI step for `npm audit --audit-level=high` and `npm dedupe`.
- Consider Sigstore provenance or npm package provenance verification when supported.

### 4) Dev server exposure (Low)
- Default Vite config does not explicitly restrict dev server host. While Vite defaults are typically safe (localhost), teams sometimes run `vite --host` in containers, which can expose dev endpoints.

Recommendation:
- Ensure dev usage remains local-only (no `--host` on untrusted networks). Use firewall/SSH tunnels if remote dev is needed.

### 5) Client-side injection review (Low)
- Components render user and model messages via JSX text nodes; React escapes by default, reducing XSS risk.
- No use of `dangerouslySetInnerHTML` found.
- External links are not present; if added later, use `rel="noopener noreferrer" target="_blank"`.

Recommendation:
- Keep messages as text-only; if future rich content is required, sanitize with a robust library (e.g., DOMPurify with strict config) and avoid HTML from untrusted sources.

### 6) Error handling and logging (Low)
- Console logs include API failure details; currently safe for dev, but avoid leaking tokens/PII.

Recommendation:
- Ensure production builds avoid verbose error details; consider a minimal telemetry strategy with redaction.

## Recommended Action Plan

Immediate (0–3 days):
- Remove client-side secret usage; implement a server-side proxy for OpenRouter.
- Add baseline security headers and CSP at the hosting layer.
- Run `npm audit`, pin versions, and enable Renovate/Dependabot.

Near term (1–2 weeks):
- Add e2e smoke tests to ensure headers are present in production (playwright/lighthouse CI).
- Add runtime monitoring for fetch failures and rate limiting at the proxy.

Longer term (ongoing):
- Threat model updates when adding features (file uploads, links, rich text).
- Periodic dependency review and SCA scanning in CI.

## Appendix A – Inventory

Key dependencies:
- react ^19.1.0, react-dom ^19.1.0
- vite ^7.0.4, @vitejs/plugin-react ^4.6.0
- vitest ^3.2.4 (+ @vitest/coverage-v8, @vitest/ui)
- eslint 9.x with typescript-eslint, react-hooks, react-refresh
- jsdom 26.x, testing-library suite

Scripts (no suspicious lifecycle hooks detected):
- dev, build, lint, preview, test, test:ui, test:run

## Notes
- This report is based on static analysis of the repository as of 2025-10-03.
- If deployment occurs behind a platform (e.g., Vercel/Netlify/S3+CDN), apply headers via platform config or an edge function.
