# Atlas Now

An Obsidian panel for tasks by owner, quick task entry, inline answers to questions, unfinished notes, and workout sync into daily notes.

## Install with BRAT

1. Enable BRAT on the target device.
2. In BRAT settings, add the beta plugin `BBzay/atlas-now`.
3. This repository is private. Supply a GitHub token with read access to this repository in BRAT's private repository/token controls on each device if required. Never commit tokens to this repository.
4. Enable **Atlas Now** in Obsidian's Community plugins settings, then run **Atlas Now: Open Atlas Now**.

Requires Obsidian 1.4.0 or newer. Review Atlas Now settings to match the target vault's paths. Installing the plugin does not copy your notes or settings between devices.

## Package and releases

`main.js` is the existing bundled plugin implementation; the original TypeScript source was not present in the installed package. `manifest.json` and `styles.css` complete the installable package.

For updates, increment `manifest.json`'s version, update `versions.json`, commit the package, and publish a GitHub release whose tag exactly matches the version (without a `v` prefix). Attach `main.js`, `manifest.json`, and `styles.css` to the release. BRAT installs these release assets.
