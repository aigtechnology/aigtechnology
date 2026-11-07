const PRODUCTION_API_BASE_URL = "";
const configuredApiUrl = globalThis.AIG_API_BASE_URL || PRODUCTION_API_BASE_URL;
const locationObject = globalThis.location;
const localFrontendHost = locationObject?.hostname || "";
const isLocalFrontend = locationObject?.protocol === "http:"
  && locationObject?.port === "5500"
  && Boolean(localFrontendHost);
const derivedLocalApiUrl = isLocalFrontend
  ? `${locationObject.protocol}//${localFrontendHost}:8000/api`
  : "";

export const API_BASE_URL = (configuredApiUrl || derivedLocalApiUrl).replace(/\/+$/, "");

if (API_BASE_URL && !isLocalFrontend) {
  const parsedApiUrl = new URL(API_BASE_URL);
  if (parsedApiUrl.protocol !== "https:" || !parsedApiUrl.pathname.endsWith("/api")) {
    throw new Error("Configure the production API URL as an HTTPS origin ending in /api.");
  }
}
