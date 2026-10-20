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
dist/com.twilightecho.tool.wallpaper-engine-1.0.2.tep
```

The official packer validates `plugin.json`, requires a JS `main`, and excludes `node_modules`, `.git`, and `dist`.

## 5. Create a release

Create a GitHub Release:

```text
Tag: v1.0.2
Title: 1.0.2
```

The release body is read from:

```text
docs/releases/v1.0.2.md
```

Write the actual update content there before tagging. Do not rely on auto-generated "Full Changelog" text.

Attach exactly one file:

```text
com.twilightecho.tool.wallpaper-engine-1.0.2.tep
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

This repository includes `bridge/we-background.js` and `bridge/install.mjs` as development/reference material. The release `.tep` installs the plugin into `userData/plugins/<id>/<version>/`; the renderer bridge must be integrated by the Twilight Echo maintainer, as described in `docs/TE-PATCH.md`.

Users installing only the `.tep` will get the plugin and its HTTP service, but the background layer appears only after the host includes the bridge.
