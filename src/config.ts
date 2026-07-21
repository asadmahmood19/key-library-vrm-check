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
};
