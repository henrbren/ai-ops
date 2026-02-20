# Workflows (v1)

## Shipping workflow
1. **Event/Issue** created (bug/feature)
2. **Triage** adds:
   - reproduction / spec
   - acceptance criteria
   - priority
3. **Implement**: branch + PR
4. **Review**: adversarial check + approve/request changes
5. **Merge** (when gates pass)
6. **Release queue**: merged commits labeled `release:queued`
7. **Batch submit**: Thu 15:00 Oslo runs EAS build/submit for queued commits
8. **Post-release**: link build ids + release notes; monitor; rollback plan

## Leads workflow
1. **Signal** → lead card issue
2. **Evidence** attached (why now)
3. **Outreach** email sent (rate-limited)
4. **Follow-up** scheduled
5. **Stop intent** → add to DNC and close loop
