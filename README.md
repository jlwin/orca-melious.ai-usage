# Melious Usage for Orca

An [Orca](https://orca.dev) plugin that puts your [Melious](https://melious.ai) usage in Orca's status bar: how much energy is left in your tank and what you've spent, refreshed in the background.

```
⚡ Melious 90% · €37.72
```

Hover for the details:

```
Melious · Basic
Energy: 90% left (230,288 of 256,000, ≈ €23.03)
Credits: €0.02
Billing period: 19.3% used · ≈ 195.2M tokens left · renews 12 Dec 2026 (in 18 d)

Last 30 days:
  Spend: €37.72 (today €2.45)
  Requests: 9,267
  Tokens: 901.1M in (856.6M cached) · 6.1M out
  Footprint: 37.3 kWh · 7.4 kg CO₂e
  Top model: glm-5.3-flash

Updated just now · click to refresh
```

Click the item to refresh right away.

## Install

**From this repository**

```bash
orca plugin install jlwin/orca-melious.ai-usage
```

**From a local folder** (for development)

1. Clone this repository.
2. In Orca, open **Settings → Plugins** (click **Turn on plugins** if needed) → **Development folders…** and add the folder.
3. Review the requested access and enable the plugin.

Requires Orca 1.4.248 or later.

## Set up

Open **Settings → Plugins → Melious Usage**:

| Setting | What it does |
| --- | --- |
| API key | A key from [melious.ai/account/api/keys](https://melious.ai/account/api/keys). The field is entry only: on the next refresh the key moves into Orca's encrypted secret store (macOS Keychain) and the field is cleared. |
| Spend period | Today, last 7 days or last 30 days (default). |
| Status bar shows | Energy left, spend, or both (default). |
| Refresh every | 1–60 minutes (default 5). |

No key in the settings? The plugin falls back to the `MELIOUS_API_KEY` environment variable, then to the login of the Melious CLI (`melious auth login`, stored in `~/.melious/credentials.json`).

To remove the stored key, run **Melious: Forget stored API key** from the command palette.

## Status bar states

| State | Text | Colour |
| --- | --- | --- |
| No key found | `Melious · no key` | neutral |
| Loaded | `Melious 90% · €37.72` | neutral; amber at ≤ 25% energy; red at ≤ 10% or when overdrawn |
| Refresh failed, earlier data cached | last values, error in the tooltip | unchanged |
| Refresh failed, nothing cached | `Melious · offline` | amber |

Failed refreshes back off (interval × 1, 2, 4 … up to 30 minutes) and honour `Retry-After` on rate limits.

## Where the numbers come from

Melious doesn't document a usage API. The plugin reads the same account endpoints the [usage page](https://melious.ai/account/usage) uses, authenticated with your API key as `Authorization: Bearer …`:

| Endpoint | Used for |
| --- | --- |
| `GET /v1/billing/balance` | energy left, tank size, credits, overdrawn flag |
| `GET /v1/billing/subscription` | plan name and status |
| `GET /v1/billing/subscription/token-estimate` | share of the billing period used, tokens left, renewal date |
| `GET /v1/account/usage?period=day\|week\|month` | spend, requests, tokens, energy footprint, top model |

Each endpoint is read on its own. If one fails, the others still show and the tooltip lists what's missing. Because these endpoints aren't official, Melious may change them; `src/api.ts` is the only file that would need updating.

Spend is the euro equivalent Melious reports. Energy points are converted at 10,000 points = €1.

## Privacy

- The key is sent only to `https://api.melious.ai`.
- It never appears in logs, tooltips or the cached report.
- The plugin stores nothing but the key (encrypted) and the last report (in Orca's plugin storage).

## Development

```bash
npm test                  # unit and worker tests (Node 22.18+ runs the TypeScript directly)
orca plugin types .       # writes Orca's typings to .orca/types for your editor
orca plugin validate .    # checks the manifest
orca plugin dev watch .   # loads the plugin, reloads on save, streams its logs
```

| File | Purpose |
| --- | --- |
| `src/main.ts` | worker entry: wiring, commands, settings changes |
| `src/api.ts` | Melious requests and response parsing |
| `src/view.ts` | status bar text, colour and tooltip |
| `src/credentials.ts` | where the API key comes from |
| `src/poller.ts` | refresh loop with backoff |
| `src/config.ts` | settings defaults and bounds |

## License

MIT
