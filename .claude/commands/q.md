---
description: Ask a closed question about the repo — answered by a cheap subagent in one line
argument-hint: <a yes/no or one-fact question about this repo>
allowed-tools: Agent
---

Dispatch this question to the `quick` subagent, foreground, and relay its answer verbatim:

$ARGUMENTS

Add nothing. No context, no caveats, no follow-up offer. If the subagent answers
`Fuera de alcance:`, relay that line and ask whether to take it on properly.
