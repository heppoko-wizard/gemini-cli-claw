# Design Document: Tailscale Serve & Seamless Mobile Onboarding

## 1. Problem Statement
Users face significant friction when setting up OpenClaw for remote access via Tailscale. The primary obstacles are:
- Browser "Secure Context" restrictions preventing device key generation on HTTP connections.
- Manual device pairing/approval required during the first mobile access.
- Invalid configuration keys causing OpenClaw startup failures.

## 2. Requirements
- **Enforced HTTPS**: Use Tailscale Serve to provide a valid TLS certificate and MagicDNS URL.
- **Strict Pre-checks**: Verify MagicDNS/HTTPS settings before proceeding with setup.
- **Auto-Approval Window**: Automatically approve device pairing requests during the initial setup phase.
- **Connectivity Assurance**: Confirm HTTPS URL is reachable before displaying the final QR code.
- **Schema Compliance**: Adhere strictly to OpenClaw v2026.3.13 Zod schema.

## 3. Approach
### 3.1 Environment & Infrastructure
- Modify `docker-compose.yml` to mount the Tailscale socket (`/var/run/tailscale/tailscaled.sock`) into the container. This allows the OpenClaw process to interact directly with the Tailscale daemon for "Serve" functionality.
- Update `docker-install.sh` to strictly validate MagicDNS status via `tailscale status --json`.

### 3.2 Configuration Generation
- Update `scripts/setup/steps/01_config.js` to set `gateway.tailscale.mode: "serve"` and `gateway.bind: "loopback"`.
- Ensure all legacy/invalid keys like `secret` or `sessionKey` under `gateway.auth` are removed.

### 3.3 Interactive Onboarding
- **Wait for TLS**: Implement a retry loop in `scripts/setup/steps/06_mobile.js` that pings the HTTPS URL until a successful response is received.
- **Auto-Pairing**: Create `scripts/setup/steps/07_autopair.js` to poll `openclaw devices list --json` and approve pending devices automatically until the user signals completion.

## 4. Architecture
- **Host Socket**: `/var/run/tailscale/tailscaled.sock` (Mount)
- **Container Path**: `/var/run/tailscale/tailscaled.sock`
- **Logic Orchestrator**: `docker-setup.js` calling steps 00-07.

## 5. Agent Team
- `devops_engineer`: Infrastructure (Docker Compose, Tailscale Socket).
- `coder`: Logic (Setup steps, Auto-pairing script, HTTPS verification).
- `tester`: Validation (End-to-end connectivity simulation).

## 6. Risk Assessment & Mitigation
- **Risk**: Tailscale not installed or socket path differs.
- **Mitigation**: Add host-side existence check for the socket in `docker-install.sh`.
- **Risk**: User never approves pairing.
- **Mitigation**: Use an interactive prompt ("Waiting for pairing...") that allows the user to skip or retry.

## 7. Success Criteria
- OpenClaw starts successfully without schema errors.
- Tailscale Serve provides a `https://...` URL.
- Mobile devices can log in via QR code without manual terminal commands for approval.
