---
name: weather
description: Check current weather conditions and forecasts for any location using the MET Norway API (api.met.no). Use when the user asks about weather, forecasts, temperature, rain, wind, or "what's the weather like?" Supports saved locations (home, work, etc.) and arbitrary coordinates.
---

# Weather Skill

## How It Works

Uses the free MET Norway Locationforecast 2.0 API — no API key needed.

## Quick Usage

**For saved locations:**
```bash
node ~/.pi/agent/skills/weather/get-weather.js home
node ~/.pi/agent/skills/weather/get-weather.js carbonara
node ~/.pi/agent/skills/weather/get-weather.js morgenstern
```

**For coordinates:**
```bash
node ~/.pi/agent/skills/weather/get-weather.js 59.9139 10.7522
```

## Saved Locations

Read `~/.pi/agent/skills/weather/locations.json` to see available named locations.

To add new locations, edit the file and add entries with `lat`, `lon`, and `address`.

## Handling Unknown Locations

If the user asks for weather in a city or address not in `locations.json`:

1. Use `web_search` to find the coordinates (e.g. "Oslo Norway latitude longitude")
2. Then call the script with lat/lon directly
3. Round coordinates to 4 decimal places max (API requirement)

## Output Format

**Current Weather:**
```
Weather in [Location]

Now: [Temperature]°C, [Conditions]
Humidity: [X]%
Wind: [Speed] m/s

Hourly Forecast:
HH:00 - [Temp]°C, [Conditions], [Precip]mm rain
...
```

## Smart Recommendations

Based on conditions, optionally suggest:
- "Bring an umbrella" (rain expected)
- "Dress warmly, feels like -X°C" (cold + wind)
- "Good day for outdoor activities" (clear, mild)

## Example Queries

- "What's the weather like?"
- "Weather at home"
- "Will it rain today?"
- "Weather forecast for Oslo"
- "What's the weather at Carbonara?"
- "Should I bring an umbrella?"

## Technical Details

- MET Weather API (api.met.no) — free, global coverage
- Proper caching with If-Modified-Since headers
- User-Agent set for API compliance
- Returns metric units (Celsius, m/s)
