import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!stripeKey || !webhookSecret) {
    console.error("Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET");
    return new Response("Server misconfigured", { status: 500 });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const body = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  // Idempotency check
  const { data: existing } = await supabaseAdmin
    .from("stripe_webhook_events")
    .select("id")
    .eq("id", event.id)
    .maybeSingle();

  if (existing) {
    console.log(`Event ${event.id} already processed, skipping`);
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }

  // Record event
  await supabaseAdmin.from("stripe_webhook_events").insert({
    id: event.id,
    event_type: event.type,
    payload: event.data.object as any,
  });

  console.log(`Processing webhook: ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const workspaceId = session.metadata?.workspace_id;
        if (!workspaceId) break;

        // Activate subscription immediately on checkout completion
        await supabaseAdmin
          .from("tenants")
          .update({
            stripe_subscription_id: session.subscription as string,
            stripe_customer_id: session.customer as string,
            trial_used_at: new Date().toISOString(),
            subscription_status: "active",
            subscription_plan: "pro",
            access_enabled: true,
            access_locked_reason: null,
            diagram_limit: 50,
          })
          .eq("id", workspaceId);
        console.log(`Tenant ${workspaceId} checkout completed, subscription activated`);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const workspaceId = subscription.metadata?.workspace_id;
        
        // Try metadata first, then look up by customer ID
        let tenantId = workspaceId;
        if (!tenantId) {
          const { data: t } = await supabaseAdmin
            .from("tenants")
            .select("id")
            .eq("stripe_customer_id", subscription.customer as string)
            .maybeSingle();
          tenantId = t?.id;
        }
        if (!tenantId) {
          console.error("No tenant found for subscription", subscription.id);
          break;
        }

        const status = subscription.status;
        const accessEnabled = status === "active" || status === "trialing";

        const updateData: Record<string, any> = {
          subscription_status: status,
          subscription_plan: "pro",
          stripe_subscription_id: subscription.id,
          current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          cancel_at_period_end: subscription.cancel_at_period_end,
          canceled_at: subscription.canceled_at
            ? new Date(subscription.canceled_at * 1000).toISOString()
            : null,
          access_enabled: accessEnabled,
        };

        if (!accessEnabled) {
          updateData.access_locked_reason = status === "canceled" ? "subscription_canceled" : "subscription_" + status;
        } else {
          updateData.access_locked_reason = null;
        }

        if (subscription.trial_end) {
          updateData.trial_ends_at = new Date(subscription.trial_end * 1000).toISOString();
        }

        await supabaseAdmin.from("tenants").update(updateData).eq("id", tenantId);
        console.log(`Updated tenant ${tenantId}: status=${status}, access=${accessEnabled}`);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const { data: t } = await supabaseAdmin
          .from("tenants")
          .select("id")
          .eq("stripe_customer_id", subscription.customer as string)
          .maybeSingle();

        if (t) {
          await supabaseAdmin
            .from("tenants")
            .update({
              subscription_status: "canceled",
              access_enabled: false,
              access_locked_reason: "subscription_canceled",
              canceled_at: new Date().toISOString(),
            })
            .eq("id", t.id);
          console.log(`Tenant ${t.id} subscription deleted, access locked`);
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const { data: t } = await supabaseAdmin
          .from("tenants")
          .select("id")
          .eq("stripe_customer_id", invoice.customer as string)
          .maybeSingle();

        if (t) {
          await supabaseAdmin
            .from("tenants")
            .update({
              access_enabled: true,
              access_locked_reason: null,
            })
            .eq("id", t.id);
          console.log(`Tenant ${t.id} invoice paid, access restored`);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const { data: t } = await supabaseAdmin
          .from("tenants")
          .select("id")
          .eq("stripe_customer_id", invoice.customer as string)
          .maybeSingle();

        if (t) {
          await supabaseAdmin
            .from("tenants")
            .update({
              access_enabled: false,
              access_locked_reason: "payment_failed",
            })
            .eq("id", t.id);
          console.log(`Tenant ${t.id} payment failed, access locked`);
        }
        break;
      }
    }
  } catch (err: any) {
    console.error(`Error processing ${event.type}:`, err);
    // Still return 200 to avoid Stripe retries for processing errors
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
