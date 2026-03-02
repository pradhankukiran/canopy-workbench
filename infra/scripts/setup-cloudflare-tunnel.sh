#!/usr/bin/env bash
# -------------------------------------------------------------------
# setup-cloudflare-tunnel.sh
#
# Installs cloudflared and sets up a quick tunnel as a systemd service.
# No Cloudflare account or login required.
#
# The tunnel proxies HTTPS traffic to localhost:3001 (the API).
# The assigned *.trycloudflare.com URL is printed at the end —
# set it as VITE_API_BASE_URL in the Vercel dashboard.
#
# Usage:
#   sudo ./setup-cloudflare-tunnel.sh
# -------------------------------------------------------------------
set -euo pipefail

INGRESS_TARGET="http://localhost:3001"
SERVICE_NAME="cloudflared-tunnel"

# ── 1. Install cloudflared ─────────────────────────────────────
install_cloudflared() {
  if command -v cloudflared &>/dev/null; then
    echo "cloudflared already installed: $(cloudflared --version)"
    return
  fi

  echo "Installing cloudflared..."
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
    | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null

  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" \
    | tee /etc/apt/sources.list.d/cloudflared.list

  apt-get update && apt-get install -y cloudflared
  echo "Installed: $(cloudflared --version)"
}

# ── 2. Create systemd service ─────────────────────────────────
install_service() {
  echo "Creating systemd service: $SERVICE_NAME"

  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Cloudflare Quick Tunnel (canopy-workbench)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/cloudflared tunnel --url ${INGRESS_TARGET}
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
  systemctl start "$SERVICE_NAME"

  echo "Service started."
}

# ── 3. Extract and print the tunnel URL ────────────────────────
print_tunnel_url() {
  echo ""
  echo "Waiting for tunnel URL..."
  sleep 5

  local url
  url=$(journalctl -u "$SERVICE_NAME" --no-pager -n 20 2>/dev/null \
    | grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' \
    | head -1) || true

  if [ -n "$url" ]; then
    echo ""
    echo "======================================================="
    echo "  Tunnel URL: $url"
    echo "======================================================="
    echo ""
    echo "Set this as VITE_API_BASE_URL in the Vercel dashboard."
  else
    echo ""
    echo "Could not extract URL yet. Check logs with:"
    echo "  journalctl -u $SERVICE_NAME -f"
  fi
}

# ── Main ──────────────────────────────────────────────────────
main() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: Run this script as root (sudo)."
    exit 1
  fi

  echo "Setting up Cloudflare quick tunnel → $INGRESS_TARGET"
  echo ""

  install_cloudflared
  install_service
  print_tunnel_url
}

main
