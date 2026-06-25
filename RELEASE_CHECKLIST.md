# ForgeFlow Local Release Checklist

Use this before uploading to GitHub or creating a downloadable zip.

## Required

- [ ] `npm test` passes.
- [ ] `npm run demo` generates `outputs/demo/today_plan.json`.
- [ ] `npm run release:build` creates `dist/forgeflow-local-v0.1.0`.
- [ ] The release folder starts with `./start.command` on macOS or `start.bat` on Windows.
- [ ] Browser opens `http://127.0.0.1:4173/outputs/forgeflow-p0b-decision-console.html`.
- [ ] Import happy-path orders and confirm today's plan.
- [ ] Import shortage-leadtime orders and confirm shortage enters pending.
- [ ] Test AI explanation with a valid provider key, or confirm the fallback rule explanation remains clear.

## Do Not Publish

- API keys
- `.env` files
- `*.sqlite`
- local state JSON files
- local logs
- private customer orders

## Product Boundary

ForgeFlow Local is not a cloud ERP or MES. It is a local production decision console:

```text
rules decide the plan
AI explains the plan
the user confirms production
```
