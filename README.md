# pi-prusa-cam

A lightweight camera streaming application for Prusa printers running on Raspberry Pi. Continuously captures and uploads snapshots to Prusa Connect.

## Features

- Auto-detects connected USB cameras
- Uploads snapshots to Prusa Connect at configurable intervals
- Minimal resource usage
- Easy setup on Raspberry Pi

## Installation

### Prerequisites

- Raspberry Pi 4B or newer (or any Linux x64/ARM64 system)
- USB camera connected to the Pi
- ffmpeg installed

### Install ffmpeg

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg
```

### Download and Extract

Download the latest release for your architecture:

- **ARM64** (Raspberry Pi 4/5): `pi-prusa-cam-arm64`
- **x64** (Intel/AMD Linux): `pi-prusa-cam-x64`

```bash
# For Raspberry Pi
wget https://github.com/tonyaellie/pi-prusa-cam/releases/download/latest/pi-prusa-cam-arm64
chmod +x pi-prusa-cam-arm64

# Move to a convenient location
sudo mv pi-prusa-cam-arm64 /usr/local/bin/pi-prusa-cam
```

## Usage

### Basic Usage

```bash
pi-prusa-cam <token> [camera-index] [interval-seconds]
```

**Arguments:**

- `token` (required): Your Prusa Connect camera token
- `camera-index` (optional): Camera index to use (default: 0). Run without args to see list.
- `interval-seconds` (optional): Upload interval in seconds (default: 30)

### Examples

```bash
# List available cameras and use first one, upload every 30 seconds
pi-prusa-cam YOUR_TOKEN

# Use camera index 1, upload every 15 seconds
pi-prusa-cam YOUR_TOKEN 1 15

# Use camera index 0, upload every 60 seconds
pi-prusa-cam YOUR_TOKEN 0 60
```

## Setup to Run Continuously

### Using systemd service

Create a systemd service file:

```bash
sudo nano /etc/systemd/system/pi-prusa-cam.service
```

Add the following content:

```ini
[Unit]
Description=Prusa Camera Streamer
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/pi-prusa-cam YOUR_TOKEN_HERE 0 30
Restart=on-failure
RestartSec=10
User=pi
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Replace `YOUR_TOKEN_HERE` with your actual Prusa Connect token.

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable pi-prusa-cam
sudo systemctl start pi-prusa-cam
```

Check status:

```bash
sudo systemctl status pi-prusa-cam
```

View logs:

```bash
sudo journalctl -u pi-prusa-cam -f
```

### Using cron

Alternatively, use cron for periodic execution. Edit crontab:

```bash
crontab -e
```

Add a line to run every minute (adjust as needed):

```cron
* * * * * /usr/local/bin/pi-prusa-cam YOUR_TOKEN_HERE 0 30 >> /tmp/pi-prusa-cam.log 2>&1
```

## Finding Your Camera Token

1. Log in to [Prusa Connect](https://connect.prusa3d.com)
2. Go to your printer settings
3. Navigate to the Camera section
4. If necessary create a new camera
5. Copy your camera token

## Troubleshooting

### No cameras found

```bash
# List available video devices
ls -la /dev/video*
```

If no devices appear, check if your camera is connected:

```bash
# List USB devices
lsusb
```

### Upload failures

Check the logs for error details:

```bash
# If using systemd
sudo journalctl -u pi-prusa-cam -n 50

# If running manually
pi-prusa-cam YOUR_TOKEN 2>&1 | tee cam.log
```

## Building from Source

```bash
# Install dependencies
bun install

# Build executables
bun build src/index.ts --compile --outfile pi-prusa-cam-linux-x64 --target bun-linux-x64
bun build src/index.ts --compile --outfile pi-prusa-cam-linux-arm64 --target bun-linux-arm64
```
