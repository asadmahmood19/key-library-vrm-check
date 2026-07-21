import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  vehicleApiKey: required('VEHICLE_API_KEY'),
  adminPassword: required('ADMIN_PASSWORD'),
  databaseUrl: required('DATABASE_URL'),
  cacheDurationDays: Number(process.env.CACHE_DURATION_DAYS || 7),
  buyCreditsUrl: process.env.BUY_CREDITS_URL || 'https://www.keylibrary.co.uk/',
  sessionSecret: required('SESSION_SECRET'),
  vehicleApiBaseUrl: 'https://api.checkcardetails.co.uk/vehicledata/vehiclespecs',
  isProd: process.env.NODE_ENV === 'production',
  /** £ spent per 1 lookup credit (default: £10 = 1 credit) */
  creditsPoundsPerCredit: Math.max(1, Number(process.env.CREDITS_POUNDS_PER_CREDIT || 10)),
  /** Only count orders on/after this date (YYYY-MM-DD, Europe/London) */
  creditsStartDate: process.env.CREDITS_START_DATE || '2026-07-22',
};
