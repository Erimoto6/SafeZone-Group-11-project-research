# Gmail delivery test on Vercel

This is an isolated test service. Railway still handles every SafeZone feature. No app/database migration or Railway variable changes are needed. A successful mock test does not establish that Vercel can connect to Gmail: deploy and receive the actual test email first.

## Deploy from GitHub

1. In Vercel, create a project and import `Erimoto6/SafeZone-Group-11-project-research`.
2. Select the branch `Test-ni-eleyn` (also set it as the project's Production Branch if necessary).
3. Set **Root Directory** to `vercel-email-test`, **Framework Preset** to **Other**, and **Node.js** to **22.x**. Leave the build/output settings at their defaults; there is no frontend build command.
4. Add these environment variables for the deployment:

| Variable | Value |
|---|---|
| `GMAIL_USER` | `safezone.project0@gmail.com` |
| `GMAIL_APP_PASSWORD` | The App Password created for that Gmail account, not the regular Google password |
| `EMAIL_TEST_TO` | A Gmail inbox you control and will check for the test email |
| `EMAIL_TEST_SECRET` | A NEW random secret of at least 32 characters; do not reuse a JWT secret, Gmail password or admin code |

Generate the test secret locally with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Save it privately in Vercel; do not paste it into chat or commit it. Keep all credentials server-side.

5. Deploy and copy the production HTTPS address ending in `.vercel.app`. If the import initially deploys the wrong branch, correct Production Branch and deploy `Test-ni-eleyn` before testing.

## Send one test message

Pull this branch locally, then in PowerShell from the repository root run:

```powershell
& .\vercel-email-test\test-delivery.ps1 -DeploymentUrl "https://YOUR-PROJECT.vercel.app"
```

The script privately prompts for `EMAIL_TEST_SECRET`. It sends an authenticated POST to `/api/test-email`. Opening that path in a browser sends nothing and returns 405. Request payloads cannot choose email recipients or content. The endpoint only sends a fixed diagnostic email to `EMAIL_TEST_TO`.

If PowerShell blocks the script under your organization's execution policy, use an allowed local REST client with POST and an `Authorization: Bearer ...` header. Do not disable organization policy or share a command containing the actual secret.

On `ok: true`, check the recipient Inbox and Spam folder for **SafeZone email delivery test**. SMTP acceptance alone does not prove arrival. This message is not a password-reset/verification code.

- `401 Unauthorized` JSON: test secret doesn't match. HTML/login page: Vercel deployment protection intercepted the request; ensure you use the correct production deployment and check its protection settings.
- `503`: incomplete test configuration. Update the variables and redeploy.
- `502` with `EAUTH`: Gmail rejected authentication. Check sender account, App Password, Google security settings.
- `502` with `ETIMEDOUT`: SMTP connectivity failed from this deployment as well. Do not switch SafeZone's production delivery based on this result.
- Other `502`: inspect the function runtime logs; only safe error codes are logged.

Keep this as a temporary diagnostic endpoint. When testing is done, remove the Vercel project or disable the endpoint by removing `EMAIL_TEST_SECRET` and redeploying. Production code delivery is now available through the separate `/api/send-code` endpoint described below. Never add these secrets or call the mail function directly from the public SafeZone frontend.

## Local checks

`npm ci` then `npm test` inside this folder runs mocked SMTP tests. No real emails are sent by the test suite.

## Connect SafeZone after a successful delivery test

This folder now also contains `/api/send-code`. In Vercel add a NEW random `EMAIL_RELAY_SECRET` of at least 32 characters, alongside the existing `GMAIL_USER` and `GMAIL_APP_PASSWORD`, and deploy the latest `Test-ni-eleyn` commit. Test-only variables are not used by this endpoint. You may remove `EMAIL_TEST_SECRET` and redeploy to disable the old test endpoint once testing is complete.

In the Railway backend add `EMAIL_RELAY_URL=https://YOUR-PRODUCTION-PROJECT.vercel.app/api/send-code` and `EMAIL_RELAY_SECRET` with exactly the same new secret. Deploy Railway. The sender and App Password remain Vercel-only. See [Railway relay setup](../backend/README.md#railway-trial-vercel-https-email-relay).

Only trusted server requests with the shared secret can use the relay. It permits an SMTP readiness check or fixed recovery/reset code templates, not arbitrary email content, senders or multiple recipients. Request payloads and codes are not logged or returned. The Railway API enforces the user/account verification and request limits. Never call this endpoint from the app or expose its secret in client code. Vercel deployment protection must allow the Railway request to reach the handler; a Vercel login page is not the handler's JSON response.
