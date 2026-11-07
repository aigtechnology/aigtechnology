const PRODUCTION_API_BASE_URL = "";
const configuredApiUrl = globalThis.AIG_API_BASE_URL || PRODUCTION_API_BASE_URL;
const isLocalDevelopment = ["localhost", "127.0.0.1"].includes(globalThis.location?.hostname);

export const API_BASE_URL = (configuredApiUrl || (isLocalDevelopment ? "http://localhost:8000/api" : "")).replace(/\/+$/, "");

if (API_BASE_URL && !isLocalDevelopment) {
  const parsedApiUrl = new URL(API_BASE_URL);
  if (parsedApiUrl.protocol !== "https:" || !parsedApiUrl.pathname.endsWith("/api")) {
    throw new Error("Configure the production API URL as an HTTPS origin ending in /api.");
  }
}
