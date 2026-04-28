# /graphify (project-scoped skill)

Vendored from [safishamsi/graphify](https://github.com/safishamsi/graphify).

This skill is checked into the repo so anyone cloning `appbackendfelo`
gets `/graphify` available in Claude Code without a separate install
step. The CLI itself (`graphify`, `pip install graphifyy`) is still
required to actually run the pipeline.

## What it does

Turns any folder of files into a navigable knowledge graph with
community detection, an honest audit trail, and three outputs:

- `graph.html` — interactive graph (open in any browser)
- `graph.json` — GraphRAG-ready JSON
- `GRAPH_REPORT.md` — plain-language summary, god nodes, suggested questions

## How to install the CLI (one-time, per developer)

```bash
# Recommended — works on Mac and Linux with no PATH setup needed
uv tool install graphifyy && graphify install
# or with pipx
pipx install graphifyy && graphify install
# or plain pip
pip install graphifyy && graphify install
```

## How to use

In Claude Code, from this repo:

```
/graphify .                  # graph the whole backend
/graphify src/modules/coach  # graph just one module
/graphify --mode deep        # richer extraction
/graphify --update           # incremental, only re-process changed files
```

Outputs land in `graphify-out/` (gitignored).

## Why vendor it

The `SKILL.md` is the contract Claude Code reads. Vendoring it means:

- New devs cloning the repo see `/graphify` in their slash-command list
  without running `graphify install` first.
- Skill version is pinned to the repo — no drift between developers.

To update, copy a newer `SKILL.md` from
`~/.claude/skills/graphify/SKILL.md` (after running `graphify install`)
or fetch from the upstream repo.

## .graphifyignore

A repo-level `.graphifyignore` is included to skip `node_modules/`,
`dist/`, and the like.
