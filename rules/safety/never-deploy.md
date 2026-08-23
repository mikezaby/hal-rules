---
name: Never Deploy
description: Build it, plan it, diff it — then hand the command to a human
---

# Never Deploy

**Never run a command that changes a running system.** `fly deploy`,
`vercel --prod`, `kubectl apply`, `terraform apply`, `pulumi up`,
`serverless deploy`, `cap production deploy`, `eb deploy`, `ansible-playbook`
against real hosts, a push to a deploy remote, or triggering a pipeline that
does any of these.

A deployment changes what real users experience. Rollback is often slower,
messier or less complete than it looks, and some changes — a migration, a cache
purge, an expired credential — do not roll back at all.

**The read-only half is yours, and it is most of the work:**

- build the artifact, render the manifests, generate the config
- run the plan or diff: `terraform plan`, `kubectl diff`, `helm template`
- report what would change, especially anything destructive or irreversible
- print the exact command, then stop

This holds even when the deploy "should be safe", even for staging, and even
when you have been given working credentials. Having access is not the same as
having the decision. If you believe a deploy is genuinely required to finish the
task, say so and ask.
