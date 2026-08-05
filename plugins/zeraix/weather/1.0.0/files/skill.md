---
id: weather-reporting
name: Reporting weather
version: 1.0.0
author: zeraix
audience: user
scope: targeted
tags: [weather, forecast, open-meteo]
description: Answer weather questions accurately using the Open-Meteo public API — resolve ambiguous place names, respect units, and never state a forecast more precisely than the data supports.
allowedTools: [fetch_url, web_search]
---

# Reporting weather

Data comes from **Open-Meteo**, a public API with no account and no API key. Every request below is
a plain GET returning JSON, so `fetch_url` is all you need.

> **About this plugin's `weather_*` tools.** This plugin ships `weather_current`, `weather_forecast`
> and `weather_geocode`, but they are only registered when the host build supports plugin-provided
> tools — which most builds do not. **Do not call them.** If one is in your tool list you may use it;
> otherwise the URLs below return exactly the same data. Never announce a tool call that failed as
> though the data were unavailable.

## The two endpoints

**Geocode a place** — always do this first for a named place, to get coordinates:

```
https://geocoding-api.open-meteo.com/v1/search?name=Lisbon&count=5&format=json
```

**Current conditions**:

```
https://api.open-meteo.com/v1/forecast?latitude=38.72&longitude=-9.13&timezone=auto&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day
```

**Daily forecast** — set `forecast_days` to the span actually asked about, 1 to 16:

```
https://api.open-meteo.com/v1/forecast?latitude=38.72&longitude=-9.13&timezone=auto&forecast_days=7&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,sunrise,sunset
```

Units default to Celsius, km/h and mm. Override with `temperature_unit=fahrenheit`,
`wind_speed_unit=mph`, `precipitation_unit=inch`.

## Reading `weather_code`

The API returns a bare WMO integer. Translate it; never show the number:

`0` clear · `1` mainly clear · `2` partly cloudy · `3` overcast · `45`/`48` fog ·
`51`/`53`/`55` drizzle (light/moderate/dense) · `61`/`63`/`65` rain (slight/moderate/heavy) ·
`71`/`73`/`75` snowfall (slight/moderate/heavy) · `80`/`81`/`82` rain showers ·
`85`/`86` snow showers · `95` thunderstorm · `96`/`99` thunderstorm with hail

## Places

**Never silently pick between candidates.** There are Cambridges in England, Massachusetts, Ontario,
Maryland and Ohio, and answering for the wrong one is worse than asking. The geocoding response
returns every match with `country` and `admin1` — if the user gave no country or region and more than
one matched, say which you used and offer the alternatives.

Prefer coordinates when the user supplies them, and skip geocoding entirely.

## Units and time

Follow the user's units; if unstated, follow their locale rather than defaulting blindly —
Fahrenheit and mph for a US place, Celsius and km/h almost everywhere else. Always state the unit,
because "it'll be 25" is ambiguous in a way that matters.

With `timezone=auto`, times come back in the *location's* timezone, not the user's. Say "sunset 22:18
local" rather than converting silently.

## Honesty about forecasts

- Report `precipitation_probability_max` as the probability it is. "60% chance of rain" is honest;
  "it will rain" is not.
- A daily forecast is a daily aggregate and cannot answer "will it rain at 3pm". Say so rather than
  implying a resolution the data does not have. (For that, request `hourly=precipitation` instead.)
- Confidence falls off with distance. Beyond about seven days, describe the pattern, not the numbers.
- Report what the data says even when it is dull. A week of overcast is a useful answer.

## Answering

Lead with what was asked. A packing question wants "cold and wet, take a waterproof" with the figures
supporting it — not a table the user has to interpret. Give a table when they asked for data, prose
when they asked a question. Cite Open-Meteo as the source.
