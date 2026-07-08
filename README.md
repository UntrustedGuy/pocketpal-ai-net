<p align="center">
  <img src="https://raw.githubusercontent.com/UntrustedGuy/pocketpal-ai-net/main/assets/icon.png" width="120" alt="PocketPalNet App Icon">
</p>

<h1 align="center">PocketPalNet</h1>

<p align="center">
  <strong>A fork of <a href="https://github.com/a-ghorbani/pocketpal-ai">PocketPal AI</a> with internet search for local LLMs</strong>
</p>

---

## About This Fork

**PocketPalNet** is a fork of [PocketPal AI](https://github.com/a-ghorbani/pocketpal-ai) that adds one major capability: **internet access for local LLMs**, via a user-configurable [SearXNG](https://github.com/searxng/searxng) instance. Every other feature of PocketPal AI — offline chat, GGUF model management, Pals, HTML/math/datetime talents — works exactly as before. This fork simply adds a new `web_search` talent, so tool-calling-capable models running fully on-device can search the web when they need current information, while everything else about the model's execution stays completely local and private.

You control your own SearXNG instance — nothing is routed through any server operated by this project. The app just needs a URL pointing at an instance you run yourself.

### Requirements for web search to actually work
- A model with reliable tool/function-calling support in its chat template (e.g. Qwen2.5-Instruct family). Not all GGUF models support this — some will silently ignore the tool and answer from memory instead.
- A running SearXNG instance, reachable from your device, with JSON output format enabled.
- The `web_search` talent toggled on for the Pal you're using.

---

## Running Your Own SearXNG Instance on Android (Termux)

Since PocketPal is a mobile app, this section covers running SearXNG **directly on your Android device** via Termux — no PC, server, or Docker required. If you'd rather run SearXNG elsewhere (a PC, home server, or cloud VM), any standard SearXNG installation guide works fine too; the app just needs an HTTP URL pointing at it.

### 1. Install Termux
Get it from [F-Droid](https://f-droid.org/packages/com.termux/) (not the outdated Play Store version).

### 2. Set up Termux and install dependencies
```bash
pkg update && pkg upgrade
pkg install python git build-essential libxml2 libxslt rust
```

### 3. Clone and install SearXNG
```bash
cd ~
git clone https://github.com/searxng/searxng.git
cd searxng
python -m venv venv
source venv/bin/activate
pip install -U pip setuptools wheel pyyaml
pip install msgspec
pip install --no-build-isolation -r requirements.txt
pip install --no-build-isolation -e .
```

### 4. Configure SearXNG
Generate a secret key:
```bash
python -c "import secrets; print(secrets.token_hex(16))"
```

Edit the settings file:
```bash
nano searx/settings.yml
```
- Find `secret_key: "ultrasecretkey"` and replace the value with the key you just generated.
- Find the `formats:` section and add `json` so it reads:
  ```yaml
  formats:
      - html
      - json
  ```
Save with `Ctrl+O`, `Enter`, then exit with `Ctrl+X`.

### 5. Run the server
```bash
python searx/webapp.py
```

By default this serves on `http://127.0.0.1:8888`. Keep this Termux session running in the background whenever you want web search to work — disable battery optimization for Termux (Settings → Apps → Termux → Battery → Unrestricted) so Android doesn't kill the process.

### 6. Point the app at it
In PocketPalNet: **Settings → Web Search**, enter:
```
http://127.0.0.1:8888
```

This was made with my half backed knowledge on programming and claude ai
