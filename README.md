# Atlas Now

An Obsidian panel for a proportional day timeline, next actions, important updates, questions and instructions.

## Install and update

1. Enable BRAT on the device: obsidian://show-plugin?id=obsidian42-brat
2. In BRAT's Add beta plugin dialog enter https://github.com/BBzay/atlas-now
3. Enable Atlas Now under Community plugins, then run Atlas Now: Open Atlas Now.

Already installed? In BRAT settings check for updates, then reload the plugin or restart Obsidian. Version 0.7.5 is the current release. No GitHub token is required. BRAT installs the plugin; existing sync carries notes and planning files. Installing plugin files on a computer does not update a phone using BRAT until a GitHub release is published.

## Version 0.7.5

This release brings the improvements since 0.2.2 to BRAT clients: the day timeline, merged Next actions, contextual discussions, keyboard input, question navigation and mobile layouts. Enter saves an instruction or answer; Shift+Enter inserts a newline. Saving instructions queues work for the next agent session; it does not start a background agent.

Task scanning excludes backup snapshots and agent evidence. Checkbox updates use the current unique source ID, preserve concurrent edits and reject ambiguous or actively claimed tasks. Refreshes preserve drafts, focus and scroll, wait for active input, and retain unchanged content. Mobile checkbox labels provide 44px touch targets.

Requires Obsidian 1.4.0 or newer. Configure paths in Atlas Now settings to match your vault. Behavior and synthetic browser checks passed; installation and interaction on your actual phone remain separate acceptance checks.

## Development and delivery

Run node --check main.js and node test.cjs. With Playwright available, node browser-test.cjs <evidence-directory> checks responsive DOM behavior using synthetic notes. The readable main.js is the plugin source and distributable.

Update manifest.json and versions.json, commit the reviewed package, then push a tag matching the manifest version. The release workflow runs checks, publishes the three BRAT assets and compares public unauthenticated downloads against the package. Do not overwrite an existing release; fix forward with a new version. Public release verification does not establish phone installation.
