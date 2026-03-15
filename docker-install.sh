#!/usr/bin/env bash
#
# OpenClaw Gemini CLI Adapter - Docker Setup Entrypoint
#

set -euo pipefail

cd "$(dirname "$0")"

C_RESET='\033[0m'
C_CYAN='\033[36m'
C_GREEN='\033[32m'
C_YELLOW='\033[33m'
C_RED='\033[31m'
C_BOLD='\033[1m'
C_DIM='\033[2m'

echo -e "\n${C_BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}"
echo -e "${C_BOLD}🚀 OpenClaw Gemini CLI Adapter: Docker Installation${C_RESET}"
echo -e "${C_BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}\n"

# 1. Check Docker
if command -v docker >/dev/null 2>&1; then
    echo -e "  ${C_GREEN}✓ Docker is installed ($(docker --version))${C_RESET}"
else
    echo -e "  ${C_YELLOW}⚠ Docker is not installed. Installing...${C_RESET}"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        if command -v brew >/dev/null 2>&1; then
            echo -e "  ${C_CYAN}Installing Docker via Homebrew...${C_RESET}"
            brew install --cask docker
        else
            echo -e "  ${C_RED}⚠ Homebrew is not installed. Please install Docker Desktop manually: https://www.docker.com/products/docker-desktop/${C_RESET}"
            exit 1
        fi
    else
        echo -e "  ${C_CYAN}Downloading get.docker.com script...${C_RESET}"
        curl -fsSL https://get.docker.com -o get-docker.sh
        echo -e "  ${C_CYAN}Executing Docker installation...${C_RESET}"
        sudo sh get-docker.sh
        rm -f get-docker.sh
    fi
    echo -e "  ${C_GREEN}✓ Docker installation completed.${C_RESET}"
fi

# 1.5 Check Docker Daemon (WSL & macOS fix)
echo -e "\n  ${C_BOLD}Checking Docker daemon status...${C_RESET}"
DOCKER_CMD="docker"
if ! docker info >/dev/null 2>&1; then
    if [[ "$OSTYPE" == "linux-gnu"* ]] && sudo docker info >/dev/null 2>&1; then
        echo -e "  ${C_GREEN}✓ Docker daemon is running (using sudo for access).${C_RESET}"
        DOCKER_CMD="sudo docker"
    else
        echo -e "  ${C_YELLOW}⚠ Docker daemon appears to be stopped. Attempting to start it...${C_RESET}"
        
        if [[ "$OSTYPE" == "darwin"* ]]; then
            open -a Docker
            echo -e "  ${C_CYAN}Waiting for Docker Desktop to start...${C_RESET}"
            sleep 15
        elif [ -x "$(command -v systemctl)" ] && grep -q systemd /proc/1/comm 2>/dev/null; then
            sudo systemctl enable docker
            sudo systemctl start docker
            sleep 3
        else
            sudo service docker start
            sleep 3
        fi

        if ! $DOCKER_CMD info >/dev/null 2>&1; then
            # Re-check with sudo on Linux
            if [[ "$OSTYPE" == "linux-gnu"* ]] && sudo docker info >/dev/null 2>&1; then
                DOCKER_CMD="sudo docker"
            else
                echo -e "  ${C_RED}⚠ Failed to start Docker daemon. Please start Docker Desktop or the daemon manually.${C_RESET}"
                exit 1
            fi
        fi
        echo -e "  ${C_GREEN}✓ Docker daemon started successfully.${C_RESET}"
    fi
fi

# 1.6 Verify Docker Command
if [ -z "$DOCKER_CMD" ]; then
    echo -e "  ${C_RED}⚠ Docker command could not be resolved. Please ensure Docker is installed and the daemon is running.${C_RESET}"
    exit 1
fi

# 2. Check docker-compose plugin
if $DOCKER_CMD compose version >/dev/null 2>&1; then
    echo -e "  ${C_GREEN}✓ Docker Compose plugin is available${C_RESET}"
else
    echo -e "  ${C_RED}⚠ Docker Compose plugin not found. Please ensure it is installed.${C_RESET}"
    exit 1
fi

# 3. Add user to docker group if needed (Linux only)
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    USER_GROUPS=$(groups)
    if [[ $USER_GROUPS != *"docker"* ]]; then
        echo -e "\n  ${C_YELLOW}⚠ Current user is not in the 'docker' group.${C_RESET}"
        echo -e "  ${C_CYAN}Adding $USER to docker group...${C_RESET}"
        sudo usermod -aG docker "$USER"
        echo -e "\n  ${C_BOLD}${C_GREEN}✓ Added to docker group.${C_RESET}"
        echo -e "  ${C_BOLD}Applying group changes and proceeding slowly to avoid permission errors...${C_RESET}"
        echo -e "  ${C_DIM}(Note: Group changes take effect after relogin, using sudo for now.)${C_RESET}"
        sleep 2
    fi
fi

# 4. Tailscale Remote Access Setup (Host Level)
echo -e "\n  ${C_BOLD}Checking Tailscale for remote access...${C_RESET}"
if command -v tailscale >/dev/null 2>&1; then
    echo -e "  ${C_GREEN}✓ Tailscale is installed on host.${C_RESET}"
else
    read -p "  🌍 Install Tailscale for secure remote access? [y/N]: " ts_choice
    if [[ "$ts_choice" =~ ^[Yy]$ ]]; then
        echo -e "  ${C_CYAN}Installing Tailscale...${C_RESET}"
        if [[ "$OSTYPE" == "darwin"* ]]; then
            if command -v brew >/dev/null 2>&1; then
                brew install tailscale
                sudo tailscale up
            else
                echo -e "  ${C_RED}⚠ Homebrew not found. Please install Tailscale manually.${C_RESET}"
            fi
        else
            curl -fsSL https://tailscale.com/install.sh | sh
            # Check if systemd is actual init system (PID 1)
            if [ -x "$(command -v systemctl)" ] && grep -q systemd /proc/1/comm 2>/dev/null; then
                sudo systemctl enable --now tailscaled
            else
                sudo sh -c 'tailscaled > /dev/null 2>&1 &'
            fi
            sleep 3
            echo -e "  ${C_BOLD}Please authenticate Tailscale in your browser:${C_RESET}"
            sudo tailscale up
        fi
    else
        echo -e "  ${C_DIM}Tailscale setup skipped.${C_RESET}"
    fi
fi

# 4.5 Validate Tailscale MagicDNS (Required for Onboarding)
if command -v tailscale >/dev/null 2>&1; then
    echo -e "\n  ${C_BOLD}Checking Tailscale MagicDNS status...${C_RESET}"
    while true; do
        TS_STATUS=$(tailscale status --json 2>/dev/null || echo "{}")
        MAGIC_DNS=$(echo "$TS_STATUS" | jq -r '.CurrentTailnet.MagicDNSEnabled // .MagicDNSEnabled' 2>/dev/null)
        
        if [ "$MAGIC_DNS" == "true" ]; then
            echo -e "  ${C_GREEN}✓ MagicDNS is enabled.${C_RESET}"
            break
        else
            echo -e "\n  ${C_RED}⚠ MagicDNS が有効になっていません。${C_RESET}"
            echo -e "  モバイル連携（HTTPS）には MagicDNS が必須です。"
            echo -e "  Tailscale 管理画面で有効にしてください: ${C_CYAN}https://login.tailscale.com/admin/dns${C_RESET}"
            read -p "  有効化しましたか？ (Enterで再チェック, Ctrl+Cで中断): " _
        fi
    done
fi


# 5. Build and Run docker-setup.js inside a temporary container
echo -e "\n  ${C_BOLD}Building setup and production container...${C_RESET}"
# Use --network host to prevent WSL2 specific DNS/MTU docker bridge network timeouts
$DOCKER_CMD build --network host -t openclaw-gemini-adapter:latest -f Dockerfile .

echo -e "\n  ${C_BOLD}Proceeding to the authentication and workspace setup (Isolated Container Mode)...${C_RESET}"

# Capture Tailscale IP and Hostname to pass to the setup container
TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "")
TAILSCALE_HOSTNAME=$(tailscale status --json 2>/dev/null | jq -r '.Self.DNSName' | sed 's/\.$//' || echo "")

# Run container interactively, mounting current directory to allow setup scripts to write .env and .docker-config
# Network mode host allows localhost OAuth callbacks to reach the container
$DOCKER_CMD run -it --rm \
    --network host \
    -e TAILSCALE_IP="$TAILSCALE_IP" \
    -e TAILSCALE_HOSTNAME="$TAILSCALE_HOSTNAME" \
    -v "$(pwd):/app" \
    -w /app \
    openclaw-gemini-adapter:latest \
    node docker-setup.js

SETUP_EXIT_CODE=$?

if [ $SETUP_EXIT_CODE -eq 0 ]; then
    echo -e "\n${C_BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}"
    echo -e "${C_BOLD}🚀 Starting OpenClaw Gemini CLI Adapter Container...${C_RESET}"
    echo -e "${C_BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}\n"
    
    # 6. Start the actual production container (using the already built image)
    $DOCKER_CMD compose up -d
    
    if [ $? -eq 0 ]; then
        echo -e "\n  ${C_CYAN}⌛ サーバーの起動を待機しています...${C_RESET}"
        echo -e "  ${C_YELLOW}⚠ 初回起動や環境によっては、準備が整うまで数分かかる場合があります。${C_RESET}"
        
        # Wait for the dashboard (18789) to become available
        MAX_RETRIES=600
        RETRY_COUNT=0
        while ! curl -s http://localhost:18789 > /dev/null; do
            sleep 1
            RETRY_COUNT=$((RETRY_COUNT + 1))
            if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
                echo -e "  ${C_RED}⚠ サーバーの起動確認がタイムアウトしました。ログを確認してください。${C_RESET}"
                break
            fi
            # Show progress every 10 seconds to reduce noise during long wait
            if [ $((RETRY_COUNT % 10)) -eq 0 ]; then
                echo -e "  ${C_DIM}...まだ準備中です ( ${RETRY_COUNT}s / ${MAX_RETRIES}s )${C_RESET}"
            fi
        done

        echo -e "\n  ${C_BOLD}${C_GREEN}🎉 セットアップが正常に完了しました！${C_RESET}"
        
        # Ensure files created via sudo docker are owned by the current user
        if [ -d ".docker-config" ]; then
            sudo chown -R "$USER:$USER" .docker-config >/dev/null 2>&1 || true
        fi
        if [ -f ".env" ]; then
            sudo chown "$USER:$USER" .env >/dev/null 2>&1 || true
            # Also chown the workspace directory defined in .env
            WORKSPACE_PATH=$(grep "^HOST_WORKSPACE_DIR=" .env | cut -d'=' -f2)
            if [ -n "$WORKSPACE_PATH" ]; then
                # Expand ~ to $HOME
                WORKSPACE_PATH="${WORKSPACE_PATH//\~/$HOME}"
                if [ -d "$WORKSPACE_PATH" ]; then
                    sudo chown -R "$USER:$USER" "$WORKSPACE_PATH" >/dev/null 2>&1 || true
                fi
            fi
        fi

        # 7. Mobile Onboarding Guide & Auto-Pairing (Host side, after server is ready)
        export TAILSCALE_IP="$TAILSCALE_IP"
        export TAILSCALE_HOSTNAME="$TAILSCALE_HOSTNAME"
        # Run auto-pairing and mobile guide sequentially
        node -e "require('./scripts/setup/steps/07_autopair')().then(() => require('./scripts/setup/steps/06_mobile')()).catch(e => console.error(e))"

        echo -e "\n  ${C_BOLD}ダッシュボード: ${C_CYAN}http://localhost:18789${C_RESET}"
        
        # Display the actual Tailscale URL if available
        TS_DISPLAY_HOST="${TAILSCALE_HOSTNAME:-$TAILSCALE_IP}"
        if [ -n "$TS_DISPLAY_HOST" ]; then
            echo -e "  (Tailscale利用時: ${C_CYAN}https://${TS_DISPLAY_HOST}${C_RESET})"
        fi
        
        echo -e "\n  ${C_GREEN}✓ Container is now running in the background!${C_RESET}"
        echo -e "  To view logs: ${C_CYAN}$DOCKER_CMD logs -f openclaw-gemini-adapter${C_RESET}"
        
        echo -e "\n${C_BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}"
        echo -e "  ${C_YELLOW}⚠ 重要: グループ設定の反映について${C_RESET}"
        echo -e "  現在、一時的に sudo を使用してセットアップを完了しました。"
        echo -e "  今後 sudo なしで Docker を操作するためには、"
        echo -e "  一度${C_CYAN}ログアウトして再ログイン${C_RESET}するか、${C_CYAN}システムを再起動${C_RESET}してください。"
        echo -e "${C_BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}\n"
    else
        echo -e "\n  ${C_RED}⚠ Failed to start the container. Please check docker-compose output.${C_RESET}"
    fi
else
    echo -e "\n  ${C_RED}⚠ Setup was interrupted or failed. Aborting container start.${C_RESET}"
    exit $SETUP_EXIT_CODE
fi
