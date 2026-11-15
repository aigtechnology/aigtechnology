# AIG Technology — Mailjet Email Repair Report

Date: 15 November 2026 (IST)

## Exact root cause

The backend had no Mailjet email sender implementation and no email trigger after successful payment. The Mailjet variables existed in `config/backend.env`, but `backend/app/config.py` did not declare them, so Pydantic ignored them as extra environment variables. No order email module was imported or called by the payment verification, reconciliation, or Razorpay webhook paths.

This was not caused by the checkout form, Razorpay signature verification, database schema, or frontend.

## Files modified

- `backend/app/config.py`
- `backend/app/notifications.py` (new)
- `backend/app/main.py`
- `backend/.env.example`

No frontend, payment logic, database schema, authentication, or order-management behavior was redesigned.

## Changes made

- Added server-only Mailjet settings: API key, secret key, API URL, verified sender email/name, and team notification email.
- Added Mailjet REST API v3.1 sending using HTTP Basic Authentication.
- Added branded plain-text and HTML order confirmation content using the stored customer email and order data.
- Added separate customer/team messages with recipient de-duplication.
- Added error handling for HTTP failures, invalid responses, and missing configuration.
- Added logging of Mailjet statuses and message IDs without logging credentials.
- Triggered email sending only after a successful payment capture transition through:
  - mock development payment success;
  - Razorpay server-side verification/reconciliation;
  - Razorpay `payment.captured` webhook.
- Existing captured payments and duplicate webhooks do not send duplicate confirmations.

## Verification status

| Check | Status | Result |
|---|---|---|
| Mailjet environment variables load | PASS | Required settings loaded without exposing values. |
| Mailjet API authentication | PASS | Controlled API request was accepted by Mailjet. |
| Mailjet endpoint and payload | PASS | Mailjet v3.1 request returned accepted status. |
| Sender configuration | PASS | Mailjet accepted the configured sender in the controlled test. |
| Sender/domain dashboard verification | BLOCKED | Requires confirmation in the Mailjet account/domain dashboard; API acceptance alone is not proof of SPF/DKIM authentication. |
| Controlled test email API acceptance | PASS | One test message was accepted for the configured team/sender address. |
| Actual inbox receipt | NOT TESTED | Inbox/spam-folder access was not available to this audit. |
| Customer order email trigger | PASS | Code is wired to successful payment capture and duplicate-safe transition logic; no synthetic customer email was sent. |
| Team order email trigger | PASS | Same capture trigger sends to configured team address; no duplicate recipient is created when addresses match. |
| Existing email templates | NOT TESTED | No prior Mailjet templates existed in the restored codebase; the new content preserves AIG branding and order fields. |
| Backend startup after repair | PASS | Local API restarted and `/api/health` returned 200. |
| Regression tests | PASS | 14 backend tests passed. |

## Required external confirmation

In Mailjet, verify:

1. The sender email is active under **Senders & Domains**.
2. The domain has valid SPF and DKIM records.
3. The recipient inbox/spam folder receives the controlled test message.
4. Mailjet **Activity** shows the message as sent/delivered rather than bounced or blocked.

The implementation does not print or store Mailjet credentials in source code. Keep the existing server environment file private and restart the backend after changing any Mailjet setting.
