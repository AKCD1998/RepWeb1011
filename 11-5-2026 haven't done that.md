# 11/5/2026 haven't done that

First reminder for next development session:

- Before merging `env/project-api-prefix-vars-20260509` into `main`, do a browser Network-tab smoke test on Deliver.
- Confirm `POST /api/rx1011/dispense` sends the expected payload.
- Confirm invalid Deliver payloads are blocked before POST with a clear validation message.
- Confirm product/lot/unit metadata can resolve `lines[].unitLevelId`.
- Check whether `REACTjs-Project/node_modules/.vite/deps/_metadata.json` should really be included before merge.

Current verification already done:

- `npm run ci` passed on 2026-05-11.
- Server syntax check passed.
- Vite production build passed.
- No backend dispense route/controller changes were found in the branch.

When this checklist is completed, rename this file to:

```text
11-5-2026 done that <date that it's done>.md
```

Use the completion date in the filename, for example:

```text
11-5-2026 done that 2026-05-11.md
```
