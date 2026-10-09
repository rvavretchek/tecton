# Tecton agent documentation guide

How AI agents write and maintain the documentation of a workspace built with Tecton:
`AGENTS.md` (instructions for agents) and `README.md` (the product, for people).

`tecton-admin new` creates short seeds of both files. They are placeholders, not documentation:
on your first task in the workspace, write them following this guide and replace the seeds.

## Who writes and in which language

- `AGENTS.md` and `README.md` are written and maintained **by agents only**. Developers ask an
  agent for changes instead of editing them by hand, so the structure below stays intact.
- Write them in the **language the developer chooses**. Ask once and keep using it. Code,
  identifiers and command output stay in English regardless.
- On every update, **preserve as much existing content as possible**: change what is wrong or
  outdated, add what is missing, never rewrite from scratch.
- No part of either file is locked against editing. Changes to `AGENTS.md` go through pull
  request review, like code.

## Structure of AGENTS.md

Use these sections, in this order. Section titles may be translated; the domains markers may not.

1. **Purpose**: one paragraph: what the system does and which system it is migrating from.
2. **Inviolable rules**: see below. Always present.
3. **Domains and dependencies**: the verifiable section described below.
4. **How to work here**: commands (`pnpm install`, `tecton-admin dev`, `tecton-admin lint`,
   tests), where each kind of code lives, conventions specific to this workspace.
5. **Decisions**: short log of decisions agents must respect, newest first, with dates.

### Inviolable rules

These rules apply to every agent in every task. They may be **extended, never removed or
weakened**:

- Never read or write another domain's database. Get data from another domain through its
  events (preferred) or its generated ServiceClient.
- Never edit the code of `@tecton/*` packages. They are versioned dependencies; propose a
  change upstream instead.
- Never turn off token verification, in any environment, including local development.

Add workspace-specific rules below these three when the developer asks for them.

### Domains and dependencies (verifiable)

Keep the list of domains and their synchronous dependencies between these exact markers, as
YAML. `tecton-admin lint` compares it with the manifests and warns when they diverge:

````markdown
<!-- tecton:domains:start -->
```yaml
domains:
  - name: leave
    dependencies: [directory]
  - name: billing
    dependencies: []
```
<!-- tecton:domains:end -->
````

Update it whenever a domain is generated, extracted, removed, or its `dependencies` change.
`tecton-admin generate domain` reminds you to do so.

## README.md

On your first task, **interview the developer** before writing: what the product does, who
uses it, which system it replaces or migrates from, how to run it, and who to ask about each
domain. Write the README for people (developers, operators), in the developer's language.
Keep agent instructions out of it; they belong in `AGENTS.md`.

When a domain is extracted from an existing system (`tecton-admin extract`), read that
system's README and bring over what is relevant to the extracted domain, asking the developer
when information is missing.
