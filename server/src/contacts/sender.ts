import { config } from '../config';
import type { ContactChannel } from '../generated/prisma/client';

export type OutgoingMessage = { to: string; channel: ContactChannel; body: string };
export type SendResult = { providerId: string };

export class SendError extends Error {
  constructor(readonly code: string) { super(code); }
}

export interface MessageSender {
  send(message: OutgoingMessage): Promise<SendResult>;
}

/** Last four digits only; used wherever a number would otherwise reach a log line. */
export const maskPhone = (e164: string) => `${e164.slice(0, 3)}******${e164.slice(-4)}`;

/** Dev and demo driver: logs the message (number masked) and reports success. Needs no credentials. */
export class ConsoleSender implements MessageSender {
  async send({ to, channel, body }: OutgoingMessage): Promise<SendResult> {
    console.log(`[contacts:console] ${channel} to ${maskPhone(to)}: ${body}`);
    return { providerId: `console-${Date.now()}` };
  }
}

/** Twilio SMS and WhatsApp (sandbox or approved sender) over the REST API; no SDK dependency. */
export class TwilioSender implements MessageSender {
  async send({ to, channel, body }: OutgoingMessage): Promise<SendResult> {
    const { twilioAccountSid: sid, twilioAuthToken: token } = config;
    if (!sid || !token) throw new SendError('twilio_not_configured');
    const whatsapp = channel === 'WHATSAPP';
    const from = whatsapp ? config.twilioWhatsappFrom : config.twilioSmsFrom;
    if (!from) throw new SendError('twilio_sender_missing');
    const form = new URLSearchParams({ To: whatsapp ? `whatsapp:${to}` : to, From: from, Body: body });
    let response: Response;
    try {
      response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form, signal: AbortSignal.timeout(10_000),
      });
    } catch { throw new SendError('twilio_unreachable'); }
    const json = await response.json().catch(() => ({})) as { sid?: string; code?: number };
    // Provider codes only; never the number, the body or the response text.
    if (!response.ok || !json.sid) throw new SendError(`twilio_${json.code ?? response.status}`);
    return { providerId: json.sid };
  }
}

let cached: MessageSender | null = null;
export function getSender(): MessageSender {
  cached ??= config.contactSender === 'twilio' ? new TwilioSender() : new ConsoleSender();
  return cached;
}
