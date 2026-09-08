# Atlas Now

An Obsidian panel for tasks by owner, quick task entry, inline answers to questions, unfinished notes, and workout sync into daily notes.

## Install with BRAT

1. Enable BRAT on the target device.
2. In BRAT settings, add the beta plugin `BBzay/atlas-now`.
3. This repository is public; no GitHub token is required for installation.
4. Enable **Atlas Now** in Obsidian's Community plugins settings, then run **Atlas Now: Open Atlas Now**.

Requires Obsidian 1.4.0 or newer. Review Atlas Now settings to match the target vault's paths. Installing the plugin does not copy your notes or settings between devices.

Questions appear one at a time. Press Enter or click Send to save and focus the next pending question; Shift+Enter inserts a newline. The section count shows the number still pending. Existing question parsing and answer attribution are preserved.

## Empty results or a new device

Update through BRAT, then disable and re-enable Atlas Now (or restart Obsidian). On mobile, run **Atlas Now: Open Atlas Now** to open its tab. Wait for your vault notes to sync, then click **Refresh** or run **Atlas Now: Refresh Atlas Now**.

The panel displays the vault name, scanned note count, checkbox task count, and unfinished-note count. Checkbox tasks and notes tagged `unfinished` are separate totals. Tasks are read from Markdown directly, including unassigned tasks and in-progress `[/]` tasks; checked tasks, fenced examples, HTML comments and ignored paths are excluded. The Me/AI/Together tabs filter by owner; All shows all checkbox tasks.

Version 0.2.2 fixes Windows CRLF parsing that could hide every task and question. Both Windows and Unix line endings work, and note scanning no longer depends on the metadata cache being ready.

Questions default to `Home/Questions for Boss.md`, with bullets under `## Open` (also `Pending` or `Unanswered`). The panel reports a missing question file instead of silently showing zero. Correct its path in Atlas Now settings if your vault uses another location. Plugin installation does not sync that file. Completed question checkboxes and questions with a Boss/Human answer are omitted from the pending queue.

## Validation

Run `node --check main.js` and `node test.cjs`. Tests use an in-memory Obsidian substitute; they never modify vault notes. Optional `node test.cjs /path/to/vault` performs a read-only scan of the original Atlas vault layout and prints aggregate counts, excluding Private, Reference, and hidden directories. Actual device UI and sync still require a device check.

## Package and releases

`main.js` is the existing bundled plugin implementation; the original TypeScript source was not present in the installed package. `manifest.json` and `styles.css` complete the installable package.

For updates, increment `manifest.json`'s version, update `versions.json`, commit the package, and publish a GitHub release whose tag exactly matches the version (without a `v` prefix). Attach `main.js`, `manifest.json`, and `styles.css` to the release. BRAT installs these release assets.
