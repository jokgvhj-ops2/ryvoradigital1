import express, { Request, Response } from 'express';
import {
  initDatabase,
  getOrders,
  getOrderById,
  createOrder,
  updateOrder,
  deleteOrder,
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  getCoupons,
  getCouponByCode,
  createCoupon,
  toggleCoupon,
  deleteCoupon,
  getReviews,
  getActivations,
  createActivation,
  deleteActivation,
  getAnnouncement,
  updateAnnouncement,
  savePaymentProof,
  getPaymentProof,
} from './db';
import { verifyAdminPassword, generateAdminToken, requireAdmin, validateAdminToken } from './auth';
import { notifyNewOrder } from './notifications';
import { CustomerOrder, PlanDuration } from '../types';

export const app = express();

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Basic Security Headers & CORS
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Initialize database on first call
initDatabase().catch((err) => console.error('[APP] Database init error:', err));

// -------------------------------------------------------------
// 1. ADMIN AUTHENTICATION ENDPOINTS
// -------------------------------------------------------------
app.post('/api/admin/login', (req: Request, res: Response) => {
  const { password } = req.body || {};

  if (!password || typeof password !== 'string') {
    return res.status(400).json({ success: false, message: 'Admin passcode is required.' });
  }

  const isValid = verifyAdminPassword(password);
  if (!isValid) {
    return res.status(401).json({
      success: false,
      message: 'Invalid admin passcode. Access denied.',
    });
  }

  const { token, expiresAt } = generateAdminToken();
  return res.json({
    success: true,
    token,
    expiresAt,
    message: 'Authentication successful.',
  });
});

app.get('/api/admin/verify', requireAdmin, (req: Request, res: Response) => {
  res.json({ success: true, authenticated: true });
});

// -------------------------------------------------------------
// 2. PAYMENT PROOF UPLOAD & SERVING
// -------------------------------------------------------------
app.post('/api/upload', async (req: Request, res: Response) => {
  try {
    const { image, filename } = req.body || {};
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ success: false, message: 'Valid image data required.' });
    }

    if (!image.startsWith('data:image/')) {
      return res.status(400).json({ success: false, message: 'Image must be a valid image format.' });
    }

    const proofUrl = await savePaymentProof(image, filename);
    res.json({ success: true, url: proofUrl });
  } catch (err: any) {
    console.error('Error in /api/upload:', err);
    res.status(500).json({ success: false, message: 'Failed to process image upload.' });
  }
});

app.get('/api/proofs/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const proof = await getPaymentProof(id);

    if (!proof) {
      return res.status(404).send('Payment proof not found.');
    }

    const base64Data = proof.data.replace(/^data:[^;]+;base64,/, '');
    const imgBuffer = Buffer.from(base64Data, 'base64');

    res.setHeader('Content-Type', proof.mimeType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Length', imgBuffer.length);
    res.end(imgBuffer);
  } catch (err: any) {
    console.error('Error serving proof:', err);
    res.status(500).send('Error retrieving payment proof.');
  }
});

// -------------------------------------------------------------
// 3. ORDERS (ADMIN & PUBLIC WORKFLOWS)
// -------------------------------------------------------------

// Admin only: Get all customer orders
app.get('/api/orders', requireAdmin, async (req: Request, res: Response) => {
  try {
    const orders = await getOrders();
    res.json({ success: true, orders });
  } catch (err: any) {
    console.error('Error getting orders:', err);
    res.status(500).json({ success: false, message: 'Failed to load orders: ' + err.message });
  }
});

// Public: Customer Checkout Order Submission with Server-Side Validation
const DURATION_MULTIPLIERS: Record<string, number> = {
  '1_month': 1.0,
  '3_months': 2.7,
  '6_months': 5.0,
  '1_year': 9.0,
};

app.post('/api/orders', async (req: Request, res: Response) => {
  try {
    const {
      customerEmail,
      customerPhone,
      items,
      couponCode,
      paymentMethod,
      paymentProof,
      transactionId,
    } = req.body || {};

    // 1. Email validation
    if (!customerEmail || typeof customerEmail !== 'string') {
      return res.status(400).json({ success: false, message: 'Valid customer email is required.' });
    }
    const cleanEmail = customerEmail.trim();
    if (!cleanEmail.includes('@') || cleanEmail.length < 5) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
    }

    // 2. Items validation
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Shopping cart must contain at least one item.' });
    }

    // 3. Payment Method & Proof
    if (!paymentMethod || typeof paymentMethod !== 'string') {
      return res.status(400).json({ success: false, message: 'Payment method selection is required.' });
    }

    if (!paymentProof || typeof paymentProof !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'A screenshot proof of payment receipt is required before submitting.',
      });
    }

    // 4. Server-Side Price Calculation & Verification
    let verifiedSubtotalUSD = 0;
    const verifiedItems: any[] = [];

    for (const item of items) {
      const prodId = item.product?.id || item.productId;
      if (!prodId) {
        return res.status(400).json({ success: false, message: 'Invalid product item format in cart.' });
      }

      const dbProduct = await getProductById(prodId);
      if (!dbProduct) {
        return res.status(400).json({
          success: false,
          message: `Product "${item.product?.name || prodId}" is not available in our current catalog.`,
        });
      }

      const duration: PlanDuration = item.duration || '1_month';
      const multiplier = DURATION_MULTIPLIERS[duration] || 1.0;
      const verifiedUnitPrice = Number((dbProduct.priceUSD * multiplier).toFixed(2));
      const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);

      verifiedSubtotalUSD += verifiedUnitPrice * quantity;
      verifiedItems.push({
        product: dbProduct,
        duration,
        accountType: item.accountType || dbProduct.allowedAccountTypes[0] || 'private_account',
        quantity,
        priceUSD: verifiedUnitPrice,
      });
    }

    verifiedSubtotalUSD = Number(verifiedSubtotalUSD.toFixed(2));

    // 5. Server-Side Coupon Validation
    let verifiedDiscountUSD = 0;
    let appliedCouponObj = null;

    if (couponCode && typeof couponCode === 'string' && couponCode.trim()) {
      const cleanCoupon = couponCode.trim().toUpperCase();
      const dbCoupon = await getCouponByCode(cleanCoupon);
      if (dbCoupon && dbCoupon.active) {
        appliedCouponObj = dbCoupon;
        verifiedDiscountUSD = Number(((verifiedSubtotalUSD * dbCoupon.discountPercent) / 100).toFixed(2));
      }
    }

    const verifiedTotalUSD = Math.max(0, Number((verifiedSubtotalUSD - verifiedDiscountUSD).toFixed(2)));

    // 6. Handle Payment Proof Storage
    let savedProofUrl = paymentProof;
    if (paymentProof.startsWith('data:image/')) {
      savedProofUrl = await savePaymentProof(paymentProof, `proof_${cleanEmail.replace(/[^a-zA-Z0-9]/g, '')}.jpg`);
    }

    // 7. Generate Unique Order ID
    const orderNumber = Math.floor(10000 + Math.random() * 90000);
    const orderId = `RYV-${orderNumber}-US`;

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    const createdAt = `Today, ${timeStr} (${dateStr})`;

    const newOrder: CustomerOrder & { isNew?: boolean } = {
      orderId,
      customerEmail: cleanEmail,
      customerPhone: customerPhone ? String(customerPhone).trim() : undefined,
      items: verifiedItems,
      subtotalUSD: verifiedSubtotalUSD,
      discountUSD: verifiedDiscountUSD,
      totalUSD: verifiedTotalUSD,
      coupon: couponCode ? String(couponCode).trim().toUpperCase() : undefined,
      paymentMethod: paymentMethod.trim(),
      paymentProof: savedProofUrl,
      transactionId: transactionId ? String(transactionId).trim() : undefined,
      status: 'processing',
      createdAt,
      credentials: undefined,
      isNew: true,
    };

    // Save permanently to database
    await createOrder(newOrder);

    // Increment coupon usage if used
    if (appliedCouponObj) {
      await createCoupon({
        ...appliedCouponObj,
        usageCount: appliedCouponObj.usageCount + 1,
      });
    }

    // Add to live activations feed for storefront social proof
    const firstItem = verifiedItems[0];
    const emailPrefix = cleanEmail.split('@')[0] || 'customer';
    const masked =
      emailPrefix.length > 2
        ? emailPrefix.charAt(0) + '****' + emailPrefix.charAt(emailPrefix.length - 1) + '@' + (cleanEmail.split('@')[1] || 'gmail.com')
        : 'c****@gmail.com';

    const cities = ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'San Antonio', 'San Diego', 'Dallas', 'Austin'];
    const states = ['NY', 'CA', 'IL', 'TX', 'AZ', 'PA', 'TX', 'CA', 'TX', 'TX'];
    const randIdx = Math.floor(Math.random() * cities.length);

    await createActivation({
      id: `act-${Date.now()}`,
      productName: firstItem?.product?.name || 'ChatGPT Plus & Team',
      category: firstItem?.product?.category || 'ai',
      customerMasked: masked,
      city: cities[randIdx],
      state: states[randIdx],
      minutesAgo: 1,
      planDuration: firstItem?.duration ? String(firstItem.duration).replace('_', ' ') : '1 Month',
    });

    // Dispatch asynchronous order alert notification
    notifyNewOrder(newOrder).catch((e) => console.error('Notification dispatch error:', e));

    console.log(`[ORDER CREATED] ${orderId} by ${cleanEmail} ($${verifiedTotalUSD} USD)`);
    res.status(201).json({ success: true, order: newOrder });
  } catch (err: any) {
    console.error('Error creating order:', err);
    res.status(500).json({ success: false, message: 'Server error creating order: ' + err.message });
  }
});

// Order Tracking: Secure lookup requiring Order ID + Matching Customer Email
app.get('/api/orders/track', async (req: Request, res: Response) => {
  try {
    const rawQuery = String(req.query.query || '').trim();
    const orderIdParam = String(req.query.orderId || '').trim();
    const emailParam = String(req.query.email || req.query.customerEmail || '').trim().toLowerCase();
    const authHeader = req.headers.authorization || (req.headers['x-admin-token'] as string);
    const isAdmin = validateAdminToken(authHeader);

    // If query string has single param (e.g. RYV-94821-US)
    const targetOrderId = (orderIdParam || rawQuery).toUpperCase();
    const targetEmail = (emailParam || (rawQuery.includes('@') ? rawQuery : '')).toLowerCase();

    if (!targetOrderId && !targetEmail) {
      return res.status(400).json({
        success: false,
        message: 'Order ID and Customer Email are required for order tracking.',
      });
    }

    const allOrders = await getOrders();

    // 1. If admin, allow searching by orderId or email directly
    if (isAdmin) {
      const match = allOrders.find(
        (o) =>
          o.orderId.toUpperCase() === targetOrderId ||
          o.customerEmail.toLowerCase() === targetEmail ||
          (o.credentials?.licenseKey && o.credentials.licenseKey.toUpperCase() === targetOrderId)
      );
      if (match) return res.json({ success: true, order: match });
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    // 2. Customer Tracking: Require verification
    // Find order by ID first
    let match = allOrders.find((o) => o.orderId.toUpperCase() === targetOrderId);

    // If searched by email only without order ID
    if (!match && targetEmail && !orderIdParam) {
      match = allOrders.find((o) => o.customerEmail.toLowerCase() === targetEmail);
    }

    if (!match) {
      return res.status(404).json({
        success: false,
        message: 'No order found matching the provided reference.',
      });
    }

    // Privacy & Security Check: If email is provided, must match!
    if (targetEmail && match.customerEmail.toLowerCase() !== targetEmail) {
      return res.status(403).json({
        success: false,
        message: 'Verification failed: The email address does not match this Order ID record.',
      });
    }

    // If no email was provided and query is solely Order ID:
    // To prevent arbitrary enumeration of credentials, if credentials exist, require customer email match!
    if (!targetEmail && match.credentials?.licenseKey) {
      return res.status(401).json({
        success: false,
        requiresEmail: true,
        orderId: match.orderId,
        status: match.status,
        message: 'Please enter your checkout email address to unlock license credentials.',
      });
    }

    res.json({ success: true, order: match });
  } catch (err: any) {
    console.error('Error tracking order:', err);
    res.status(500).json({ success: false, message: 'Error tracking order: ' + err.message });
  }
});

// Admin only: Update order status or credentials
app.patch('/api/orders/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const orderId = req.params.id;
    const { status, credentials, isNew, licenseKey, accountEmail, deliveryInstructions } = req.body || {};

    const updated = await updateOrder(orderId, {
      status,
      credentials,
      isNew,
      licenseKey,
      accountEmail,
      deliveryInstructions,
    });
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    res.json({ success: true, order: updated });
  } catch (err: any) {
    console.error('Error updating order:', err);
    res.status(500).json({ success: false, message: 'Error updating order: ' + err.message });
  }
});

// Admin only: Delete order
app.delete('/api/orders/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const orderId = req.params.id;
    const ok = await deleteOrder(orderId);
    if (!ok) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    res.json({ success: true, message: 'Order deleted successfully.' });
  } catch (err: any) {
    console.error('Error deleting order:', err);
    res.status(500).json({ success: false, message: 'Error deleting order: ' + err.message });
  }
});

// -------------------------------------------------------------
// 4. PRODUCTS (PUBLIC READ, ADMIN WRITE)
// -------------------------------------------------------------
app.get('/api/products', async (req: Request, res: Response) => {
  try {
    const products = await getProducts();
    res.json({ success: true, products });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch products: ' + err.message });
  }
});

app.post('/api/products', requireAdmin, async (req: Request, res: Response) => {
  try {
    const newProduct = req.body;
    if (!newProduct || !newProduct.name || !newProduct.priceUSD) {
      return res.status(400).json({ success: false, message: 'Product name and price are required.' });
    }

    const created = await createProduct(newProduct);
    res.status(201).json({ success: true, product: created });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to create product: ' + err.message });
  }
});

app.put('/api/products/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const updated = await updateProduct(id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }
    res.json({ success: true, product: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to update product: ' + err.message });
  }
});

app.delete('/api/products/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const ok = await deleteProduct(id);
    if (!ok) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }
    res.json({ success: true, message: 'Product removed.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to delete product: ' + err.message });
  }
});

// -------------------------------------------------------------
// 5. COUPONS (PUBLIC READ, ADMIN WRITE)
// -------------------------------------------------------------
app.get('/api/coupons', async (req: Request, res: Response) => {
  try {
    const coupons = await getCoupons();
    res.json({ success: true, coupons });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch coupons: ' + err.message });
  }
});

app.post('/api/coupons', requireAdmin, async (req: Request, res: Response) => {
  try {
    const newCoupon = req.body;
    if (!newCoupon || !newCoupon.code || !newCoupon.discountPercent) {
      return res.status(400).json({ success: false, message: 'Coupon code and discount are required.' });
    }
    const created = await createCoupon(newCoupon);
    res.status(201).json({ success: true, coupon: created });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to create coupon: ' + err.message });
  }
});

app.patch('/api/coupons/:code', requireAdmin, async (req: Request, res: Response) => {
  try {
    const code = req.params.code;
    const toggled = await toggleCoupon(code);
    if (!toggled) {
      return res.status(404).json({ success: false, message: 'Coupon not found.' });
    }
    res.json({ success: true, coupon: toggled });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to toggle coupon: ' + err.message });
  }
});

app.delete('/api/coupons/:code', requireAdmin, async (req: Request, res: Response) => {
  try {
    const code = req.params.code;
    const ok = await deleteCoupon(code);
    if (!ok) {
      return res.status(404).json({ success: false, message: 'Coupon not found.' });
    }
    res.json({ success: true, message: 'Coupon deleted.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to delete coupon: ' + err.message });
  }
});

// -------------------------------------------------------------
// 6. REVIEWS & ACTIVATIONS
// -------------------------------------------------------------
app.get('/api/reviews', async (req: Request, res: Response) => {
  try {
    const reviews = await getReviews();
    res.json({ success: true, reviews });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch reviews: ' + err.message });
  }
});

app.get('/api/activations', async (req: Request, res: Response) => {
  try {
    const activations = await getActivations();
    res.json({ success: true, activations });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch activations: ' + err.message });
  }
});

app.post('/api/activations', requireAdmin, async (req: Request, res: Response) => {
  try {
    const act = req.body;
    const created = await createActivation(act);
    res.status(201).json({ success: true, activation: created });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to create activation: ' + err.message });
  }
});

app.delete('/api/activations/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const ok = await deleteActivation(id);
    if (!ok) {
      return res.status(404).json({ success: false, message: 'Activation not found.' });
    }
    res.json({ success: true, message: 'Activation deleted.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to delete activation: ' + err.message });
  }
});

// -------------------------------------------------------------
// 7. ANNOUNCEMENT BAR
// -------------------------------------------------------------
app.get('/api/announcement', async (req: Request, res: Response) => {
  try {
    const text = await getAnnouncement();
    res.json({ success: true, announcement: text });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch announcement: ' + err.message });
  }
});

app.post('/api/announcement', requireAdmin, async (req: Request, res: Response) => {
  try {
    const text = req.body?.text || '';
    const updated = await updateAnnouncement(text);
    res.json({ success: true, announcement: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Failed to update announcement: ' + err.message });
  }
});

// -------------------------------------------------------------
// 8. HEALTH STATUS
// -------------------------------------------------------------
app.get('/api/health', async (req: Request, res: Response) => {
  try {
    const orders = await getOrders();
    res.json({
      status: 'ok',
      service: 'Ryvora Digital Production Backend',
      ordersCount: orders.length,
      database: process.env.POSTGRES_URL || process.env.DATABASE_URL ? 'postgresql' : 'persistent-store',
      time: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// -------------------------------------------------------------
// 9. GLOBAL JSON ERROR HANDLER
// -------------------------------------------------------------
app.use((err: any, req: Request, res: Response, _next: any) => {
  console.error('[API SERVER ERROR]', err);
  const status = typeof err.status === 'number' ? err.status : typeof err.statusCode === 'number' ? err.statusCode : 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Internal server error occurred.',
  });
});

