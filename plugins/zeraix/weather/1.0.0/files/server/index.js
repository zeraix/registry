#!/usr/bin/env node
/**
 * Weather, from the Open-Meteo public API, exposed over MCP stdio.
 *
 * Declared by providers.openmeteo: kind "mcp-stdio", tier "sandboxed", entry "server/index.js". The
 * registry hashes this file and the endpoint pins the digest in the index, so the bytes that run are
 * the bytes that were reviewed.
 *
 * ZERO DEPENDENCIES and no API key. Open-Meteo's free tier needs no account, which is why the
 * manifest declares no `needs`: there is nothing to prompt the user for, so installing this asks for
 * network access to two hosts and nothing else. It never touches the filesystem, and the manifest
 * grants it none.
 *
 * Read-only in every sense: it issues GETs and returns what came back.
 */
import { createInterface } from "node:readline";

const GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST = "https://api.open-meteo.com/v1/forecast";
/** A weather call is a page load, not a job. Past this the user is better told it failed. */
const TIMEOUT_MS = 15_000;

/* ------------------------------------------------------------------ http */

async function getJson(url, params) {
  const target = new URL(url);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") target.searchParams.set(k, String(v));
  }
  let res;
  try {
    res = await fetch(target, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
  } catch (e) {
    // A DNS failure, a refused connection and a timeout all land here, and none of them are the
    // caller's fault. Say which host could not be reached rather than surfacing a bare TypeError.
    throw new Error(`could not reach ${target.hostname}: ${e.message}`);
  }
  if (!res.ok) throw new Error(`${target.hostname} returned HTTP ${res.status}`);
  const body = await res.json();
  // Open-Meteo reports its own errors in a 200 body as often as by status code.
  if (body?.error) throw new Error(`${target.hostname}: ${body.reason ?? "request rejected"}`);
  return body;
}

/* ------------------------------------------------------------------ codes */

/**
 * WMO weather interpretation codes.
 *
 * The API returns a bare integer, which is meaningless to a reader and easy for a model to
 * mis-guess. Translating here means the number never has to be interpreted downstream.
 */
const WMO = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "depositing rime fog",
  51: "light drizzle", 53: "moderate drizzle", 55: "dense drizzle",
  56: "light freezing drizzle", 57: "dense freezing drizzle",
  61: "slight rain", 63: "moderate rain", 65: "heavy rain",
  66: "light freezing rain", 67: "heavy freezing rain",
  71: "slight snowfall", 73: "moderate snowfall", 75: "heavy snowfall", 77: "snow grains",
  80: "slight rain showers", 81: "moderate rain showers", 82: "violent rain showers",
  85: "slight snow showers", 86: "heavy snow showers",
  95: "thunderstorm", 96: "thunderstorm with slight hail", 99: "thunderstorm with heavy hail",
};
const describe = (code) => WMO[code] ?? `unknown conditions (WMO code ${code})`;

/* ------------------------------------------------------------------ places */

/**
 * Resolve a place name to coordinates.
 *
 * Returns every match rather than silently taking the first: there are Springfields in a dozen
 * states and a Cambridge on two continents, and quietly picking one produces a confidently wrong
 * answer. Callers that were given explicit coordinates never come through here at all.
 */
async function geocode(name, count = 5) {
  const body = await getJson(GEOCODE, { name, count, format: "json" });
  const results = body.results ?? [];
  if (results.length === 0) throw new Error(`no place matches "${name}"`);
  return results.map((r) => ({
    name: r.name,
    country: r.country ?? null,
    admin1: r.admin1 ?? null,
    latitude: r.latitude,
    longitude: r.longitude,
    timezone: r.timezone ?? null,
    population: r.population ?? null,
  }));
}

/** Coordinates from either explicit lat/lon or a place name, plus a label for the answer. */
async function locate(args) {
  const { latitude, longitude, place } = args;
  if (latitude !== undefined && longitude !== undefined) {
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error("latitude must be between -90 and 90");
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error("longitude must be between -180 and 180");
    return { latitude: lat, longitude: lon, label: `${lat}, ${lon}`, matches: null };
  }
  if (!place) throw new Error("pass either place, or both latitude and longitude");
  const matches = await geocode(place);
  const best = matches[0];
  return {
    latitude: best.latitude,
    longitude: best.longitude,
    label: [best.name, best.admin1, best.country].filter(Boolean).join(", "),
    // Handed back so the caller can disambiguate rather than assume. A model that sees three
    // Cambridges should say so instead of picking one.
    matches: matches.length > 1 ? matches : null,
    timezone: best.timezone,
  };
}

/* ------------------------------------------------------------------ tools */

const UNITS = {
  temperature_unit: { type: "string", enum: ["celsius", "fahrenheit"], description: "Default celsius" },
  wind_speed_unit: { type: "string", enum: ["kmh", "ms", "mph", "kn"], description: "Default kmh" },
  precipitation_unit: { type: "string", enum: ["mm", "inch"], description: "Default mm" },
};
const PLACE = {
  place: { type: "string", description: "Place name, e.g. \"Lisbon\" or \"Cambridge, MA\"" },
  latitude: { type: "number", description: "Latitude, if known. Give longitude too." },
  longitude: { type: "number", description: "Longitude, if known. Give latitude too." },
};

const TOOLS = [
  {
    name: "weather_current",
    description:
      "Current conditions for a place: temperature, apparent temperature, humidity, precipitation, " +
      "wind and a plain-language description. Give either a place name or explicit coordinates.",
    inputSchema: { type: "object", properties: { ...PLACE, ...UNITS }, required: [] },
  },
  {
    name: "weather_forecast",
    description:
      "Daily forecast for a place: high and low temperature, precipitation total and probability, " +
      "wind, sunrise and sunset. Up to 16 days.",
    inputSchema: {
      type: "object",
      properties: { ...PLACE, ...UNITS, days: { type: "number", description: "1-16, default 7" } },
      required: [],
    },
  },
  {
    name: "weather_geocode",
    description:
      "Resolve a place name to coordinates, country, region and timezone, returning every match. " +
      "Use this when a name is ambiguous and you need the user to choose.",
    inputSchema: {
      type: "object",
      properties: {
        place: { type: "string", description: "Place name to look up" },
        count: { type: "number", description: "Maximum matches to return (default 5)" },
      },
      required: ["place"],
    },
  },
];

const unitArgs = (a) => ({
  temperature_unit: a.temperature_unit,
  wind_speed_unit: a.wind_speed_unit,
  precipitation_unit: a.precipitation_unit,
});

async function callTool(name, args = {}) {
  switch (name) {
    case "weather_geocode":
      return { matches: await geocode(args.place, Math.min(Number(args.count) || 5, 20)) };

    case "weather_current": {
      const at = await locate(args);
      const body = await getJson(FORECAST, {
        latitude: at.latitude,
        longitude: at.longitude,
        current: "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day",
        timezone: "auto",
        ...unitArgs(args),
      });
      const c = body.current ?? {};
      const u = body.current_units ?? {};
      return {
        location: at.label,
        coordinates: { latitude: body.latitude, longitude: body.longitude },
        timezone: body.timezone,
        observed_at: c.time,
        conditions: describe(c.weather_code),
        is_day: c.is_day === 1,
        temperature: { value: c.temperature_2m, unit: u.temperature_2m },
        feels_like: { value: c.apparent_temperature, unit: u.apparent_temperature },
        humidity: { value: c.relative_humidity_2m, unit: u.relative_humidity_2m },
        precipitation: { value: c.precipitation, unit: u.precipitation },
        wind: { speed: c.wind_speed_10m, unit: u.wind_speed_10m, direction_degrees: c.wind_direction_10m },
        ambiguous_matches: at.matches,
      };
    }

    case "weather_forecast": {
      const at = await locate(args);
      const days = Math.min(Math.max(Number(args.days) || 7, 1), 16);
      const body = await getJson(FORECAST, {
        latitude: at.latitude,
        longitude: at.longitude,
        daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset",
        forecast_days: days,
        timezone: "auto",
        ...unitArgs(args),
      });
      const d = body.daily ?? {};
      const u = body.daily_units ?? {};
      const forecast = (d.time ?? []).map((date, i) => ({
        date,
        conditions: describe(d.weather_code?.[i]),
        high: d.temperature_2m_max?.[i],
        low: d.temperature_2m_min?.[i],
        precipitation: d.precipitation_sum?.[i],
        precipitation_probability: d.precipitation_probability_max?.[i],
        max_wind: d.wind_speed_10m_max?.[i],
        sunrise: d.sunrise?.[i],
        sunset: d.sunset?.[i],
      }));
      return {
        location: at.label,
        coordinates: { latitude: body.latitude, longitude: body.longitude },
        timezone: body.timezone,
        units: {
          temperature: u.temperature_2m_max,
          precipitation: u.precipitation_sum,
          wind: u.wind_speed_10m_max,
        },
        forecast,
        ambiguous_matches: at.matches,
      };
    }

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

/* ------------------------------------------------------------------ transport */

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const failWith = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

createInterface({ input: process.stdin }).on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return failWith(null, -32700, "invalid JSON"); // no id available, so this cannot be answered
  }
  try {
    switch (msg.method) {
      case "initialize":
        return reply(msg.id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "weather", version: "1.0.0" },
        });
      case "tools/list":
        return reply(msg.id, { tools: TOOLS });
      case "tools/call": {
        // Awaited inside the try: these tools are async, and an unhandled rejection would kill the
        // server and take every other pending call with it.
        const out = await callTool(msg.params?.name, msg.params?.arguments);
        return reply(msg.id, { content: [{ type: "text", text: JSON.stringify(out) }] });
      }
      case "notifications/initialized":
        return; // a notification has no id and takes no reply
      default:
        return failWith(msg.id, -32601, `method not found: ${msg.method}`);
    }
  } catch (e) {
    return failWith(msg.id, -32000, e instanceof Error ? e.message : String(e));
  }
});
