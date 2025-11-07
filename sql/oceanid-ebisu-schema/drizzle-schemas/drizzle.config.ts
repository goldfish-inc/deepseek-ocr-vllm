import type { Config } from 'drizzle-kit'

export default {
  schema: './*.ts',
  out: '../migrations',
  driver: 'pg',
  dbCredentials: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5433'),
    user: process.env.DB_USER || 'ebisu_user',
    password: process.env.DB_PASSWORD || 'ebisu_password',
    database: process.env.DB_NAME || 'ebisu',
  },
  verbose: true,
  strict: true,
} satisfies Config
