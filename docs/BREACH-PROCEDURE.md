# Breach procedure

What to do when a personal-data breach is suspected on Kehilot (lost or leaked credentials, data exposed to
the wrong people, unusual access). Roles are by function; keep names and contact details out of this file
(the repo is public). The platform owner leads; anyone who notices something tells the owner at once.

Kehilot is the processor; each Kehila is the controller of its members' data. Membership data can reveal
religion, so treat any exposure of it as serious.

## 1. Contain (first hour)

- Stop the cause. Rotate or disable what was exposed: IAM keys, the deployer role session, API secrets.
- Cognito: sign everyone out (`aws cognito-idp admin-user-global-sign-out` per user), or disable the app client
  (`aws cognito-idp update-user-pool-client` with sign-in flows removed) while the cause is fixed. Disable one user
  with `admin-disable-user`. Global sign-out does not invalidate ID tokens already issued; they stay valid for up
  to 15 minutes. For an immediate cut, stop the API (see the levers table).
- Keep evidence: do not delete logs, items or buckets. Save CloudTrail events and Lambda logs for the period
  (`aws cloudtrail lookup-events`, CloudWatch Logs export). Note exact times (UTC and Israel time).
- Do not restore or overwrite data yet. Where DynamoDB point-in-time recovery is enabled (35 days; off on dev),
  it can restore into a new table to compare with the live one; never restore over the live table without a
  decision recorded in the log.

## 2. Assess

- What data: emails, names, phones, family and children, messages, private blessings, images, consent records.
- Which Kehilot, and how many people in each.
- Whether membership data of a religious community, or children's data, is involved.
- Since when, until when, and whether the data was only exposed or also copied, changed or deleted.
- Is it still happening? If yes, go back to step 1.

## 3. Record

Open the log at the first suspicion and keep it outside the repo (a private document). Write every decision with
its time. Use the template below.

## 4. Notify

Decide with the facts from step 2 and record each decision, also a decision not to notify.

- The affected Kehilot (the controllers): without delay, with what happened, which data, which people, what was
  done, and what they should tell their members.
- The affected people: when there is a real risk to them, directly or through their Kehila.
- The Israeli Privacy Protection Authority: for a severe incident (the Privacy Protection Regulations on data
  security), as soon as the facts allow. Under the Israeli rules the database owner, that is the Kehila, reports
  to the Authority; Kehilot prepares the facts and helps.
- The EU supervisory authority: within 72 hours of becoming aware, where GDPR applies (EU residents among the
  people affected). The controller notifies; Kehilot helps it prepare.

## 5. Recover and learn

- Fix the root cause, rotate anything still shared, confirm with CloudTrail that access stopped.
- Add a test or a check where possible; update the privacy page and terms if facts about the service changed.
- Close the log with a short review: what happened, what worked, what changes.

## AWS levers

| Need | Lever |
|---|---|
| End all sessions | Cognito global sign-out per user (issued ID tokens live up to 15 minutes); or disable the app client |
| Block one account | `admin-disable-user` |
| Who did what | CloudTrail `lookup-events`; Lambda and API Gateway logs (IDs and counts only, no personal data) |
| Compare or recover data | PITR restore into a new table, where PITR is enabled (35 days) |
| Stop image access | Images are served only through 5-minute links; remove the bucket policy statement or the Lambda's S3 permission to stop them |
| Stop the API (immediate cut) | Throttle the API stage to zero, or detach the route integration |

## Log template

```
Incident log  (keep outside the repo)
Opened (UTC / Israel):
Opened by (role):
How noticed:

Timeline
  <time>  <what was seen or done>  <by role>

Containment actions and times:
Evidence saved (what, where):

Assessment
  Data involved:
  Kehilot affected / number of people:
  Religion-revealing membership data or children's data: yes / no
  Period of exposure:
  Still ongoing: yes / no

Notifications (decision, time, who, how)
  Kehilot:
  People:
  Israeli Privacy Protection Authority:
  EU authority (72 hours from awareness, if GDPR applies):

Root cause:
Fixes and follow-ups (owner role, due date):
Closed (UTC / Israel):
```
