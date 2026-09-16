import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { Modules } from "@medusajs/framework/utils";
import nodemailer from "nodemailer";

// One.com transporter - EXACT same working configuration as your contact form!
const transporter = nodemailer.createTransport({
  host: "send.one.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER, // info@modura.be
    pass: process.env.EMAIL_PASSWORD, // your email password
  },
  tls: {
    rejectUnauthorized: true,
  },
});

// Verify SMTP connection on startup
transporter.verify((error) => {
  if (error) {
    console.error("❌ SMTP connection failed:", error);
  } else {
    console.log("✅ SMTP server ready - will send order confirmation emails");
  }
});

export default async function handleOrderPlaced({ event: { data }, container }: SubscriberArgs<{ id: string }>) {
  const orderId = data.id;
  console.log(`📦 New order placed: ${orderId} - preparing to send confirmation email...`);

  try {
    // Get the order details from Medusa
    const query = container.resolve("query");
    
    const orderResult = await query.graph({
      entity: "order",
      fields: ["email", "display_id", "total", "currency_code", "created_at"],
      filters: { id: orderId },
    });

    const order = orderResult.data[0];
    
    if (!order?.email) {
      console.error("❌ Could not send email - order has no email address");
      return;
    }

    // Send the order confirmation email
    const info = await transporter.sendMail({
      from: "Modura <info@modura.be>",
      to: order.email,
      subject: `Your order #${order.display_id} is confirmed - Modura`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Order Confirmation - Modura</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
            .header { background: #0F172A; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
            .content { padding: 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px; }
            .order-number { background: #dbeafe; border-left: 4px solid #2563EB; padding: 15px; margin: 15px 0; border-radius: 0 6px 6px 0; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1 style="margin:0; font-size:22px;">🎉 Thank you for your order!</h1>
            <p style="margin:5px 0 0 0; opacity:0.8;">Your order has been received and is being processed</p>
          </div>
          <div class="content">
            <div class="order-number">
              <strong>Order #${order.display_id}</strong><br>
              Placed on ${new Date(order.created_at).toLocaleDateString('en-US')}
            </div>
            
            <p>Hello,</p>
            <p>We've successfully received your order and are preparing it for shipment. You'll receive another email once your order has been dispatched.</p>
            
            <p>If you have any questions, reply to this email or contact us at info@modura.be</p>
            
            <p>Best regards,<br>The Modura Team</p>
          </div>
        </body>
        </html>
      `,
    });

    console.log(`✅ Order confirmation email sent to ${order.email}! Message ID: ${info.messageId}`);
    
  } catch (error) {
    console.error("❌ Error sending order confirmation email:", error);
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
};