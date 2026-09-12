# Security policy

## Supported versions

The latest published version on npm gets fixes. While the package is pre-1.0,
patches land on the newest minor only.

## Reporting a vulnerability

Report privately through GitHub's
[security advisories](https://github.com/hcsum/acs-chat-inbox/security/advisories/new)
rather than in a public issue. Expect an acknowledgement within a week.

Useful in a report: the version, the smallest reproduction you have, and what
an attacker gets out of it.

## Scope

This package renders message previews as plain text: `stripHtml` in
`src/utils.ts` removes markup rather than trusting `dangerouslySetInnerHTML`,
so a message body should never reach the DOM as markup. A path that gets markup
rendered anyway is in scope.

Authentication, token handling, and anything about an Azure Communication
Services resource itself is out of scope here — the package never sees a token;
the consuming application owns the `AzureCommunicationTokenCredential`. Report
those to [Microsoft](https://msrc.microsoft.com/report).
