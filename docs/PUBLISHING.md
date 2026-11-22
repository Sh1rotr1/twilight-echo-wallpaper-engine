# Publishing to GitHub

Twilight Echo's official plugin guide expects a **public GitHub repository**, a validated `.tep` release asset, and the `twilight-echo-plugin` topic.

Reference:

- https://github.com/Px-asen/Twilight_Echo/blob/Pxasen/docs/PLUGIN_README.md
- https://github.com/Px-asen/Twilight-Echo-plugins

## 1. Create the repository

Create an empty public repository on GitHub, for example:

```text
twilight-echo-wallpaper-engine
```

Do not initialize it with a README, .gitignore, or license. This repository already has them.

## 2. Set the repository URL in the manifest

Edit `plugin.json` and add the exact URL, without a trailing slash:

```json
"repository": "https://github.com/<your-name>/twilight-echo-wallpaper-engine"
```

Commit the change:

```powershell
git add plugin.json
git commit -m "Add repository metadata"
```

## 3. Push

```powershell
git remote add origin https://github.com/<your-name>/twilight-echo-wallpaper-engine.git
git branch -M main
git push -u origin main
```

Authentication uses Git Credential Manager or a GitHub Personal Access Token. Do not use the account password.

## 4. Build the .tep with the official CLI

Clone the Twilight Echo source and run its packer from this repository:

```powershell
git clone --branch Pxasen https://github.com/Px-asen/Twilight_Echo.git ..\Twilight_Echo
node ..\Twilight_Echo\packages\create-twilight-plugin\bin\create-twilight-plugin.cjs pack . --out dist
```

Output:

```text
dist/com.twilightecho.tool.wallpaper-engine-3.0.0.tep
```

The official packer validates `plugin.json`, requires a JS `main`, and excludes `node_modules`, `.git`, and `dist`.

## 5. Create a release

Create a GitHub Release:

```text
Tag: v3.0.0
Title: 3.0.0
```

The release body is read from:

```text
docs/releases/v3.0.0.md
```

Write the actual update content there before tagging. Do not rely on auto-generated "Full Changelog" text.

Attach exactly one file:

```text
com.twilightecho.tool.wallpaper-engine-3.0.0.tep
```

Do not attach several `.tep` files.

## 6. Add the topic

In the repository settings, add:

```text
twilight-echo-plugin
```

The community discovery workflow scans repositories with this topic about every six hours and adds valid packages to:

```text
https://github.com/Px-asen/Twilight-Echo-plugins/blob/main/plugins.json
```

## 7. Updating

1. Increment `version` in `plugin.json`.
2. Commit.
3. Pack a new `.tep`.
4. Create a new Release with the new tag and one `.tep`.
5. Never replace a published version with different bytes; publish a new version instead.

## 8. Important boundary

The plugin package itself must not modify Twilight Echo's application files.

3.0.1 removed the host bridge patch tooling entirely. The release `.tep` only installs the plugin into
`userData/plugins/<id>/<version>/`. At activation the plugin reads the host's
`out/renderer/we-background.js` version and requires the official v5 bridge.
Twilight Echo 2.0.2 ships this bridge; no host change is needed.
