# Policies (v1)

## Messaging
- **iMessage:** whitelist-only. Never send iMessage to new contacts.
- **Email:** autonomous outbound allowed with:
  - rate limits (global daily + per-contact cooldown)
  - do-not-contact (DNC) list (absolute)
  - evidence required (“why now”, trigger, source)
  - auto-DNC on negative intent: stop / unsubscribe / no

## Shipping
- **LAFT store submits:** batched every **Thursday 15:00 Europe/Oslo**.
- **Medvandrerne:** development autonomy mode; no store submits until store-ready checklist completed.

## Merge gates
A PR is mergeable when:
- CI is green
- Reviewer approval recorded
- Risk is acceptable (automation-defined risk score)

## Audit
All actions should be traceable to:
- an issue/task id
- source event(s)
- artifacts (PR link, release build ids, sent message id)
