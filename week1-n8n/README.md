# Week 1 — n8n Daily Weather Briefing

`daily-briefing.json` is an n8n workflow that runs every day at 07:00 (schedule trigger),
fetches current weather for Gdansk from the OpenWeather API, and transforms the response in a
Code node that computes a `isCritical` flag plus a human-readable `reason` (freezing/heat,
high wind, strong gusts, thunderstorm, heavy rain, or snow). The result fans out to two
branches: every run is appended as a row to a Google Sheet (audit log), and an IF node checks
`isCritical` — when true, a "Send Email Alert" node emails a weather warning. `error-handler.json`
is a separate workflow triggered by n8n's Error Trigger; wired as the Daily Briefing's
Error Workflow, it emails a failure notification (workflow name, error message, failing node,
execution URL) whenever the briefing run fails.

Both notification nodes talk to Mailtrap's Email Sandbox over its HTTP API
(`POST https://sandbox.api.mailtrap.io/api/send/<inbox_id>`) rather than through n8n's
`Send Email` node. Outbound SMTP is blocked on the development machine: TCP connects on
ports 25/465/587/2525 are accepted by a middlebox but no server greeting ever arrives, so
`Send Email` fails with "Greeting never received". The Mailtrap HTTP API rides on 443 and
delivers into the same sandbox inbox. The API token is held in an n8n Header Auth credential
(`Api-Token` header) so it stays out of this repository.

Topology:

```
Every day 07:00 → Fetch Weather → Transform + Flag Critical ─┬─→ Log to Google Sheets
                                                             └─→ Is Critical? ──true──→ Send Email Alert

Error Handler:  On Workflow Error → Notify Failure
```

Credentials (Google Sheets OAuth2, Mailtrap Header Auth), the OpenWeather API key, and the
error-workflow wiring are configured in the n8n UI — see the top-level task checklist.
The Error Trigger does not fire on manual executions, so testing the error path requires
activating the workflow and letting a scheduled run fail.
