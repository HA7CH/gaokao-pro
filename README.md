# gaokao-pro

China gaokao college planner — from your terminal.

```bash
npx gaokao-pro@latest school 31
npx gaokao-pro@latest plan 31 --year 2024 --province henan
npx gaokao-pro@latest scores 31 --province henan
```

No signup, no token, no backend. The CLI talks straight to
`static-data.gaokao.cn` (the 中国教育在线 / 掌上高考 static JSON tier) and
prints JSON. Pipe it into `jq`, Claude Code, anything.

## Status

🚧 v0.0.1 — early scaffold. Working verbs: `school` · `plan` · `scores` · `provinces`.
Coming: `recommend` (score+province+subjects → 冲稳保 list), 31 省考试院
fallback adapters for 一分一段表, MCP server, Claude Code plugin.

## Why

Existing tools (夸克高考, 百度AI高考, 优志愿, 掌上高考 App) are App-only,
black-box, and either pay-walled or ad-supported. We want the same data in
the terminal so a parent + Claude Code can plan together — auditable,
scriptable, free.

See [docs/](./docs/) for the data-source research, schema notes, and
endpoint inventory.

## Develop

```bash
pnpm install
pnpm -C cli dev school 31              # run via tsx
pnpm -C cli test                       # smoke test against live API
pnpm -C cli probe -- --start 1 --end 50   # build school-id index
pnpm -C cli build                      # tsc → dist/
```

## License

MIT.
