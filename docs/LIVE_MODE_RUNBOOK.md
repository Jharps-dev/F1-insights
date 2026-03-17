# Live Mode Runbook

## What Was Added

Phase 2 live mode endpoints are now available in the API gateway:

- `GET /api/live/status`
- `POST /api/live/start`
- `POST /api/live/stop`

When live ingest is running, canonical events are appended to:

- `data/live_events_<sessionKey>.jsonl`

## Start Server With Local Toolchain

1. Create an env file:

```powershell
Copy-Item .env.example .env
```

2. Set your OpenF1 auth values in `.env` if required by your broker environment.

3. Start server:

```powershell
$env:PATH = "$PWD/.tools/node;$env:PATH"
$pnpmCmd = (Resolve-Path '.tools/node/pnpm.cmd').Path
$env:PORT = '3001'
& $pnpmCmd dev:server
```

## Start Live Ingest

```powershell
Invoke-WebRequest -UseBasicParsing -Method POST -ContentType 'application/json' -Body '{"sessionKey":9159}' 'http://localhost:3001/api/live/start'
```

## Check Status

```powershell
Invoke-WebRequest -UseBasicParsing 'http://localhost:3001/api/live/status'
```

Check fields:

- `hasAuthConfig` should be `true` when token or username/password is configured.
- `connected` should become `true` after successful MQTT connect.

## Stop Live Ingest

```powershell
Invoke-WebRequest -UseBasicParsing -Method POST 'http://localhost:3001/api/live/stop'
```

## Environment Variables

Optional but usually required for real OpenF1 live connectivity:

- `OPENF1_MQTT_URL` (default: `mqtts://mqtt.openf1.org:8883`)
- `OPENF1_AUTH_URL` (token endpoint, if required)
- `OPENF1_USERNAME`
- `OPENF1_PASSWORD`
- `OPENF1_ACCESS_TOKEN`
- `OPENF1_LIVE_SESSION_KEY` (default session key fallback)

## Troubleshooting

If `/api/live/status` shows `"lastError":"connack timeout"`:

1. Credentials/token may be required or invalid.
2. Corporate firewall may block outbound MQTT over TLS 8883.
3. MQTT broker/endpoint may be unavailable from current network.

Use replay mode while live credentials/network are being finalized.
