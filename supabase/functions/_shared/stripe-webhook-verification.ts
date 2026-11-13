import type { StripeMode } from "./stripe-env.ts";

export class WebhookSignatureError extends Error {
  constructor() {
    super("Invalid webhook signature");
  }
}

export class WebhookConfigurationError extends Error {
  constructor() {
    super("Webhook signing secrets are not configured");
  }
}

/** Never select a secret from unverified JSON or accept a secret for the wrong mode. */
export async function verifyStripeWebhook<T extends { livemode: boolean }>(
  body: string,
  signature: string,
  secrets: Partial<Record<StripeMode, string>>,
  constructEvent: (body: string, signature: string, secret: string) => Promise<T>,
): Promise<T> {
  const configured = (Object.entries(secrets) as [StripeMode, string | undefined][])
    .filter((entry): entry is [StripeMode, string] => Boolean(entry[1]));
  if (!configured.length) throw new WebhookConfigurationError();
  for (const [mode, secret] of configured) {
    try {
      const event = await constructEvent(body, signature, secret);
      if (typeof event.livemode === "boolean" && event.livemode === (mode === "live")) {
        return event;
      }
    } catch {
      // SDK signature errors can contain signatures/raw bodies: never log or return them.
    }
  }
  throw new WebhookSignatureError();
}