import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { invokeTransactionalEmail } from "../_shared/invoke-transactional-email.ts";
import { getTenantBillingRecipients } from "../_shared/tenant-recipients.ts";
import {
  STRIPE_API_VERSION,
  getInvoicePeriodEnd,
  getInvoiceSubscriptionId,
  getSubscriptionLifecycle,
  getTrialEndSeconds,
  toISO,
} from "../_shared/stripe-subscription.ts";
import {
  buildPlanConfig,
  buildPriceMap,
  resolvePlanFromSubscription as sharedResolvePlan,
  TRIAL_GROUP_LIMIT,
} from "../_shared/stripe-plans.ts";
import { stripeVar, stripeVarSafe, stripeMode } from "../_shared/stripe-env.ts";
import { verifyStripeWebhook, WebhookConfigurationError } from "../_shared/stripe-webhook-verification.ts";

// Plan configuration mapped by Stripe Product ID — single source of truth in _shared/stripe-plans.ts
// Trials always get the capped trial allowance (full Pro features, 3 structure groups);
// plan limits apply once the subscription is paying.
const PLAN_CONFIG: Record<string, { plan: string; diagramLimit: number }> = {};

const PRICE_MAP = buildPriceMap();

function initPlanConfig() {
  for (const [id, cfg] of Object.entries(buildPlanConfig())) {
    PLAN_CONFIG[id] = cfg;
  }
}

function resolvePlanFromSubscription(
  subscription: Stripe.Subscription,
): { plan: string; diagramLimit: number } {
  return sharedResolvePlan(subscription, "stripe-webhooks");
}

async function findTenantByCustomer(supabaseAdmin: any, customerId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("tenants")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle().throwOnError();
  return data?.id ?? null;
}

async function notifyTenantBilling(
  supabaseAdmin: ReturnType<typeof createClient>,
  tenantId: string,
  templateName: string,
  templateData: Record<string, unknown>,
  idempotencyKey: string,
): Promise<void> {
  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("firm_name, subscription_plan")
    .eq("id", tenantId)
    .maybeSingle().throwOnError();

  const recipients = await getTenantBillingRecipients(supabaseAdmin, tenantId);
  for (const recipient of recipients) {
    await invokeTransactionalEmail({
      templateName,
      recipientEmail: recipient.email,
      templateData: {
        name: recipient.name,
        firmName: tenant?.firm_name,
        plan: tenant?.subscription_plan,
        ...templateData,
      },
      idempotencyKey: `${idempotencyKey}:${recipient.email}`,
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) return respond({ error: "Missing signature" }, 400);

  let event: Stripe.Event;
  try {
    event = await verifyStripeWebhook(body, signature, {
      test: stripeVarSafe("STRIPE_WEBHOOK_SECRET", "test"),
      live: stripeVarSafe("STRIPE_WEBHOOK_SECRET", "live"),
    }, (raw, header, secret) => Stripe.webhooks.constructEventAsync(
      raw, header, secret, undefined, Stripe.createSubtleCryptoProvider(),
    ));
  } catch (err) {
    if (err instanceof WebhookConfigurationError) {
      console.error("[stripe-webhooks] Signing configuration unavailable");
      return respond({ error: "Server misconfigured" }, 500);
    }
    console.warn("[stripe-webhooks] Invalid webhook signature or payload");
    return respond({ error: "Invalid webhook signature" }, 400);
  }

  // Mode guard: a webhook from the other Stripe environment must never mutate
  // tenant billing state in this one (test events cannot be trusted in live mode).
  const activeModeIsLive = stripeMode() === "live";
  if (event.livemode !== activeModeIsLive) {
    console.warn(
      `[stripe-webhooks] Ignoring ${event.type} (${event.id}): event livemode=${event.livemode} but active mode=${activeModeIsLive ? "live" : "test"}`,
    );
    return respond({ received: true, ignored: "mode_mismatch" });
  }

  let stripe: Stripe;
  let supabaseAdmin: ReturnType<typeof createClient>;
  try {
    const stripeKey = stripeVar("STRIPE_SECRET_KEY");
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!stripeKey || !url || !serviceKey) throw new Error("Missing webhook credentials");
    initPlanConfig();
    stripe = new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION });
    supabaseAdmin = createClient(url, serviceKey);
  } catch {
    console.error("[stripe-webhooks] Active billing configuration unavailable");
    return respond({ error: "Server misconfigured" }, 500);
  }


  // Idempotency: only events that fully completed are skipped. Rows left in
  // 'processing'/'failed' state are re-processed on Stripe's retry.
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("stripe_webhook_events")
    .select("id, status, attempts, processed_at")
    .eq("id", event.id)
    .maybeSingle();

  if (lookupError) {
    console.error(`[stripe-webhooks] Event lookup failed (${event.id}):`, lookupError.code);
    return respond({ error: "Failed to read webhook event" }, 500);
  }

  if (existing?.status === "completed") {
    console.log(`Event ${event.id} already processed, skipping`);
    return respond({ received: true });
  }

  // A conditional claim prevents concurrent deliveries from running billing actions twice.
  // A crashed invocation can be reclaimed after its five-minute processing lease expires.
  if (existing?.status === "processing" && existing.processed_at &&
      Date.parse(existing.processed_at) > Date.now() - 5 * 60 * 1000) {
    return respond({ error: "Event is already processing; retry later" }, 503);
  }

  const attempts = (existing?.attempts ?? 0) + 1;

  // Claim the event: insert on first delivery, or re-claim a previously failed one.
  const claim = {
      id: event.id,
      event_type: event.type,
      payload: event.data.object as any,
      status: "processing",
      attempts,
      last_error: null,
      completed_at: null,
      processed_at: new Date().toISOString(),
    };
  let claimQuery = existing
    ? supabaseAdmin.from("stripe_webhook_events").update(claim)
      .eq("id", event.id).eq("status", existing.status).eq("attempts", existing.attempts)
    : supabaseAdmin.from("stripe_webhook_events").insert(claim);
  if (existing?.processed_at) claimQuery = claimQuery.eq("processed_at", existing.processed_at);
  const { data: claimed, error: claimError } = await claimQuery.select("id").maybeSingle();

  if (claimError) {
    console.error(`[stripe-webhooks] Failed to claim event ${event.id}:`, claimError.message);
    return respond({ error: "Failed to record webhook event" }, claimError.code === "23505" ? 503 : 500);
  }
  if (!claimed) return respond({ error: "Event claimed by another delivery; retry later" }, 503);

  console.log(`Processing webhook: ${event.type} (${event.id}) attempt=${attempts}`);


  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const workspaceId = session.metadata?.workspace_id;
        if (!workspaceId) break;

        if (!session.subscription) {
          console.error(
            `[stripe-webhooks] checkout.session.completed without subscription for workspace=${workspaceId} session=${session.id} — refusing to activate.`,
          );
          throw new Error("Checkout session has no subscription; cannot activate plan without a mapped product.");
        }

        const sub = await stripe.subscriptions.retrieve(session.subscription as string);
        const { plan, diagramLimit } = resolvePlanFromSubscription(sub);
        const life = getSubscriptionLifecycle(sub);
        const periodStart = life.currentPeriodStart;
        const periodEnd = life.currentPeriodEnd;
        const status = life.status;
        const accessEnabled = status === "active" || status === "trialing";

        const updateData: Record<string, any> = {
          stripe_subscription_id: sub.id,
          stripe_customer_id: session.customer as string,
          stripe_mode: stripeMode(),
          payment_method_captured: true,
          payment_setup_completed_at: new Date().toISOString(),
          trial_used_at: new Date().toISOString(),
          subscription_status: status,
          subscription_plan: plan,
          selected_plan: plan,
          access_enabled: accessEnabled,
          access_locked_reason: accessEnabled
            ? null
            : (status === "canceled" ? "subscription_canceled" : `subscription_${status}`),
          diagram_limit: status === "trialing" ? TRIAL_GROUP_LIMIT : diagramLimit,
          current_period_start: periodStart,
          current_period_end: periodEnd,
          cancel_at_period_end: life.cancelAtPeriodEnd,
          canceled_at: life.canceledAt,
          trial_ends_at: life.trialEnd,
        };

        await supabaseAdmin
          .from("tenants")
          .update(updateData)
          .eq("id", workspaceId).throwOnError();
        console.log(`Tenant ${workspaceId} checkout completed: plan=${plan}, status=${status}, limit=${diagramLimit}, period_end=${periodEnd}`);

        // The welcome email is deliberately NOT sent here. It is sent once the firm has
        // connected Xero Practice Manager (see xero-callback / xero-finalise-connection),
        // because that is when the product is actually usable.

        break;
      }



      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const workspaceId = subscription.metadata?.workspace_id;

        let tenantId = workspaceId;
        if (!tenantId) {
          tenantId = await findTenantByCustomer(supabaseAdmin, subscription.customer as string);
        }
        if (!tenantId) {
          console.error("No tenant found for subscription", subscription.id);
          break;
        }

        const { plan, diagramLimit } = resolvePlanFromSubscription(subscription);
        const life = getSubscriptionLifecycle(subscription);
        const status = life.status;
        const accessEnabled = status === "active" || status === "trialing";

        const updateData: Record<string, any> = {
          subscription_status: status,
          subscription_plan: plan,
          selected_plan: plan, // Sync selected_plan to actual plan on Stripe changes
          stripe_subscription_id: subscription.id,
          stripe_mode: stripeMode(),
          current_period_start: life.currentPeriodStart,
          current_period_end: life.currentPeriodEnd,
          cancel_at_period_end: life.cancelAtPeriodEnd,
          canceled_at: life.canceledAt,
          access_enabled: accessEnabled,
          access_locked_reason: accessEnabled ? null : (status === "canceled" ? "subscription_canceled" : `subscription_${status}`),
          diagram_limit: status === "trialing" ? TRIAL_GROUP_LIMIT : diagramLimit,
          payment_method_captured: true,
        };

        if (life.trialEnd) {
          updateData.trial_ends_at = life.trialEnd;
          updateData.trial_used_at = updateData.trial_used_at ?? new Date().toISOString();
        }

        await supabaseAdmin.from("tenants").update(updateData).eq("id", tenantId).throwOnError();
        console.log(`Updated tenant ${tenantId}: plan=${plan}, status=${status}, limit=${diagramLimit}`);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const tenantId = await findTenantByCustomer(supabaseAdmin, subscription.customer as string);

        if (tenantId) {
          const { data: tenantBefore } = await supabaseAdmin
            .from("tenants")
            .select("access_locked_reason")
            .eq("id", tenantId)
            .maybeSingle().throwOnError();

          const paymentFailed = tenantBefore?.access_locked_reason === "payment_failed";

          await supabaseAdmin
            .from("tenants")
            .update({
              subscription_status: "canceled",
              access_enabled: false,
              access_locked_reason: "subscription_canceled",
              canceled_at: getSubscriptionLifecycle(subscription).canceledAt ??
                getSubscriptionLifecycle(subscription).endedAt ??
                new Date().toISOString(),
              cancel_at_period_end: false,
            })
            .eq("id", tenantId).throwOnError();
          console.log(`Tenant ${tenantId} subscription deleted, access locked`);

          await notifyTenantBilling(
            supabaseAdmin,
            tenantId,
            "subscription-canceled",
            {
              reason: paymentFailed ? "payment_failed" : "canceled",
              accessEndsAt: new Date().toISOString(),
            },
            `stripe:${event.id}:subscription-canceled`,
          );
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const tenantId = await findTenantByCustomer(supabaseAdmin, invoice.customer as string);

        if (tenantId) {
          // Restore access
          await supabaseAdmin
            .from("tenants")
            .update({
              access_enabled: true,
              access_locked_reason: null,
            })
            .eq("id", tenantId).throwOnError();

          // Check for pending downgrade: if selected_plan differs from subscription_plan,
          // apply the plan change in Stripe now that the new period has started
          const { data: tenant } = await supabaseAdmin
            .from("tenants")
            .select("subscription_plan, selected_plan, stripe_subscription_id")
            .eq("id", tenantId)
            .single().throwOnError();

          if (
            tenant &&
            tenant.selected_plan &&
            tenant.selected_plan !== tenant.subscription_plan &&
            tenant.stripe_subscription_id
          ) {
            console.log(`Tenant ${tenantId}: applying deferred plan change ${tenant.subscription_plan} → ${tenant.selected_plan}`);

            try {
              const sub = await stripe.subscriptions.retrieve(tenant.stripe_subscription_id);
              const currentItem = sub.items.data[0];
              if (currentItem) {
                const currentInterval = currentItem.price.recurring?.interval || "month";
                const targetPriceId = PRICE_MAP[tenant.selected_plan]?.[currentInterval];

                if (targetPriceId) {
                  const updatedSub = await stripe.subscriptions.update(tenant.stripe_subscription_id, {
                    items: [{ id: currentItem.id, price: targetPriceId }],
                    proration_behavior: "none",
                  }, { idempotencyKey: `stripe:${event.id}:deferred-plan-change` });

                  // Resolve the new limit strictly from the updated Stripe subscription's product mapping.
                  const { plan: resolvedPlan, diagramLimit: newLimit } = resolvePlanFromSubscription(updatedSub);
                  const updatedLife = getSubscriptionLifecycle(updatedSub);
                  const deferredUpdate: Record<string, any> = {
                    subscription_plan: resolvedPlan,
                    selected_plan: resolvedPlan,
                    diagram_limit: newLimit,
                  };
                  if (updatedLife.currentPeriodStart) deferredUpdate.current_period_start = updatedLife.currentPeriodStart;
                  if (updatedLife.currentPeriodEnd) deferredUpdate.current_period_end = updatedLife.currentPeriodEnd;
                  await supabaseAdmin.from("tenants").update(deferredUpdate).eq("id", tenantId).throwOnError();

                  console.log(`Tenant ${tenantId}: deferred plan change applied to ${resolvedPlan} (limit=${newLimit})`);
                } else {
                  console.error(`No price ID for plan=${tenant.selected_plan}, interval=${currentInterval} — deferred plan change aborted, no benefits granted.`);
                }
              }
            } catch (e: any) {
              console.error(`Failed to apply deferred plan change for tenant ${tenantId}:`, e.message);
              throw e;
            }
          }

          // Re-sync billing period bounds from the subscription (invoice payloads
          // no longer carry them at the top level in recent API versions).
          const invoiceSubId = getInvoiceSubscriptionId(invoice) ?? tenant?.stripe_subscription_id;
          if (invoiceSubId) {
            try {
              const paidSub = await stripe.subscriptions.retrieve(invoiceSubId);
              const paidLife = getSubscriptionLifecycle(paidSub);
              const periodUpdate: Record<string, any> = {
                subscription_status: paidLife.status,
                cancel_at_period_end: paidLife.cancelAtPeriodEnd,
              };
              if (paidLife.currentPeriodStart) periodUpdate.current_period_start = paidLife.currentPeriodStart;
              if (paidLife.currentPeriodEnd) periodUpdate.current_period_end = paidLife.currentPeriodEnd;
              if (paidLife.trialEnd) periodUpdate.trial_ends_at = paidLife.trialEnd;
              await supabaseAdmin.from("tenants").update(periodUpdate).eq("id", tenantId).throwOnError();
            } catch (e: any) {
              console.error(`[stripe-webhooks] invoice.paid period sync failed for tenant ${tenantId}:`, e.message);
              throw e;
            }
          }

          console.log(`Tenant ${tenantId} invoice paid, access restored`);
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const tenantId = await findTenantByCustomer(supabaseAdmin, invoice.customer as string);

        if (tenantId) {
          await supabaseAdmin
            .from("tenants")
            .update({
              access_enabled: false,
              access_locked_reason: "payment_failed",
              subscription_status: "past_due",
            })
            .eq("id", tenantId).throwOnError();
          console.log(`Tenant ${tenantId} payment failed, access locked`);

          await notifyTenantBilling(
            supabaseAdmin,
            tenantId,
            "payment-failed",
            {},
            `stripe:${event.id}:payment-failed`,
          );
        }
        break;
      }

      case "customer.subscription.trial_will_end": {
        const subscription = event.data.object as Stripe.Subscription;
        let tenantId = subscription.metadata?.workspace_id as string | undefined;
        if (!tenantId) {
          tenantId = await findTenantByCustomer(supabaseAdmin, subscription.customer as string) ?? undefined;
        }
        const trialEndSeconds = getTrialEndSeconds(subscription);
        if (!tenantId) {
          console.warn(
            `[stripe-webhooks] trial_will_end: no tenant resolved for subscription=${subscription.id} customer=${subscription.customer}`,
          );
          break;
        }
        if (!trialEndSeconds) {
          console.warn(
            `[stripe-webhooks] trial_will_end: no trial_end on subscription=${subscription.id} (tenant=${tenantId})`,
          );
          break;
        }
        const trialEndIso = toISO(trialEndSeconds);
        if (!trialEndIso) throw new Error("Invalid subscription trial end");
        const daysRemaining = Math.max(
          1,
          Math.ceil((trialEndSeconds * 1000 - Date.now()) / (24 * 60 * 60 * 1000)),
        );

        const { error: trialUpdateError } = await supabaseAdmin
          .from("tenants")
          .update({ trial_ends_at: trialEndIso })
          .eq("id", tenantId);
        if (trialUpdateError) {
          throw new Error(`Failed to update trial_ends_at for tenant ${tenantId}: ${trialUpdateError.message}`);
        }

        await notifyTenantBilling(
          supabaseAdmin,
          tenantId,
          "trial-ending",
          { trialEndsAt: trialEndIso, daysRemaining },
          `stripe:${event.id}:trial-ending`,
        );
        console.log(
          `[stripe-webhooks] trial_will_end handled: tenant=${tenantId} subscription=${subscription.id} trial_ends_at=${trialEndIso} days_remaining=${daysRemaining}`,
        );
        break;
      }

      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        let tenantId = session.metadata?.workspace_id as string | undefined;
        if (!tenantId && session.customer) {
          tenantId = await findTenantByCustomer(supabaseAdmin, session.customer as string) ?? undefined;
        }
        if (!tenantId) {
          console.warn(
            `[stripe-webhooks] async_payment_failed: no tenant resolved for session=${session.id} customer=${session.customer}`,
          );
          break;
        }

        const { error: lockError } = await supabaseAdmin
          .from("tenants")
          .update({
            access_enabled: false,
            access_locked_reason: "payment_failed",
          })
          .eq("id", tenantId);
        if (lockError) {
          throw new Error(`Failed to lock tenant ${tenantId} after async payment failure: ${lockError.message}`);
        }

        await notifyTenantBilling(
          supabaseAdmin,
          tenantId,
          "payment-failed",
          {},
          `stripe:${event.id}:payment-failed`,
        );
        console.log(
          `[stripe-webhooks] async_payment_failed handled: tenant=${tenantId} session=${session.id}, access locked`,
        );
        break;
      }

      case "invoice.upcoming": {
        const invoice = event.data.object as Stripe.Invoice;
        const tenantId = await findTenantByCustomer(supabaseAdmin, invoice.customer as string);
        if (tenantId) {
          const renewalDate = getInvoicePeriodEnd(invoice) ?? undefined;
          const amount = invoice.amount_due != null
            ? new Intl.NumberFormat("en-AU", {
              style: "currency",
              currency: (invoice.currency || "aud").toUpperCase(),
            }).format(invoice.amount_due / 100)
            : undefined;
          await notifyTenantBilling(
            supabaseAdmin,
            tenantId,
            "renewal-reminder",
            { renewalDate, amount },
            `stripe:${event.id}:renewal-reminder`,
          );
          console.log(`[stripe-webhooks] invoice.upcoming handled: tenant=${tenantId} renewal=${renewalDate}`);
        } else {
          console.warn(`[stripe-webhooks] invoice.upcoming: no tenant for customer=${invoice.customer}`);
        }
        break;
      }

      default: {
        console.log(`[stripe-webhooks] Unhandled event type ${event.type} (${event.id}) — acknowledged`);
        break;
      }
    }

    // Only now is the event truly handled — mark it completed so retries skip it.
    const { error: completeError } = await supabaseAdmin
      .from("stripe_webhook_events")
      .update({ status: "completed", completed_at: new Date().toISOString(), last_error: null })
      .eq("id", event.id);
    if (completeError) {
      console.error(`[stripe-webhooks] Failed to mark event ${event.id} completed:`, completeError.message);
      // Ask Stripe to retry: the handler succeeded but the marker did not persist,
      // and every handler above is idempotent (state is mirrored, not incremented).
      return respond({ error: "Failed to persist webhook completion" }, 500);
    }
  } catch (err: any) {
    console.error(`Error processing ${event.type} (${event.id}):`, err);
    // Keep the row for observability but leave it un-completed so Stripe's retry reprocesses it.
    await supabaseAdmin
      .from("stripe_webhook_events")
      .update({
        status: "failed",
        completed_at: null,
        last_error: String(err?.message ?? err).slice(0, 2000),
      })
      .eq("id", event.id);
    return respond({ error: "Webhook handler failed; retry delivery" }, 500);
  }

  return respond({ received: true });
});

