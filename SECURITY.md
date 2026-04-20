# Security Policy

## Supported versions

Security fixes are provided for the latest development branch and the most recent tagged release line only.

## Reporting a vulnerability

**Do not file public GitHub issues for security vulnerabilities.**

Please report vulnerabilities privately using one of the following channels:

- If the public repository has GitHub Security Advisories enabled, open a private advisory there.
- Email: `iamzhihuix@gmail.com`

Please include:

- A description of the issue
- Steps to reproduce or a proof of concept
- Impact and affected workflows
- Any suggested mitigation or patch

Initial acknowledgment target: **7 days**  
Patch or mitigation target after confirmation: **30 days**

## Security notes for users

- `skills-manage` is a local-first desktop app. It stores collections, scan results, app settings, and cached AI explanations in `~/.skillsmanage/db.sqlite`.
- Managed skill files remain in the directories you configure for each platform.
- If you configure a GitHub Personal Access Token or AI API key, it is stored locally in the app database so the app can reuse it later.
- Those locally stored credentials are **not encrypted at rest by the application**. Protect your operating-system account appropriately and prefer low-scope tokens.
- The app does **not** include analytics, crash reporting, or usage tracking.
- The app only makes outbound network requests when you explicitly use networked features such as marketplace sync/download, GitHub repository import, or AI explanation generation.
- AI explanation generation sends the selected skill content and prompt to the provider you configured in Settings.

## Do not paste real credentials in public

When filing issues or pull requests, always redact:

- API keys, access tokens, refresh tokens, and passwords
- Private keys and credential files
- JWTs or other tokens containing personally identifying information

Use placeholders such as `<REDACTED>` or `ghp_...REDACTED...`.
