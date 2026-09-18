import nodemailer from 'nodemailer';
import { config } from '../config.js';

// MailDev inside docker-compose: plain SMTP, no auth, no TLS.
const transport = nodemailer.createTransport({
  host: config.smtpHost,
  port: config.smtpPort,
  secure: false,
  ignoreTLS: true,
  // Fail fast so a dead SMTP server doesn't hold the dispatcher for minutes.
  connectionTimeout: 5_000,
  greetingTimeout: 5_000,
  socketTimeout: 10_000,
});

export interface Mail {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

export async function sendMail(mail: Mail): Promise<void> {
  await transport.sendMail({ from: config.mailFrom, ...mail });
}
