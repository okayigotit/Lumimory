# Lumimory (루미모리) — C.15 R4 · Lumiverse 1.2.5

**Spindle GitHub repository edition.** This repository contains exactly the same prebuilt extension runtime as the locally validated C.15 R4 package. Only the folder layout and installation documentation have changed.

## Installation (GitHub URL)
1. Upload **these files as repository files** (not the outer ZIP itself). `spindle.json` must be at the **repository root**, with `dist/backend.js` and `dist/frontend.js` in the `dist` directory.
2. Use a **public GitHub repository** for the first test (private repo authentication from the app has not been verified).
3. In the Lumiverse app, open **Spindle Panel → Add Extension → Install from Source** and enter `https://github.com/OWNER/REPO` (your actual repository URL).
4. Approve only expected permissions, enable, and first test on a disposable RP room. Backup existing chats and extension memory first.
5. Do not use a direct `*.zip` download URL or a GitHub `/tree/` subfolder URL. The app clones the root of a Git repository.

## Expected layout
```
spindle.json
README.md
dist/
  backend.js
  frontend.js
README_C15R4_KO.md
README_C15R4_HOST_KO.md
LICENSE.upstream-memory-library.txt
```

## Caveats
- Verified by source-level contract checks and simulated integration tests, **not** by installation inside the Android APK. The GitHub install path still requires live testing.
- The repository includes no chat history, credentials, or API keys. **Never commit them.**
- The host may reject unsafe prebuilt scripts, require a working `git` executable, or fail due to permissions/network. Capture the exact error if installation fails.
- Existing extension identifier: `lumi_integrated_memory_proto_a`; a duplicate installed extension with that identifier must be handled before reinstalling.
- Keep `dist/` files committed. The Lumiverse host determines prebuilt status using `git ls-files dist`; uploading only source or nesting everything under `data/extensions/...` will not work here.
- `package.json` is intentionally absent. Prebuilt dist is committed and does not need separate dependencies for this package.

## Important distinction
Local Import scans an existing server extension directory. Install from Source executes `git clone` on the URL and expects `spindle.json` at repository root.
