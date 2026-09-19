export const PORT = Number(process.env.PORT ?? 8080);
export const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${PORT}`).replace(
  /\/$/,
  "",
);
export const DATA_DIR = process.env.DATA_DIR ?? new URL("../data", import.meta.url).pathname;
export const STEP_MINUTES = 15;
export const MIN_DURATION_MINUTES = 15;
export const MAX_DURATION_MINUTES = 240;
export const MAX_HORIZON_DAYS = 60;
export const MAX_PARTICIPANTS = 100;
export const MAX_INTERVALS_PER_RESPONSE = 500;
export const MAX_TITLE = 200;
