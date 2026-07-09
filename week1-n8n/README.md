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
publishing the workflow and letting a scheduled run fail.

The `errorWorkflow` setting is committed in `daily-briefing.json` rather than picked in the
UI. On n8n 2.29.8 the Settings → Error Workflow dropdown renders each option with
`:disabled="item.active === false"`, while `n8n-nodes-base.errorTrigger` sits in
`NON_ACTIVATABLE_TRIGGER_NODE_TYPES` — so an error-trigger-only workflow can never be
published, never becomes active, and can never be selected.

Setting `errorWorkflow` is necessary but not sufficient. `WorkflowExecutionService.loadErrorWorkflowData()`
resolves the error workflow through its `activeVersion` relation and returns `null` — silently,
with only a log line — when that relation is empty, so the handler never runs and no execution
row is created. Because an error-trigger-only workflow can never be published, its
`workflow_entity.activeVersionId` stays `NULL` forever. The fix applied here points that column
at the workflow's existing `workflow_history` row:

```sql
UPDATE workflow_entity
   SET activeVersionId = '<versionId from workflow_history>'
 WHERE id = 'wf-error-handler-0001';
```

`active` itself stays `0` — `loadErrorWorkflowData` checks only `activeVersion`, and
`executeErrorWorkflow` constructs the `Workflow` with `active: true` hard-coded. This lives in
the n8n database, not in the JSON, so it must be re-applied after a fresh import on n8n 2.29.8.
Verified end to end: a scheduled failure produced execution `mode=error, status=success` whose
`Notify Failure` node returned `{"success":true,"message_ids":[...]}` from Mailtrap.
