import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { Product, CustomerOrder, PromoCoupon, CustomerReview, LiveActivation } from '../types';
import { PRODUCTS } from '../data/products';
import { REVIEWS, LIVE_ACTIVATIONS } from '../data/reviews';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PROOFS_DIR = path.join(DATA_DIR, 'proofs');

const INITIAL_COUPONS: PromoCoupon[] = [
  { code: 'USA10', discountPercent: 10, description: '10% USA Community Welcome Discount', active: true, usageCount: 142 },
  { code: 'VIP20', discountPercent: 20, description: '20% VIP Creator Program', active: true, usageCount: 68 },
  { code: 'CREATOR15', discountPercent: 15, description: '15% Discount on AI & Design Licenses', active: true, usageCount: 39 },
  { code: 'FLASH50', discountPercent: 50, description: 'Limited Flash Deal for Annual Bundles', active: false, usageCount: 12 },
];

const DEFAULT_ANNOUNCEMENT =
  '✦ USA #1 Digital Tools Reseller ✦ Instant Delivery (60-180s) ✦ 100% Replacement Warranty Guarantee ✦ Code "USA10" for 10% OFF';

// Check if PostgreSQL connection is provided
const pgConnectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
let pool: pg.Pool | null = null;
let isPostgres = false;

if (pgConnectionString) {
  try {
    pool = new Pool({
      connectionString: pgConnectionString,
      ssl:
        process.env.NODE_ENV === 'production' || !pgConnectionString.includes('localhost')
          ? { rejectUnauthorized: false }
          : false,
      max: 10,
      idleTimeoutMillis: 30000,
    });
    isPostgres = true;
    console.log('[DB] PostgreSQL pool configured with provided connection string.');
  } catch (err) {
    console.warn('[DB] Failed to initialize PostgreSQL pool, falling back to local persistent store:', err);
    pool = null;
    isPostgres = false;
  }
} else {
  console.log('[DB] No POSTGRES_URL / DATABASE_URL detected. Running with persistent storage adapter.');
}

// In-Memory / File Fallback cache
interface FallbackDB {
  products: Product[];
  orders: (CustomerOrder & { isNew?: boolean })[];
  coupons: PromoCoupon[];
  reviews: CustomerReview[];
  activations: LiveActivation[];
  announcement: string;
}

let fallbackDB: FallbackDB | null = null;
const proofCache = new Map<string, { mimeType: string; data: string; filename?: string }>();

function ensureFallbackDirs() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(PROOFS_DIR)) {
    fs.mkdirSync(PROOFS_DIR, { recursive: true });
  }
}

function loadFallbackDB(): FallbackDB {
  if (fallbackDB) return fallbackDB;
  ensureFallbackDirs();

  let initial: FallbackDB = {
    products: PRODUCTS,
    orders: [],
    coupons: INITIAL_COUPONS,
    reviews: REVIEWS,
    activations: LIVE_ACTIVATIONS,
    announcement: DEFAULT_ANNOUNCEMENT,
  };

  try {
    if (fs.existsSync(DB_FILE)) {
      const content = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed) {
        if (Array.isArray(parsed.products) && parsed.products.length > 0) initial.products = parsed.products;
        if (Array.isArray(parsed.orders)) initial.orders = parsed.orders;
        if (Array.isArray(parsed.coupons)) initial.coupons = parsed.coupons;
        if (Array.isArray(parsed.reviews)) initial.reviews = parsed.reviews;
        if (Array.isArray(parsed.activations)) initial.activations = parsed.activations;
        if (parsed.announcement) initial.announcement = parsed.announcement;
      }
    }
  } catch (err) {
    console.error('[DB] Error reading db.json:', err);
  }

  // Optimize orders: migrate any inline base64 paymentProof into separated proof storage
  let modified = false;
  initial.orders = initial.orders.map((o) => {
    if (o.paymentProof && o.paymentProof.startsWith('data:image/')) {
      const proofId = `proof-${o.orderId.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const mime = o.paymentProof.split(';')[0]?.replace('data:', '') || 'image/jpeg';
      proofCache.set(proofId, { mimeType: mime, data: o.paymentProof });
      try {
        fs.writeFileSync(path.join(PROOFS_DIR, `${proofId}.json`), JSON.stringify({ mimeType: mime, data: o.paymentProof }));
      } catch (e) {
        console.error('Error writing proof file:', e);
      }
      modified = true;
      return { ...o, paymentProof: `/api/proofs/${proofId}` };
    }
    return o;
  });

  if (modified) {
    saveFallbackDB(initial);
  }

  fallbackDB = initial;
  return fallbackDB;
}

function saveFallbackDB(data: FallbackDB) {
  try {
    ensureFallbackDirs();
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[DB] Error saving db.json:', err);
  }
}

// -------------------------------------------------------------
// POSTGRES SCHEMA INITIALIZATION & MIGRATION
// -------------------------------------------------------------
let isInitialized = false;

export async function initDatabase(): Promise<void> {
  if (isInitialized) return;

  if (isPostgres && pool) {
    try {
      const client = await pool.connect();
      try {
        console.log('[DB] Checking / creating PostgreSQL tables...');

        await client.query(`
          CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            tagline TEXT,
            category TEXT,
            category_label TEXT,
            icon_name TEXT,
            brand_color TEXT,
            accent_glow TEXT,
            rating NUMERIC DEFAULT 5.0,
            reviews_count INTEGER DEFAULT 1,
            features JSONB DEFAULT '[]'::jsonb,
            retail_price_usd NUMERIC NOT NULL,
            price_usd NUMERIC NOT NULL,
            in_stock BOOLEAN DEFAULT TRUE,
            popular BOOLEAN DEFAULT FALSE,
            featured BOOLEAN DEFAULT FALSE,
            badge TEXT,
            allowed_account_types JSONB DEFAULT '["private_account"]'::jsonb,
            description TEXT,
            delivery_time TEXT,
            warranty TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS orders (
            order_id TEXT PRIMARY KEY,
            customer_email TEXT NOT NULL,
            customer_phone TEXT,
            items JSONB NOT NULL,
            subtotal_usd NUMERIC NOT NULL,
            discount_usd NUMERIC DEFAULT 0,
            total_usd NUMERIC NOT NULL,
            payment_method TEXT NOT NULL,
            payment_proof TEXT,
            transaction_id TEXT,
            status TEXT DEFAULT 'processing',
            created_at TEXT NOT NULL,
            credentials JSONB,
            is_new BOOLEAN DEFAULT TRUE
          );

          CREATE TABLE IF NOT EXISTS coupons (
            code TEXT PRIMARY KEY,
            discount_percent INTEGER NOT NULL,
            description TEXT,
            active BOOLEAN DEFAULT TRUE,
            usage_count INTEGER DEFAULT 0
          );

          CREATE TABLE IF NOT EXISTS reviews (
            id TEXT PRIMARY KEY,
            author TEXT NOT NULL,
            location TEXT,
            product_name TEXT,
            rating INTEGER DEFAULT 5,
            comment TEXT,
            date TEXT,
            verified BOOLEAN DEFAULT TRUE
          );

          CREATE TABLE IF NOT EXISTS activations (
            id TEXT PRIMARY KEY,
            product_name TEXT NOT NULL,
            category TEXT,
            customer_masked TEXT,
            city TEXT,
            state TEXT,
            minutes_ago INTEGER DEFAULT 1,
            plan_duration TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS payment_proofs (
            id TEXT PRIMARY KEY,
            mime_type TEXT NOT NULL,
            data TEXT NOT NULL,
            filename TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);

        // Check if data seeding is needed
        const prodCountRes = await client.query('SELECT COUNT(*) FROM products');
        const prodCount = parseInt(prodCountRes.rows[0].count, 10);

        if (prodCount === 0) {
          console.log('[DB] Seeding initial products into PostgreSQL...');
          const sourceProducts = fallbackDB?.products || PRODUCTS;
          for (const p of sourceProducts) {
            await client.query(
              `INSERT INTO products (
                id, name, tagline, category, category_label, icon_name, brand_color, accent_glow,
                rating, reviews_count, features, retail_price_usd, price_usd, in_stock, popular,
                featured, badge, allowed_account_types, description, delivery_time, warranty
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
              ON CONFLICT (id) DO NOTHING`,
              [
                p.id, p.name, p.tagline, p.category, p.categoryLabel, p.iconName || 'Sparkles',
                p.brandColor, p.accentGlow, p.rating, p.reviewsCount, JSON.stringify(p.features),
                p.retailPriceUSD, p.priceUSD, p.inStock, p.popular ?? false, p.featured ?? false,
                p.badge || null, JSON.stringify(p.allowedAccountTypes), p.description, p.deliveryTime, p.warranty
              ]
            );
          }
        }

        const couponCountRes = await client.query('SELECT COUNT(*) FROM coupons');
        if (parseInt(couponCountRes.rows[0].count, 10) === 0) {
          for (const c of INITIAL_COUPONS) {
            await client.query(
              `INSERT INTO coupons (code, discount_percent, description, active, usage_count)
               VALUES ($1, $2, $3, $4, $5) ON CONFLICT (code) DO NOTHING`,
              [c.code, c.discountPercent, c.description, c.active, c.usageCount]
            );
          }
        }

        const revCountRes = await client.query('SELECT COUNT(*) FROM reviews');
        if (parseInt(revCountRes.rows[0].count, 10) === 0) {
          for (const r of REVIEWS) {
            await client.query(
              `INSERT INTO reviews (id, author, location, product_name, rating, comment, date, verified)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
              [r.id, r.author, r.location, r.productName, r.rating, r.comment, r.date, r.verified]
            );
          }
        }

        const actCountRes = await client.query('SELECT COUNT(*) FROM activations');
        if (parseInt(actCountRes.rows[0].count, 10) === 0) {
          for (const a of LIVE_ACTIVATIONS) {
            await client.query(
              `INSERT INTO activations (id, product_name, category, customer_masked, city, state, minutes_ago, plan_duration)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
              [a.id, a.productName, a.category, a.customerMasked, a.city, a.state, a.minutesAgo, a.planDuration]
            );
          }
        }

        const settingRes = await client.query("SELECT value FROM settings WHERE key = 'announcement'");
        if (settingRes.rows.length === 0) {
          await client.query(
            "INSERT INTO settings (key, value) VALUES ('announcement', $1) ON CONFLICT (key) DO NOTHING",
            [DEFAULT_ANNOUNCEMENT]
          );
        }

        // Migrate existing orders if table is empty and fallback orders exist
        const orderCountRes = await client.query('SELECT COUNT(*) FROM orders');
        if (parseInt(orderCountRes.rows[0].count, 10) === 0) {
          const fallback = loadFallbackDB();
          for (const o of fallback.orders) {
            await client.query(
              `INSERT INTO orders (
                order_id, customer_email, customer_phone, items, subtotal_usd, discount_usd,
                total_usd, payment_method, payment_proof, transaction_id, status, created_at, credentials, is_new
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
              ON CONFLICT (order_id) DO NOTHING`,
              [
                o.orderId, o.customerEmail, o.customerPhone || null, JSON.stringify(o.items),
                o.subtotalUSD, o.discountUSD, o.totalUSD, o.paymentMethod, o.paymentProof || null,
                o.transactionId || null, o.status, o.createdAt, JSON.stringify(o.credentials || null), false
              ]
            );
          }
        }

        console.log('[DB] PostgreSQL initialization complete.');
        isInitialized = true;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('[DB] PostgreSQL initialization error, defaulting to fallback adapter:', err);
      loadFallbackDB();
      isInitialized = true;
    }
  } else {
    loadFallbackDB();
    isInitialized = true;
  }
}

// -------------------------------------------------------------
// PAYMENT PROOF STORAGE
// -------------------------------------------------------------
export async function savePaymentProof(dataUriOrBase64: string, filename?: string): Promise<string> {
  await initDatabase();

  const id = `proof-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  let mimeType = 'image/jpeg';

  if (dataUriOrBase64.startsWith('data:')) {
    const matched = dataUriOrBase64.match(/^data:([^;]+);/);
    if (matched) mimeType = matched[1];
  }

  if (isPostgres && pool) {
    try {
      await pool.query(
        `INSERT INTO payment_proofs (id, mime_type, data, filename) VALUES ($1, $2, $3, $4)`,
        [id, mimeType, dataUriOrBase64, filename || 'payment_proof.jpg']
      );
      return `/api/proofs/${id}`;
    } catch (err) {
      console.error('[DB] Error saving proof to PostgreSQL:', err);
    }
  }

  // Fallback persistent storage
  ensureFallbackDirs();
  proofCache.set(id, { mimeType, data: dataUriOrBase64, filename });
  try {
    fs.writeFileSync(
      path.join(PROOFS_DIR, `${id}.json`),
      JSON.stringify({ mimeType, data: dataUriOrBase64, filename })
    );
  } catch (err) {
    console.error('[DB] Error writing proof fallback file:', err);
  }

  return `/api/proofs/${id}`;
}

export async function getPaymentProof(id: string): Promise<{ mimeType: string; data: string; filename?: string } | null> {
  await initDatabase();

  if (isPostgres && pool) {
    try {
      const res = await pool.query('SELECT mime_type, data, filename FROM payment_proofs WHERE id = $1', [id]);
      if (res.rows.length > 0) {
        return {
          mimeType: res.rows[0].mime_type,
          data: res.rows[0].data,
          filename: res.rows[0].filename,
        };
      }
    } catch (err) {
      console.error('[DB] Error querying proof from PostgreSQL:', err);
    }
  }

  // Fallback cache check
  if (proofCache.has(id)) {
    return proofCache.get(id)!;
  }

  const filePath = path.join(PROOFS_DIR, `${id}.json`);
  if (fs.existsSync(filePath)) {
    try {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      proofCache.set(id, content);
      return content;
    } catch {
      return null;
    }
  }

  return null;
}

// -------------------------------------------------------------
// ORDERS
// -------------------------------------------------------------
export async function getOrders(): Promise<(CustomerOrder & { isNew?: boolean })[]> {
  await initDatabase();

  if (isPostgres && pool) {
    try {
      const res = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
      return res.rows.map((row) => ({
        orderId: row.order_id,
        customerEmail: row.customer_email,
        customerPhone: row.customer_phone || undefined,
        items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items,
        subtotalUSD: parseFloat(row.subtotal_usd),
        discountUSD: parseFloat(row.discount_usd || 0),
        totalUSD: parseFloat(row.total_usd),
        paymentMethod: row.payment_method,
        paymentProof: row.payment_proof || undefined,
        transactionId: row.transaction_id || undefined,
        status: row.status as 'processing' | 'activated' | 'delivered',
        createdAt: row.created_at,
        credentials: row.credentials ? (typeof row.credentials === 'string' ? JSON.parse(row.credentials) : row.credentials) : undefined,
        isNew: row.is_new ?? false,
      }));
    } catch (err) {
      console.error('[DB] Error fetching orders from PostgreSQL:', err);
    }
  }

  const db = loadFallbackDB();
  return [...db.orders];
}

export async function getOrderById(orderId: string): Promise<(CustomerOrder & { isNew?: boolean }) | null> {
  await initDatabase();

  if (isPostgres && pool) {
    try {
      const res = await pool.query('SELECT * FROM orders WHERE order_id = $1', [orderId]);
      if (res.rows.length > 0) {
        const row = res.rows[0];
        return {
          orderId: row.order_id,
          customerEmail: row.customer_email,
          customerPhone: row.customer_phone || undefined,
          items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items,
          subtotalUSD: parseFloat(row.subtotal_usd),
          discountUSD: parseFloat(row.discount_usd || 0),
          totalUSD: parseFloat(row.total_usd),
          paymentMethod: row.payment_method,
          paymentProof: row.payment_proof || undefined,
          transactionId: row.transaction_id || undefined,
          status: row.status as 'processing' | 'activated' | 'delivered',
          createdAt: row.created_at,
          credentials: row.credentials ? (typeof row.credentials === 'string' ? JSON.parse(row.credentials) : row.credentials) : undefined,
          isNew: row.is_new ?? false,
        };
      }
      return null;
    } catch (err) {
      console.error('[DB] Error getting order from PostgreSQL:', err);
    }
  }

  const db = loadFallbackDB();
  return db.orders.find((o) => o.orderId === orderId) || null;
}

export async function createOrder(order: CustomerOrder & { isNew?: boolean }): Promise<CustomerOrder> {
  await initDatabase();

  if (isPostgres && pool) {
    try {
      await pool.query(
        `INSERT INTO orders (
          order_id, customer_email, customer_phone, items, subtotal_usd, discount_usd,
          total_usd, payment_method, payment_proof, transaction_id, status, created_at, credentials, is_new
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          order.orderId,
          order.customerEmail,
          order.customerPhone || null,
          JSON.stringify(order.items),
          order.subtotalUSD,
          order.discountUSD,
          order.totalUSD,
          order.paymentMethod,
          order.paymentProof || null,
          order.transactionId || null,
          order.status || 'processing',
          order.createdAt,
          JSON.stringify(order.credentials || null),
          order.isNew ?? true,
        ]
      );
      return order;
    } catch (err) {
      console.error('[DB] Error creating order in PostgreSQL:', err);
    }
  }

  const db = loadFallbackDB();
  db.orders.unshift(order);
  saveFallbackDB(db);
  return order;
}

export async function updateOrder(
  orderId: string,
  updates: { status?: string; credentials?: any; isNew?: boolean }
): Promise<CustomerOrder | null> {
  await initDatabase();

  if (isPostgres && pool) {
    try {
      const existing = await getOrderById(orderId);
      if (!existing) return null;

      const newStatus = updates.status || existing.status;
      const newCreds = updates.credentials ? { ...existing.credentials, ...updates.credentials } : existing.credentials;
      const newIsNew = updates.isNew !== undefined ? updates.isNew : existing.isNew;

      await pool.query(
        `UPDATE orders SET status = $1, credentials = $2, is_new = $3 WHERE order_id = $4`,
        [newStatus, JSON.stringify(newCreds || null), newIsNew, orderId]
      );

      return {
        ...existing,
        status: newStatus as any,
        credentials: newCreds,
        isNew: newIsNew,
      };
    } catch (err) {
      console.error('[DB] Error updating order in PostgreSQL:', err);
    }
  }

  const db = loadFallbackDB();
  const idx = db.orders.findIndex((o) => o.orderId === orderId);
  if (idx === -1) return null;

  if (updates.status) db.orders[idx].status = updates.status as any;
  if (updates.credentials) {
    db.orders[idx].credentials = {
      ...db.orders[idx].credentials,
      ...updates.credentials,
    };
  }
  if (updates.isNew !== undefined) {
    db.orders[idx].isNew = updates.isNew;
  }

  saveFallbackDB(db);
  return db.orders[idx];
}

export async function deleteOrder(orderId: string): Promise<boolean> {
  await initDatabase();

  if (isPostgres && pool) {
    try {
      const res = await pool.query('DELETE FROM orders WHERE order_id = $1', [orderId]);
      return (res.rowCount ?? 0) > 0;
    } catch (err) {
      console.error('[DB] Error deleting order in PostgreSQL:', err);
    }
  }

  const db = loadFallbackDB();
  const lenBefore = db.orders.length;
  db.orders = db.orders.filter((o) => o.orderId !== orderId);
  if (db.orders.length !== lenBefore) {
    saveFallbackDB(db);
    return true;
  }
  return false;
}

// -------------------------------------------------------------
// PRODUCTS
// -------------------------------------------------------------
export async function getProducts(): Promise<Product[]> {
  await initDatabase();

  if (isPostgres && pool) {
    try {
      const res = await pool.query('SELECT * FROM products ORDER BY price_usd ASC');
      return res.rows.map((row) => ({
        id: row.id,
        name: row.name,
        tagline: row.tagline || '',
        category: row.category,
        categoryLabel: row.category_label,
        iconName: row.icon_name || 'Sparkles',
        brandColor: row.brand_color,
        accentGlow: row.accent_glow,
        rating: parseFloat(row.rating),
        reviewsCount: parseInt(row.reviews_count, 10),
        features: typeof row.features === 'string' ? JSON.parse(row.features) : row.features,
        retailPriceUSD: parseFloat(row.retail_price_usd),
        priceUSD: parseFloat(row.price_usd),
        inStock: row.in_stock,
        popular: row.popular,
        featured: row.featured,
        badge: row.badge || undefined,
        allowedAccountTypes: typeof row.allowed_account_types === 'string' ? JSON.parse(row.allowed_account_types) : row.allowed_account_types,
        description: row.description,
        deliveryTime: row.delivery_time,
        warranty: row.warranty,
      }));
    } catch (err) {
      console.error('[DB] Error getting products from PostgreSQL:', err);
    }
  }

  const db = loadFallbackDB();
  return [...db.products];
}

export async function getProductById(id: string): Promise<Product | null> {
  await initDatabase();

  if (isPostgres && pool) {
    try {
      const res = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
      if (res.rows.length > 0) {
        const row = res.rows[0];
        return {
          id: row.id,
          name: row.name,
          tagline: row.tagline || '',
          category: row.category,
          categoryLabel: row.category_label,
          iconName: row.icon_name || 'Sparkles',
          brandColor: row.brand_color,
          accentGlow: row.accent_glow,
          rating: parseFloat(row.rating),
          reviewsCount: parseInt(row.reviews_count, 10),
          features: typeof row.features === 'string' ? JSON.parse(row.features) : row.features,
          retailPriceUSD: parseFloat(row.retail_price_usd),
          priceUSD: parseFloat(row.price_usd),
          inStock: row.in_stock,
          popular: row.popular,
          featured: row.featured,
          badge: row.badge || undefined,
          allowedAccountTypes: typeof row.allowed_account_types === 'string' ? JSON.parse(row.allowed_account_types) : row.allowed_account_types,
          description: row.description,
          deliveryTime: row.delivery_time,
          warranty: row.warranty,
        };
      }
      return null;
    } catch (err) {
      console.error('[DB] Error getting product by id from PostgreSQL:', err);
    }
  }

  const db = loadFallbackDB();
  return db.products.find((p) => p.id === id) || null;
}

export async function createProduct(prod: Product): Promise<Product> {
  await initDatabase();

  if (isPostgres && pool) {
    try {
      await pool.query(
        `INSERT INTO products (
          id, name, tagline, category, category_label, icon_name, brand_color, accent_glow,
          rating, reviews_count, features, retail_price_usd, price_usd, in_stock, popular,
          featured, badge, allowed_account_types, description, delivery_time, warranty
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, tagline = EXCLUDED.tagline, price_usd = EXCLUDED.price_usd`,
        [
          prod.id, prod.name, prod.tagline, prod.category, prod.categoryLabel, prod.iconName || 'Sparkles',
          prod.brandColor, prod.accentGlow, prod.rating, prod.reviewsCount, JSON.stringify(prod.features),
          prod.retailPriceUSD, prod.priceUSD, prod.inStock, prod.popular ?? false, prod.featured ?? false,
          prod.badge || null, JSON.stringify(prod.allowedAccountTypes), prod.description, prod.deliveryTime, prod.warranty
        ]
      );
      return prod;
    } catch (err) {
      console.error('[DB] Error creating product in PostgreSQL:', err);
    }
  }

  const db = loadFallbackDB();
  db.products.unshift(prod);
  saveFallbackDB(db);
  return prod;
}

export async function updateProduct(id: string, updates: Partial<Product>): Promise<Product | null> {
  await initDatabase();

  if (isPostgres && pool) {
    try {
      const existing = await getProductById(id);
      if (!existing) return null;

      const merged = { ...existing, ...updates };
      await pool.query(
        `UPDATE products SET
          name = $1, tagline = $2, price_usd = $3, retail_price_usd = $4, in_stock = $5,
          features = $6, description = $7, delivery_time = $8, warranty = $9
         WHERE id = $10`,
        [
          merged.name, merged.tagline, merged.priceUSD, merged.retailPriceUSD, merged.inStock,
          JSON.stringify(merged.features), merged.description, merged.deliveryTime, merged.warranty, id
        ]
      );
      return merged;
    } catch (err) {
      console.error('[DB] Error updating product in PostgreSQL:', err);
    }
  }

  const db = loadFallbackDB();
  const idx = db.products.findIndex((p) => p.id === id);
  if (idx === -1) return null;

  db.products[idx] = { ...db.products[idx], ...updates };
  saveFallbackDB(db);
  return db.products[idx];
}

export async function deleteProduct(id: string): Promise<boolean> {
  await initDatabase();

  if (isPostgres && pool) {
    try {
      const res = await pool.query('DELETE FROM products WHERE id = $1', [id]);
      return (res.rowCount ?? 0) > 0;
    } catch (err) {
      console.error('[DB] Error deleting product in PostgreSQL:', err);
    }
  }

  const db = loadFallbackDB();
  const len = db.products.length;
  db.products = db.products.filter((p) => p.id !== id);
  if (db.products.length !== len) {
    saveFallbackDB(db);
    return true;
  }
  return false;
}

// -------------------------------------------------------------
// COUPONS
// -------------------------------------------------------------
export async function getCoupons(): Promise<PromoCoupon[]> {
  await initDatabase();

  if (isPostgres && pool) {
    try {
      const res = await pool.query('SELECT * FROM coupons ORDER BY code ASC');
      return res.rows.map((r) => ({
        code: r.code,
        discountPercent: parseInt(r.discount_percent, 10),
        description: r.description,
        active: r.active,
        usageCount: parseInt(r.usage_count || 0, 10),
      }));
    } catch (err) {
      console.error('[DB] Error getting coupons from PostgreSQL:', err);
    }
  }

  const db = loadFallbackDB();
  return [...db.coupons];
}

export async function getCouponByCode(code: string): Promise<PromoCoupon | null> {
  await initDatabase();
  const cleanCode = code.trim().toUpperCase();

  if (isPostgres && pool) {
    try {
      const res = await pool.query('SELECT * FROM coupons WHERE UPPER(code) = $1', [cleanCode]);
      if (res.rows.length > 0) {
        const r = res.rows[0];
        return {
          code: r.code,
          discountPercent: parseInt(r.discount_percent, 10),
          description: r.description,
          active: r.active,
          usageCount: parseInt(r.usage_count || 0, 10),
        };
      }
      return null;
    } catch (err) {
      console.error('[DB] Error querying coupon from PostgreSQL:', err);
    }
  }

  const db = loadFallbackDB();
  return db.coupons.find((c) => c.code.toUpperCase() === cleanCode) || null;
}

export async function createCoupon(coupon: PromoCoupon): Promise<PromoCoupon> {
  await initDatabase();
  coupon.code = coupon.code.toUpperCase();

  if (isPostgres && pool) {
    try {
      await pool.query(
        `INSERT INTO coupons (code, discount_percent, description, active, usage_count)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (code) DO UPDATE SET discount_percent = EXCLUDED.discount_percent, active = EXCLUDED.active`,
        [coupon.code, coupon.discountPercent, coupon.description, coupon.active, coupon.usageCount]
      );
      return coupon;
    } catch (err) {
      console.error('[DB] Error creating coupon in PostgreSQL:', err);
    }
  }

  const db = loadFallbackDB();
  db.coupons.push(coupon);
  saveFallbackDB(db);
  return coupon;
}

export async function toggleCoupon(code: string): Promise<PromoCoupon | null> {
  await initDatabase();
  const cleanCode = code.toUpperCase();

  if (isPostgres && pool) {
    try {
      const existing = await getCouponByCode(cleanCode);
      if (!existing) return null;
      const newActive = !existing.active;
      await pool.query('UPDATE coupons SET active = $1 WHERE UPPER(code) = $2', [newActive, cleanCode]);
      return { ...existing, active: newActive };
    } catch (err) {
      console.error('[DB] Error toggling coupon in PostgreSQL:', err);
    }
  }

  const db = loadFallbackDB();
  const idx = db.coupons.findIndex((c) => c.code.toUpperCase() === cleanCode);
  if (idx === -1) return null;

  db.coupons[idx].active = !db.coupons[idx].active;
  saveFallbackDB(db);
  return db.coupons[idx];
}

export async function deleteCoupon(code: string): Promise<boolean> {
  await initDatabase();
  const cleanCode = code.toUpperCase();

  if (isPostgres && pool) {
    try {
      const res = await pool.query('DELETE FROM coupons WHERE UPPER(code) = $1', [cleanCode]);
      return (res.rowCount ?? 0) > 0;
    } catch (err) {
      console.error('[DB] Error deleting coupon in PostgreSQL:', err);
    }
  }

  const db = loadFallbackDB();
  const len = db.coupons.length;
  db.coupons = db.coupons.filter((c) => c.code.toUpperCase() !== cleanCode);
  if (db.coupons.length !== len) {
    saveFallbackDB(db);
    return true;
  }
  return false;
}

// -------------------------------------------------------------
// REVIEWS
// -------------------------------------------------------------
export async function getReviews(): Promise<CustomerReview[]> {
  await initDatabase();

  if (isPostgres && pool) {
    try {
      const res = await pool.query('SELECT * FROM reviews ORDER BY id ASC');
      return res.rows.map((r) => ({
        id: r.id,
        author: r.author,
        location: r.location || '',
        productName: r.product_name || '',
        rating: r.rating,
        comment: r.comment,
        date: r.date,
        verified: r.verified,
      }));
    } catch (err) {
      console.error('[DB] Error getting reviews from PostgreSQL:', err);
    }
  }

  const db = loadFallbackDB();
  return [...db.reviews];
}

// -------------------------------------------------------------
// ACTIVATIONS
// -------------------------------------------------------------
export async function getActivations(): Promise<LiveActivation[]> {
  await initDatabase();

  if (isPostgres && pool) {
    try {
      const res = await pool.query('SELECT * FROM activations ORDER BY created_at DESC LIMIT 25');
      return res.rows.map((r) => ({
        id: r.id,
        productName: r.product_name,
        category: r.category,
        customerMasked: r.customer_masked,
        city: r.city,
        state: r.state,
        minutesAgo: r.minutes_ago,
        planDuration: r.plan_duration,
      }));
    } catch (err) {
      console.error('[DB] Error getting activations from PostgreSQL:', err);
    }
  }

  const db = loadFallbackDB();
  return [...db.activations];
}

export async function createActivation(act: LiveActivation): Promise<LiveActivation> {
  await initDatabase();

  if (isPostgres && pool) {
    try {
      await pool.query(
        `INSERT INTO activations (id, product_name, category, customer_masked, city, state, minutes_ago, plan_duration)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [act.id, act.productName, act.category, act.customerMasked, act.city, act.state, act.minutesAgo, act.planDuration]
      );
      return act;
    } catch (err) {
      console.error('[DB] Error creating activation in PostgreSQL:', err);
    }
  }

  const db = loadFallbackDB();
  db.activations.unshift(act);
  if (db.activations.length > 25) db.activations = db.activations.slice(0, 25);
  saveFallbackDB(db);
  return act;
}

export async function deleteActivation(id: string): Promise<boolean> {
  await initDatabase();

  if (isPostgres && pool) {
    try {
      const res = await pool.query('DELETE FROM activations WHERE id = $1', [id]);
      return (res.rowCount ?? 0) > 0;
    } catch (err) {
      console.error('[DB] Error deleting activation in PostgreSQL:', err);
    }
  }

  const db = loadFallbackDB();
  const len = db.activations.length;
  db.activations = db.activations.filter((a) => a.id !== id);
  if (db.activations.length !== len) {
    saveFallbackDB(db);
    return true;
  }
  return false;
}

// -------------------------------------------------------------
// ANNOUNCEMENT / SETTINGS
// -------------------------------------------------------------
export async function getAnnouncement(): Promise<string> {
  await initDatabase();

  if (isPostgres && pool) {
    try {
      const res = await pool.query("SELECT value FROM settings WHERE key = 'announcement'");
      if (res.rows.length > 0) return res.rows[0].value;
    } catch (err) {
      console.error('[DB] Error getting announcement from PostgreSQL:', err);
    }
  }

  const db = loadFallbackDB();
  return db.announcement || DEFAULT_ANNOUNCEMENT;
}

export async function updateAnnouncement(text: string): Promise<string> {
  await initDatabase();

  if (isPostgres && pool) {
    try {
      await pool.query(
        "INSERT INTO settings (key, value) VALUES ('announcement', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        [text]
      );
      return text;
    } catch (err) {
      console.error('[DB] Error updating announcement in PostgreSQL:', err);
    }
  }

  const db = loadFallbackDB();
  db.announcement = text;
  saveFallbackDB(db);
  return text;
}
