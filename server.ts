import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { PRODUCTS } from './src/data/products.ts';
import { REVIEWS, LIVE_ACTIVATIONS } from './src/data/reviews.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Persistent Database Directory & File
const DATA_DIR = path.resolve(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const INITIAL_COUPONS = [
  { code: 'USA10', discountPercent: 10, description: '10% USA Community Welcome Discount', active: true, usageCount: 142 },
  { code: 'VIP20', discountPercent: 20, description: '20% VIP Creator Program', active: true, usageCount: 68 },
  { code: 'CREATOR15', discountPercent: 15, description: '15% Discount on AI & Design Licenses', active: true, usageCount: 39 },
  { code: 'FLASH50', discountPercent: 50, description: 'Limited Flash Deal for Annual Bundles', active: false, usageCount: 12 },
];

const INITIAL_ORDERS = [
  {
    orderId: 'RYV-94821-US',
    customerEmail: 'austin.dev@gmail.com',
    customerPhone: '+1 (512) 883-9120',
    items: [
      {
        product: PRODUCTS[0],
        duration: '1_year',
        accountType: 'private_account',
        quantity: 1,
        priceUSD: 80.91,
      },
    ],
    subtotalUSD: 80.91,
    discountUSD: 8.09,
    totalUSD: 72.82,
    paymentMethod: 'Credit/Debit Card (Stripe USA)',
    status: 'delivered',
    createdAt: 'Today, 01:14 AM',
    credentials: {
      licenseKey: 'RYV-GPT4O-PRO-94821-US',
      accountEmail: 'austin.dev@gmail.com',
      instructions: 'Credentials dispatched to customer inbox automatically.',
    },
  },
  {
    orderId: 'RYV-83719-US',
    customerEmail: 'elena.design@creativeagency.us',
    customerPhone: '+1 (415) 309-8472',
    items: [
      {
        product: PRODUCTS[1],
        duration: '1_month',
        accountType: 'private_account',
        quantity: 2,
        priceUSD: 39.98,
      },
    ],
    subtotalUSD: 39.98,
    discountUSD: 0,
    totalUSD: 39.98,
    paymentMethod: 'Apple Pay Express',
    status: 'delivered',
    createdAt: 'Yesterday, 04:32 PM',
    credentials: {
      licenseKey: 'RYV-ADOBE-CC-83719-US',
      accountEmail: 'elena.design@creativeagency.us',
      instructions: 'Adobe CC team seats allocated and active.',
    },
  },
  {
    orderId: 'RYV-71934-US',
    customerEmail: 'marcus.v@protonmail.com',
    items: [
      {
        product: PRODUCTS[3],
        duration: '3_months',
        accountType: 'private_account',
        quantity: 1,
        priceUSD: 29.67,
      },
    ],
    subtotalUSD: 29.67,
    discountUSD: 2.97,
    totalUSD: 26.70,
    paymentMethod: 'PayPal Verified',
    status: 'delivered',
    createdAt: '2 days ago',
    credentials: {
      licenseKey: 'RYV-CURSOR-AI-71934-US',
      accountEmail: 'marcus.v@protonmail.com',
      instructions: 'Cursor AI Pro fast license token generated.',
    },
  },
];

interface DBStructure {
  products: any[];
  orders: any[];
  coupons: any[];
  reviews: any[];
  activations: any[];
  announcement: string;
}

function loadDB(): DBStructure {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DB_FILE)) {
      const content = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed && Array.isArray(parsed.orders)) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('Error reading db.json, re-initializing:', err);
  }

  const initialData: DBStructure = {
    products: PRODUCTS,
    orders: INITIAL_ORDERS,
    coupons: INITIAL_COUPONS,
    reviews: REVIEWS,
    activations: LIVE_ACTIVATIONS,
    announcement: '✦ USA #1 Digital Tools Reseller ✦ Instant Delivery (60-180s) ✦ 100% Replacement Warranty Guarantee ✦ Code "USA10" for 10% OFF',
  };

  saveDB(initialData);
  return initialData;
}

function saveDB(data: DBStructure) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving db.json:', err);
  }
}

let db = loadDB();

// API Endpoints

// 1. ORDERS
app.get('/api/orders', (req, res) => {
  res.json({ success: true, orders: db.orders });
});

app.post('/api/orders', (req, res) => {
  try {
    const { customerEmail, customerPhone, items, subtotalUSD, discountUSD, totalUSD, paymentMethod, paymentProof, transactionId } = req.body;

    if (!customerEmail || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid order data: email and items are required.' });
    }

    const orderNumber = Math.floor(10000 + Math.random() * 90000);
    const orderId = `RYV-${orderNumber}-US`;

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    const createdAt = `Today, ${timeStr} (${dateStr})`;

    const newOrder = {
      orderId,
      customerEmail: String(customerEmail).trim(),
      customerPhone: customerPhone ? String(customerPhone).trim() : undefined,
      items,
      subtotalUSD: Number(subtotalUSD || 0),
      discountUSD: Number(discountUSD || 0),
      totalUSD: Number(totalUSD || 0),
      paymentMethod: paymentMethod || 'Online Payment',
      paymentProof: paymentProof || undefined,
      transactionId: transactionId ? String(transactionId).trim() : undefined,
      status: 'processing',
      createdAt,
      credentials: undefined,
    };

    // Prepend new order (newest first)
    db.orders.unshift(newOrder);

    // Also add to live activations feed for storefront social proof
    const firstItem = items[0];
    const emailPrefix = customerEmail.split('@')[0] || 'customer';
    const masked = emailPrefix.length > 2 
      ? emailPrefix.charAt(0) + '****' + emailPrefix.charAt(emailPrefix.length - 1) + '@' + (customerEmail.split('@')[1] || 'gmail.com')
      : 'c****@gmail.com';

    const cities = ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'San Antonio', 'San Diego', 'Dallas', 'Austin'];
    const states = ['NY', 'CA', 'IL', 'TX', 'AZ', 'PA', 'TX', 'CA', 'TX', 'TX'];
    const randIdx = Math.floor(Math.random() * cities.length);

    const newActivation = {
      id: `act-${Date.now()}`,
      productName: firstItem?.product?.name || 'ChatGPT Plus & Team',
      category: firstItem?.product?.category || 'ai',
      customerMasked: masked,
      city: cities[randIdx],
      state: states[randIdx],
      minutesAgo: 1,
      planDuration: firstItem?.duration ? String(firstItem.duration).replace('_', ' ') : '1 Month',
    };

    db.activations.unshift(newActivation);
    if (db.activations.length > 20) {
      db.activations = db.activations.slice(0, 20);
    }

    saveDB(db);

    console.log(`[ORDER CREATED] ${orderId} by ${customerEmail} ($${totalUSD})`);
    res.status(201).json({ success: true, order: newOrder });
  } catch (err: any) {
    console.error('Error creating order:', err);
    res.status(500).json({ success: false, message: 'Server error processing order: ' + err.message });
  }
});

// Track specific order
app.get('/api/orders/track', (req, res) => {
  const query = String(req.query.query || '').trim().toLowerCase();
  if (!query) {
    return res.status(400).json({ success: false, message: 'Query parameter required.' });
  }

  const match = db.orders.find(
    (o) =>
      o.orderId.toLowerCase() === query ||
      o.customerEmail.toLowerCase() === query ||
      (o.credentials?.licenseKey && o.credentials.licenseKey.toLowerCase() === query)
  );

  if (match) {
    res.json({ success: true, order: match });
  } else {
    res.status(404).json({ success: false, message: 'No matching order found.' });
  }
});

// Update order status or license
app.patch('/api/orders/:id', (req, res) => {
  const orderId = req.params.id;
  const { status, credentials } = req.body;

  const idx = db.orders.findIndex((o) => o.orderId === orderId);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'Order not found.' });
  }

  if (status) db.orders[idx].status = status;
  if (credentials) {
    db.orders[idx].credentials = {
      ...db.orders[idx].credentials,
      ...credentials,
    };
  }

  saveDB(db);
  res.json({ success: true, order: db.orders[idx] });
});

// Delete order
app.delete('/api/orders/:id', (req, res) => {
  const orderId = req.params.id;
  db.orders = db.orders.filter((o) => o.orderId !== orderId);
  saveDB(db);
  res.json({ success: true });
});

// 2. PRODUCTS
app.get('/api/products', (req, res) => {
  res.json({ success: true, products: db.products });
});

app.post('/api/products', (req, res) => {
  const newProduct = req.body;
  db.products.push(newProduct);
  saveDB(db);
  res.status(201).json({ success: true, product: newProduct });
});

app.put('/api/products/:id', (req, res) => {
  const id = req.params.id;
  const updated = req.body;
  const idx = db.products.findIndex((p) => p.id === id);
  if (idx > -1) {
    db.products[idx] = { ...db.products[idx], ...updated };
    saveDB(db);
    res.json({ success: true, product: db.products[idx] });
  } else {
    res.status(404).json({ success: false, message: 'Product not found' });
  }
});

app.delete('/api/products/:id', (req, res) => {
  const id = req.params.id;
  db.products = db.products.filter((p) => p.id !== id);
  saveDB(db);
  res.json({ success: true });
});

// 3. COUPONS
app.get('/api/coupons', (req, res) => {
  res.json({ success: true, coupons: db.coupons });
});

app.post('/api/coupons', (req, res) => {
  const newCoupon = req.body;
  db.coupons.push(newCoupon);
  saveDB(db);
  res.status(201).json({ success: true, coupon: newCoupon });
});

app.patch('/api/coupons/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  const idx = db.coupons.findIndex((c) => c.code.toUpperCase() === code);
  if (idx > -1) {
    db.coupons[idx].active = !db.coupons[idx].active;
    saveDB(db);
    res.json({ success: true, coupon: db.coupons[idx] });
  } else {
    res.status(404).json({ success: false, message: 'Coupon not found' });
  }
});

app.delete('/api/coupons/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  db.coupons = db.coupons.filter((c) => c.code.toUpperCase() !== code);
  saveDB(db);
  res.json({ success: true });
});

// 4. ACTIVATIONS
app.get('/api/activations', (req, res) => {
  res.json({ success: true, activations: db.activations });
});

app.post('/api/activations', (req, res) => {
  const act = req.body;
  db.activations.unshift(act);
  saveDB(db);
  res.status(201).json({ success: true, activation: act });
});

app.delete('/api/activations/:id', (req, res) => {
  const id = req.params.id;
  db.activations = db.activations.filter((a) => a.id !== id);
  saveDB(db);
  res.json({ success: true });
});

// 5. ANNOUNCEMENT
app.get('/api/announcement', (req, res) => {
  res.json({ success: true, announcement: db.announcement });
});

app.post('/api/announcement', (req, res) => {
  db.announcement = req.body.text || '';
  saveDB(db);
  res.json({ success: true, announcement: db.announcement });
});

// 6. HEALTH
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ordersCount: db.orders.length, time: new Date().toISOString() });
});

// Setup Vite or Static serving
async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true, host: '0.0.0.0', port: PORT },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[RYVORA SERVER] Running live on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
