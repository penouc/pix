# macOS Signing & Notarization

PiX ships outside the Mac App Store, so release builds need:

1. **Developer ID Application** code signing
2. **Apple notarization** (notarytool)
3. GitHub Release assets (DMG + ZIP + `latest-mac.yml`) for `electron-updater`

Local `pnpm package:dir` / `package:dmg` stay unsigned on purpose. Only the Release workflow signs and notarizes.

## Prerequisites

- Active [Apple Developer Program](https://developer.apple.com/programs/) membership
- Access to [Apple Developer Certificates](https://developer.apple.com/account/resources/certificates/list)
- Access to [App Store Connect → Users and Access → Integrations → Team Keys](https://appstoreconnect.apple.com/access/integrations/api)

## Step 2 — Developer ID Application certificate

### 2.1 Create a Certificate Signing Request (CSR)

On your Mac:

1. Open **Keychain Access** → menu **Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority…**
2. User Email: your Apple ID email
3. Common Name: e.g. `PiX Developer ID`
4. CA Email: leave empty
5. Select **Saved to disk**, continue, save `CertificateSigningRequest.certSigningRequest`

### 2.2 Create the certificate on Apple Developer

1. Open [Certificates](https://developer.apple.com/account/resources/certificates/list) → **+**
2. Choose **Developer ID Application** (under *Software*)
3. Continue → upload the CSR → download `developerID_application.cer`
4. Double-click the `.cer` to install it into **login** keychain

Verify:

```bash
security find-identity -v -p codesigning
```

You should see a line like:

```text
1) … "Developer ID Application: Your Name (TEAMIDXXXX)"
```

### 2.3 Export `.p12` for CI

1. In Keychain Access, find **Developer ID Application: …**
2. Right-click → **Export…** → format **Personal Information Exchange (.p12)**
3. Set a strong export password (you will need it as `CSC_KEY_PASSWORD`)
4. Save as e.g. `~/Desktop/pix-developer-id.p12`

Encode for GitHub Secrets:

```bash
base64 -i ~/Desktop/pix-developer-id.p12 | pbcopy
```

Paste the clipboard into GitHub secret `CSC_LINK`.

Set secret `CSC_KEY_PASSWORD` to the `.p12` export password.

> Keep the `.p12` and password offline. Do not commit them.

## Step 3 — App Store Connect API key (notarization)

Prefer an API key over Apple ID + app-specific password for CI.

1. Open [App Store Connect → Integrations → Team Keys](https://appstoreconnect.apple.com/access/integrations/api)
2. Click **Generate API Key** (or **+**)
3. Name: e.g. `PiX Notary`
4. Access: **Developer** or **App Manager**
5. Generate → download `AuthKey_XXXXXXXXXX.p8` **once** (Apple will not show it again)
6. Note:
   - **Issuer ID** (UUID at the top of the page) → `APPLE_API_ISSUER`
   - **Key ID** (10 chars on the key row) → `APPLE_API_KEY_ID`

Encode the `.p8` for GitHub:

```bash
base64 -i ~/Downloads/AuthKey_XXXXXXXXXX.p8 | pbcopy
```

Paste into secret `APPLE_API_KEY_BASE64`.

## GitHub Secrets checklist

Repo → **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `CSC_LINK` | base64 of `.p12` |
| `CSC_KEY_PASSWORD` | `.p12` export password |
| `APPLE_API_KEY_BASE64` | base64 of `.p8` |
| `APPLE_API_KEY_ID` | Key ID (10 chars) |
| `APPLE_API_ISSUER` | Issuer ID (UUID) |

After secrets are set, push a tag:

```bash
git tag v0.2.1
git push origin v0.2.1
```

The Release workflow will sign with Developer ID, notarize via notarytool, then upload DMG/ZIP/yml for auto-update.

## Local signed smoke (optional)

```bash
export CSC_LINK="$(base64 -i ~/Desktop/pix-developer-id.p12)"
export CSC_KEY_PASSWORD='…'
export APPLE_API_KEY="$HOME/Downloads/AuthKey_XXXXXXXXXX.p8"
export APPLE_API_KEY_ID='XXXXXXXXXX'
export APPLE_API_ISSUER='xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'

pnpm build
pnpm --filter @pi-desktop/desktop exec electron-builder \
  --mac dmg \
  --arm64 \
  --config electron-builder.yml \
  --publish never \
  --config.forceCodeSigning=true
```

## Auto-update after signing

`electron-updater` already checks GitHub Releases. Once release assets are signed + notarized:

1. Install a signed build from the Release
2. Publish a newer `v*` tag
3. In Settings → Updates, **Check for updates** (or wait for launch check)

Unsigned → signed upgrades may still hit Gatekeeper once; subsequent signed → signed updates should be seamless.
