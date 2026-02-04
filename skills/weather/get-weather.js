#!/usr/bin/env node

/**
 * Weather — Fetch weather from MET Norway Locationforecast 2.0 API
 *
 * Usage:
 *   node get-weather.js <latitude> <longitude>
 *   node get-weather.js <location-name>       (looks up in locations.json)
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

const USER_AGENT = "pi-weather-skill/1.0 (github.com/badlogic/pi-coding-agent)";
const API_BASE = "https://api.met.no/weatherapi/locationforecast/2.0";
const CACHE_DIR = path.join(__dirname, ".cache");
const LOCATIONS_FILE = path.join(__dirname, "locations.json");

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
	fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function loadLocations() {
	try {
		return JSON.parse(fs.readFileSync(LOCATIONS_FILE, "utf8"));
	} catch {
		return {};
	}
}

function roundCoord(coord) {
	return Math.round(coord * 10000) / 10000;
}

function getCachePath(lat, lon) {
	return path.join(CACHE_DIR, `weather_${lat}_${lon}.json`);
}

function readCache(lat, lon) {
	try {
		const cachePath = getCachePath(lat, lon);
		if (!fs.existsSync(cachePath)) return null;
		const data = JSON.parse(fs.readFileSync(cachePath, "utf8"));
		if (new Date(data.expires) > new Date()) return data;
		return null;
	} catch {
		return null;
	}
}

function writeCache(lat, lon, data, expires, lastModified) {
	fs.writeFileSync(
		getCachePath(lat, lon),
		JSON.stringify({ data, expires, lastModified, cachedAt: new Date().toISOString() })
	);
}

function fetchWeather(lat, lon) {
	return new Promise((resolve, reject) => {
		const url = `${API_BASE}/compact?lat=${lat}&lon=${lon}`;
		const options = { headers: { "User-Agent": USER_AGENT } };

		const cached = readCache(lat, lon);
		if (cached) {
			options.headers["If-Modified-Since"] = cached.lastModified;
		}

		https
			.get(url, options, (res) => {
				if (res.statusCode === 304 && cached) {
					resolve(cached.data);
					return;
				}
				if (res.statusCode !== 200 && res.statusCode !== 203) {
					reject(new Error(`API returned status ${res.statusCode}`));
					return;
				}
				let data = "";
				res.on("data", (chunk) => (data += chunk));
				res.on("end", () => {
					try {
						const json = JSON.parse(data);
						const expires = res.headers["expires"];
						const lastModified = res.headers["last-modified"];
						if (expires && lastModified) writeCache(lat, lon, json, expires, lastModified);
						resolve(json);
					} catch (err) {
						reject(err);
					}
				});
			})
			.on("error", reject);
	});
}

const WEATHER_DESCRIPTIONS = {
	clearsky: "Clear sky",
	cloudy: "Cloudy",
	fair: "Fair",
	fog: "Fog",
	heavyrain: "Heavy rain",
	heavyrainandthunder: "Heavy rain and thunder",
	heavyrainshowers: "Heavy rain showers",
	heavysleet: "Heavy sleet",
	heavysleetshowers: "Heavy sleet showers",
	heavysnow: "Heavy snow",
	heavysnowshowers: "Heavy snow showers",
	lightrain: "Light rain",
	lightrainshowers: "Light rain showers",
	lightsleet: "Light sleet",
	lightsleetshowers: "Light sleet showers",
	lightsnow: "Light snow",
	lightsnowshowers: "Light snow showers",
	partlycloudy: "Partly cloudy",
	rain: "Rain",
	rainandthunder: "Rain and thunder",
	rainshowers: "Rain showers",
	sleet: "Sleet",
	sleetshowers: "Sleet showers",
	snow: "Snow",
	snowshowers: "Snow showers",
	thunder: "Thunder",
};

function describeWeather(symbolCode) {
	const base = symbolCode.replace(/_day|_night|_polartwilight/g, "");
	return WEATHER_DESCRIPTIONS[base] || symbolCode;
}

function displayWeather(weatherData, locationName) {
	const ts = weatherData.properties.timeseries;
	const current = ts[0];
	const d = current.data.instant.details;
	const next1h = current.data.next_1_hours;
	const next6h = current.data.next_6_hours;

	const symbol = next1h?.summary?.symbol_code || next6h?.summary?.symbol_code || "unknown";

	console.log(`Weather in ${locationName}`);
	console.log(`${"=".repeat(40)}`);
	console.log(`Now: ${d.air_temperature}°C, ${describeWeather(symbol)}`);
	console.log(`Humidity: ${d.relative_humidity}%`);
	console.log(`Wind: ${d.wind_speed} m/s`);
	if (d.wind_from_direction != null) {
		console.log(`Wind direction: ${d.wind_from_direction}°`);
	}
	if (next1h?.details?.precipitation_amount) {
		console.log(`Precipitation (next hour): ${next1h.details.precipitation_amount} mm`);
	}

	console.log(`\nHourly Forecast:`);
	console.log(`${"-".repeat(40)}`);

	for (let i = 1; i < Math.min(13, ts.length); i++) {
		const entry = ts[i];
		const time = new Date(entry.time);
		const temp = entry.data.instant.details.air_temperature;
		const next = entry.data.next_1_hours || entry.data.next_6_hours;
		if (next) {
			const cond = describeWeather(next.summary.symbol_code);
			const precip = next.details?.precipitation_amount || 0;
			const hh = time.getHours().toString().padStart(2, "0");
			console.log(`${hh}:00  ${temp}°C, ${cond}${precip > 0 ? `, ${precip}mm` : ""}`);
		}
	}
}

async function main() {
	const args = process.argv.slice(2);

	if (args.length === 0) {
		console.error("Usage: node get-weather.js <lat> <lon>");
		console.error("   or: node get-weather.js <location-name>");
		const locations = loadLocations();
		console.error("Saved locations:", Object.keys(locations).join(", "));
		process.exit(1);
	}

	let lat, lon, locationName;

	if (!isNaN(parseFloat(args[0])) && args.length >= 2) {
		lat = roundCoord(parseFloat(args[0]));
		lon = roundCoord(parseFloat(args[1]));
		locationName = `${lat}, ${lon}`;
	} else {
		const key = args.join(" ").toLowerCase();
		const locations = loadLocations();
		const matchedKey = Object.keys(locations).find((k) => k.toLowerCase() === key);

		if (!matchedKey) {
			console.error(`Location "${args.join(" ")}" not found.`);
			console.error("Available:", Object.keys(locations).join(", "));
			process.exit(1);
		}

		const loc = locations[matchedKey];
		if (typeof loc !== "object" || !loc.lat || !loc.lon) {
			console.error(`Location "${matchedKey}" has no coordinates. Add lat/lon to locations.json.`);
			process.exit(1);
		}

		lat = roundCoord(loc.lat);
		lon = roundCoord(loc.lon);
		locationName = loc.address || matchedKey;
	}

	try {
		const weather = await fetchWeather(lat, lon);
		displayWeather(weather, locationName);
	} catch (err) {
		console.error("Error:", err.message);
		process.exit(1);
	}
}

main();
