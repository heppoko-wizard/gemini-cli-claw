# Design Document: Tailscale Mobile Onboarding UX

## 1. Problem Statement
The current setup process successfully configures Tailscale remote access, but users must manually install the Tailscale app on their mobile devices and type the IP address to access the OpenClaw dashboard. This manual process is prone to errors and reduces the "magic" of a seamless remote setup.

## 2. Requirements
- Display QR codes for Tailscale mobile app installation (iOS & Android).
- Guide the user to log in with the same account used during setup.
- Pause the setup process until the user confirms they have installed and configured the mobile app.
- Display a final QR code that opens the OpenClaw dashboard with an auto-login token.
- Only show this flow if Tailscale remote access was enabled in the previous step.

## 3. Approach: Step-by-Step Interactive Onboarding
Create a new setup step (`scripts/setup/steps/06_mobile.js`) dedicated to mobile onboarding.

### Step 1: App Installation Prompts
- Generate two QR codes side-by-side (or sequentially) for the iOS App Store and Google Play Store Tailscale pages.
- Print clear instructions: "スマホで以下のQRをスキャンしてTailscaleをインストールし、先ほどと同じアカウントでログインしてください。"

### Step 2: Confirmation Gate
- Use the `select` or `pressEnter` prompt utility to halt progress.
- Prompt: "インストールとログインが完了しましたか？ [はい/スキップ]"

### Step 3: Dashboard Access QR
- If confirmed, generate and display a QR code for the dashboard URL: `http://<tailscale-ip>:18789?token=openclaw-docker-session`.
- Inform the user: "このQRコードをスキャンすると、パスワード不要でOpenClawダッシュボードにアクセスできます！"

## 4. Architecture
- **Dependency**: Add `qrcode` to `package.json`.
- **Integration**: Append `await require('./scripts/setup/steps/06_mobile')();` to the end of `docker-setup.js`.
- **Data Flow**: `06_mobile.js` reads `process.env.TAILSCALE_IP` and `TAILSCALE_HOSTNAME` to determine if remote access was requested and to construct the final URL.

## 5. Agent Team
- `coder`: Implements `06_mobile.js` and modifies `docker-setup.js` & `package.json`.
- `tester`: Validates the QR code generation and CLI rendering.

## 6. Risk Assessment & Mitigation
- **Risk**: QR codes may render poorly in some terminal emulators, making them unscannable.
- **Mitigation**: Use the `{ small: true }` option in the `qrcode` library, which uses Unicode block characters for a denser, more reliable output. Always provide the raw text URLs below the QR codes as a fallback.
- **Risk**: Terminal width may be too narrow for side-by-side QR codes.
- **Mitigation**: Render QR codes sequentially (top-to-bottom) rather than side-by-side to guarantee compatibility across window sizes.

## 7. Success Criteria
- The setup process presents visually distinct QR codes for Tailscale installation.
- The user is explicitly instructed about account parity.
- A final QR code grants instant access to the running container's UI.
- The flow gracefully handles users who choose to skip mobile setup.
