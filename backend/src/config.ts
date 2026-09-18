function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env variable ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  adminUsername: required('ADMIN_USERNAME'),
  adminPassword: required('ADMIN_PASSWORD'),
  sessionSecret: required('SESSION_SECRET'),
  smtpHost: process.env.SMTP_HOST ?? 'maildev',
  smtpPort: Number(process.env.SMTP_PORT ?? 1025),
  mailFrom: process.env.MAIL_FROM ?? 'monitor@localhost',
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:8080',
  // Recipients for checks that are not in a group (groups have their own list).
  defaultAlertEmails: (process.env.DEFAULT_ALERT_EMAILS ?? '')
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  // Time zone used to format times in alert emails.
  displayTimezone: process.env.DISPLAY_TIMEZONE || 'UTC',
};
