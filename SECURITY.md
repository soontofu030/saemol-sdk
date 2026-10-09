# Security

This SDK runs on your server. Keep integration secrets, webhook signing secrets,
OAuth client secrets, and customer data out of browser bundles and public repositories.
Examples use environment variables and synthetic test data.

For a suspected vulnerability, use GitHub's
[private vulnerability reporting](https://github.com/soontofu030/saemol-sdk/security/advisories/new).
Do not include live credentials or customer records in public issues.
Revoke or rotate any credential that has been exposed.

Before contributing, run `npm run check:public`, `npm test`, and `npm run build`.
CI checks the complete Git history with Gitleaks and checks the npm file allowlist.
Local environment files, private keys, databases, logs, and internal reports are ignored.

To run the checks before every push, install [Gitleaks](https://github.com/gitleaks/gitleaks)
and run `git config --local core.hooksPath .githooks`. If Gitleaks is outside your PATH,
set `git config --local saemol.gitleaksPath /path/to/gitleaks`.

Secret scanning reduces accidental exposure; it does not validate whether a credential
has ever been used or copied elsewhere.
