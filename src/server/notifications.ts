import { CustomerOrder } from '../types';

export interface NotificationResult {
  sent: boolean;
  channel?: 'email' | 'webhook' | 'console';
  message?: string;
}

/**
 * Production-ready order notification dispatcher.
 * Dispatches alerts when a new customer order is placed.
 * Supports Resend email API, external webhook, or structured console logs.
 */
export async function notifyNewOrder(order: CustomerOrder): Promise<NotificationResult> {
  const adminEmail = process.env.NOTIFICATION_EMAIL || process.env.ADMIN_EMAIL;
  const resendApiKey = process.env.RESEND_API_KEY;
  const webhookUrl = process.env.WEBHOOK_ORDER_URL;

  const orderSummary = `
🔔 [RYVORA DIGITAL - NEW ORDER ALERT]
Order ID: ${order.orderId}
Customer: ${order.customerEmail} ${order.customerPhone ? `(${order.customerPhone})` : ''}
Items (${order.items.length}): ${order.items.map((i) => `${i.product.name} x${i.quantity}`).join(', ')}
Total: $${order.totalUSD.toFixed(2)} USD
Payment Method: ${order.paymentMethod}
Status: PENDING VERIFICATION
Created: ${order.createdAt}
`;

  // 1. If Resend email provider credentials are provided
  if (resendApiKey && adminEmail) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Ryvora Digital Orders <orders@ryvoradigital.com>',
          to: adminEmail,
          subject: `🚨 New Order: ${order.orderId} - $${order.totalUSD.toFixed(2)} (${order.customerEmail})`,
          text: orderSummary,
        }),
      });

      if (response.ok) {
        console.log(`[NOTIFICATION] Email alert sent via Resend to ${adminEmail} for order ${order.orderId}`);
        return { sent: true, channel: 'email' };
      } else {
        const errText = await response.text();
        console.warn(`[NOTIFICATION] Resend dispatch failed: ${errText}`);
      }
    } catch (err: any) {
      console.warn(`[NOTIFICATION] Failed to send email alert: ${err.message}`);
    }
  }

  // 2. If Webhook URL is configured (e.g. Discord, Slack, Zapier, Telegram bot)
  if (webhookUrl) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: orderSummary,
          order,
        }),
      });

      if (response.ok) {
        console.log(`[NOTIFICATION] Webhook alert sent to ${webhookUrl} for order ${order.orderId}`);
        return { sent: true, channel: 'webhook' };
      }
    } catch (err: any) {
      console.warn(`[NOTIFICATION] Failed to post webhook alert: ${err.message}`);
    }
  }

  // 3. Fallback: Log structured order alert
  console.log(orderSummary);
  return { sent: false, channel: 'console', message: 'No external email provider configured; logged to console.' };
}
