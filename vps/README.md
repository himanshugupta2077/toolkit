# Toolkit on the VPS

Finance Node stays as it is (`finance.service` on `127.0.0.1:8787`).
Toolkit FastAPI is a **second** unit on `127.0.0.1:8000`.
Tailscale Serve puts the phone on one hostname:

- `https://toolkit.tailf7a628.ts.net/` → toolkit home
- `https://toolkit.tailf7a628.ts.net/voice/` → voice notes (installable PWA)
- `https://toolkit.tailf7a628.ts.net/cfa/` → CFA readings tracker (installable PWA)
- `https://toolkit.tailf7a628.ts.net/finance/` → existing finance app
- `https://toolkit.tailf7a628.ts.net/pact/` → Pact override inbox (bound to one iPhone passkey)

`sudo toolkit-serve` sets the Tailscale hostname to `toolkit` (was `finance`). The old `https://finance.tailf7a628.ts.net/` URL stops working. Re-add the PWA from the new URL. Unix user `toolkit` and `finance.service` are unchanged.

## .env — do not copy the laptop file

Laptop `.env` is for Omarchy (may say `HOST=0.0.0.0`, `TOOLKIT_PROFILE=local`, CUDA Whisper). That would be wrong and dangerous here.

On the VPS create **`/etc/toolkit.env`** from `vps/env.vps.sample`, then **paste only the keys**:

```bash
sudo nano /etc/toolkit.env
```

Copy `OPENAI_API_KEY` and `DEEPSEEK_API_KEY` from the laptop `.env`. Leave every `HOST` / `TOOLKIT_PROFILE` / `FINANCE_OS` line as in the sample.

```
chmod 640, owner root:toolkit
systemd reads it via EnvironmentFile=
```

After changing keys: `sudo systemctl restart toolkit`.

## First install

On the laptop (this repo):

```bash
bash vps/push-stage.sh
```

On the VPS (sudo password):

```bash
sudo /home/toolkit/stage/toolkit/vps/bootstrap-toolkit.sh
sudo nano /etc/toolkit.env    # paste keys if still placeholders
sudo systemctl restart toolkit
```

Heart catalog (laptop, after bootstrap; no sudo):

```bash
bash vps/push-heart.sh
```

## Stop / restart

| What | Command |
|---|---|
| Restart toolkit | `sudo systemctl restart toolkit` |
| Stop toolkit | `sudo systemctl stop toolkit` |
| Start toolkit | `sudo systemctl start toolkit` |
| Restart finance only | `sudo systemctl restart finance` |
| Restore HTTPS paths | `sudo toolkit-serve` |
| Later code update | laptop `bash vps/push-stage.sh` then `sudo toolkit-deploy` |
| Heart catalog | laptop `bash vps/push-heart.sh` (no sudo; ~6 GiB `media/` + `results.jsonl`) |

`Ctrl+C` / `./run.sh` is laptop-only. The VPS uses systemd.

## Heart catalog

`push-stage.sh` / `toolkit-deploy` skip `heart/media/` and `heart/results.jsonl` (gitignored, large). Without a separate copy, `/heart` is an empty catalog.

From the laptop:

```bash
bash vps/push-heart.sh
```

That rsyncs into `/opt/toolkit/heart` (what FastAPI already reads). No restart. Re-run to sync new posts; it resumes.

## What is not on the VPS

- GPU Whisper (cloud `whisper-1` only)
- Laptop `data/` notes / food / CFA (starts empty; Heart **bookmarks** live here too until you add some on the phone)
- Live xlsx workbook (old `/old-finance` sheet writes stay on the laptop)
