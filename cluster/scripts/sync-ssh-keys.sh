#!/bin/bash
# Sync SSH keys from 1Password to Pulumi Config (securely)

set -e

echo "📦 Syncing SSH keys from 1Password to Pulumi Config..."

# Define the 1Password document IDs
TETHYS_KEY_ID="vog2euwiuugut6zwfykq5wyqze"
STYX_KEY_ID="usce4lpddwrw6yoq4pqikqhzqe"
CALYPSO_KEY_ID="cq6d2rxvgiskq54yj63dda355q"

# Fetch keys from 1Password and set in Pulumi config (as secrets)
echo "  → Fetching tethys SSH key..."
op document get $TETHYS_KEY_ID --vault Infrastructure | pulumi config set tethys_ssh_key --secret --

echo "  → Fetching styx SSH key..."
op document get $STYX_KEY_ID --vault Infrastructure | pulumi config set styx_ssh_key --secret --

echo "  → Fetching calypso SSH key..."
op document get $CALYPSO_KEY_ID --vault Infrastructure | pulumi config set calypso_ssh_key --secret --

echo "✅ SSH keys synced successfully!"
echo ""
echo "Note: Keys are stored encrypted in Pulumi config and fetched from 1Password at runtime."