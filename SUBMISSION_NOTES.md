# Final Project — Submission Notes and Verification Checklist

**Project:** Weather Advisor Final Project, ITMO 444/544
**Student:** Bansari Yadav
**Prepared:** November 19, 2026

## What has been verified

- Live Weather and Advisor EC2 tiers reached healthy ALB targets during testing.
- Weather + Advisor produced Morning/Night reports, with NWS and Open-Meteo measurements and Gemini or labeled fallback guidance.
- Explicit report-page consent is implemented; generating the report itself does not email the user.
- Two approved real recipients received their own messages in separate tests: one Gmail recipient and one Illinois Tech recipient. SNS uses one topic per recipient and verifies exactly one confirmed subscriber before publishing.
- Node Weather suite: 18 passed. Node Advisor suite: 30 passed. Most recent Python selected unit suite: 30 passed, 28 deselected. **78 executed tests passed; do not count deselected tests as passes.**
- Shutdown: both named EC2 instances terminated, no ALB listed in `us-east-2`, both named ASGs `Desired=0`.
- Nonempty Python deployment entry scripts exist and deployment was carried out previously.

## What the uploaded review bundle proves and does not prove

**Inspected current files:** `weather-app/app.js`, `weather-app/report_builder.js`, `advisor-app/app.js`, `advisor-app/sns_email.js`, `stack/weather_runner.py`, `stack/weather_compute.py`, `stack/weather_config.py`, `stack/weather_iam.py`, `pytest.ini`, old docs.

The review bundle **does not include** the full `tests/` suite, package manifests, DynamoDB helpers, provider clients, evidence screenshots, AWS billing export or the professor's original final-project PDF. Claims about those artifacts are based on earlier observed project results rather than code inspection of those exact files. Do not treat this review as a new end-to-end test.

## Professor-facing coverage map

| Requirement area | Implementation/evidence | Submission state |
|---|---|---|
| Five-digit ZIP, date within seven days, clothing category, email | Advisor validation; Weather location-based date range | Implemented |
| Morning 6–12, Night 18–24 | `weather-app/report_builder.js`, `period_selector.js` | Implemented |
| Ten report rows | `advisor-app/app.js` `renderReport` | Implemented |
| NWS + Gemini, supplementary Open-Meteo | Weather clients and Gemini integration | Implemented; live report exercised |
| Generate first, send only after explicit consent | `/report` then `/send-report` | Implemented |
| Two recipients with no cross-delivery | `sns_email.js` dedicated topics and confirmation check; two live inboxes | Demonstrated for two preapproved users |
| SSM secret; IAM role boundaries; private artifacts | `weather_iam.py`, `weather_compute.py`; S3 artifact scheme | Implemented; verify screenshots before final hand-in |
| DynamoDB cache, TTL, rate-limit | Weather cache, short-lived Advisor reports, SNS send reservation | Source references checked; supplement with table screenshots |
| Python/boto3 deployment and teardown | `create_weather_stack.py`, `delete_weather_stack.py`, `stack/` | Demonstrated; backup files preserved |
| Failure fallback and resiliency | Gemini fallback, cache-error continuation, ASGs | Implemented; **current-version chaos metrics not independently supplied** |
| SLOs: cold <20s, cached <3s | Assignment target; request latency evidence missing from current bundle | **Needs measured evidence** |
| Tests | 18 + 30 + 30 = 78 passed; 28 excluded | Verified local selected runs |
| Cost below $2 | `budget.py` models scenario; actual Billing report not supplied | **Needs real AWS billed/estimated cost** |
| Architecture/15 choices/threat model/reflection | `FINAL_PROJECT_REPORT.md` | Draft prepared; review for accuracy |
| Public accessible demo URL | Former ALB removed to stop charges | **Not currently available**; coordinate temporary redeployment if required |

## Highest priority corrections before hand-in

1. **Use final project docs, not Lab05/Lab06 notes.** Replace only the root `README.md` and `SUBMISSION_NOTES.md` after retaining `previous_lab_docs` backups.
2. **Correct misleading UI line** in `advisor-app/app.js` report form. It currently says `This deployment supports the approved test recipient only.` Change to `This deployment supports two approved recipients with confirmed, separate SNS subscriptions.` This is a text-only adjustment; rebuild and redeploy only for a future live demonstration.
3. **Verify screenshots:** final two recipient inboxes, healthy targets, complete report, consent/send, test output and shutdown. If missing, do not claim screenshots exist.
4. **Add real cost evidence:** check AWS Billing/Cost Explorer and preserve a dated screenshot. The calculator uses assumed prices, not observed charges.
5. **Replace inherited integration/chaos tests** that target PostgreSQL or uploader/viewer; mark new live tests and do not run destructive tests when scaled down.
6. **Review current security limitations:** HTTP demo, known-recipient allowlist, unauthenticated request surface, hardcoded defaults, and secrets in local configuration.
7. **Package only active final-project files.** Exclude archived labs, original legacy reports, `.env`, credentials, `.venv`, `node_modules`, local caches, and old `stack_outputs.json` with inactive URLs.

## Suggested submission file structure

```text
Weather_Advisor_Final/
  README.md
  FINAL_PROJECT_REPORT.md
  SUBMISSION_NOTES.md
  budget.py
  requirements.txt
  pytest.ini
  create_weather_stack.py
  delete_weather_stack.py
  stack/
  weather-app/
  advisor-app/
  tests/unit/
  tests/integration/       # only if current/relevant and correctly marked
  tests/chaos/             # only if current/relevant and correctly marked
  final_evidence/          # screenshots after privacy check
```

The existing project contains other helper scripts; include any required ones after confirming they belong to the active deployment. Do not invent screenshot files or use old Lab06 PostgreSQL evidence as proof of the DynamoDB version.

## Presentation: ten-minute outline

- 0:00–1:00 — project requirements and user journey
- 1:00–3:00 — two-tier architecture, external APIs, IAM and SSM
- 3:00–5:00 — sample ten-row Morning/Night report and explicit email consent
- 5:00–6:30 — recipient isolation: two dedicated confirmed SNS topics
- 6:30–8:00 — tests, fault fallback, metrics and limitations
- 8:00–9:00 — budget/shutdown evidence
- 9:00–10:00 — lessons, design tradeoffs and questions

If the professor insists on a live public URL, a separate controlled redeployment will be required; the historical URL cannot work while AWS compute/ALB are shut down.
