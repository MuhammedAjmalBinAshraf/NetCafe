# CHANGELOG

This folder tracks incremental changes made to NetCafe Manager after the v1 documentation milestone.

## Structure

Each feature addition, architectural change, or bug fix discovered after the initial release should be documented here as:

```
NNN-short-description.md
```

For example:
- `001-windows-qos-bandwidth-throttle.md`
- `002-linux-shell-lockdown.md`
- `003-receipt-printer-support.md`

## Template

Each file should follow this structure:

```markdown
# Feature / Change Title

## What Was Implemented
Brief description of the change.

## Why (Reasoning & Tradeoffs)
The decision rationale.

## Files Changed
- List of files modified

## NPM Dependencies Added / Removed
- Any package changes

## Evolution
Notes on how this may change in future versions.
```

## Archived Changelogs

All changelogs from the initial v1 development cycle are preserved in [`archived-v1/`](./archived-v1/).
See [`PRD-v1-archived.md`](../PRD-v1-archived.md) for the original planning document.
The current authoritative PRD is [`PRD.md`](../PRD.md).
