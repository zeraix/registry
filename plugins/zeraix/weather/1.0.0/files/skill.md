---
id: weather-reporting
name: Reporting weather
version: 1.0.0
author: zeraix
audience: user
scope: targeted
tags: [weather, forecast, open-meteo]
description: Answer weather questions accurately — resolve ambiguous place names, respect the user's units, and never state a forecast more precisely than the data supports.
allowedTools: [weather_current, weather_forecast, weather_geocode]
---

# Reporting weather

Data comes from Open-Meteo. No account and no API key, so there is nothing to set up and nothing to
ask the user for.

## Choosing the call

- **"What's it like now?"** → `weather_current`.
- **"Will it rain this week?" / "What should I pack?"** → `weather_forecast`, with `days` set to the
  span actually asked about. Do not fetch 16 days to answer a question about tomorrow.
- **An ambiguous or unfamiliar place** → `weather_geocode` first, and let the user choose.

## Places

**Never silently pick between candidates.** There are Cambridges in England, Massachusetts, Ontario,
Maryland and Ohio, and answering for the wrong one is worse than asking. Both weather tools return
`ambiguous_matches` when the name matched more than one place — when that is present and the user
gave no country or region, say which one you used and offer the alternatives.

Prefer coordinates when the user supplies them; skip geocoding entirely.

## Units

Follow the user's units, and if unstated follow their locale rather than defaulting blindly —
Fahrenheit and mph for a US place, Celsius and km/h almost everywhere else. Always state the unit.
"It'll be 25" is ambiguous in a way that matters.

Times come back in the location's own timezone, not the user's. Say "sunset 22:18 local" rather than
converting silently.

## Honesty about forecasts

- Report `precipitation_probability` as the probability it is. "60% chance of rain" is honest;
  "it will rain" is not.
- A daily forecast is a daily aggregate. It cannot answer "will it rain at 3pm" — say so instead of
  implying the resolution exists.
- Confidence falls off with distance. Beyond about seven days, describe the pattern rather than the
  numbers.
- Report what the data says even when it is dull. A week of overcast is a useful answer.

## Answering

Lead with what was asked. A packing question wants "cold and wet, take a waterproof", with the
figures supporting it — not a table the user has to interpret. Give the table when the user asked for
data, prose when they asked a question.
