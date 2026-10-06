import 'dotenv/config';
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

const TMP_DIR = '/tmp/ryvora_data';
const TMP_DB_FILE = path.join(TMP_DIR, 'db.json');
const TMP_PROOFS_DIR = path.join(TMP_DIR, 'proofs');

const INITIAL_COUPONS: PromoCoupon[] = [
  { code: 'USA10', discountPercent: 10, description: '10% USA Community Welcome Discount', active: true, usageCount: 142 },
  { code: 'VIP20', discountPercent: 20, description: '20% VIP Creator Program', active: true, usageCount: 68 },
  { code: 'CREATOR15', discountPercent: 15, description: '15% Discount on AI & Design Licenses', active: true, usageCount: 39 },
  { code: 'FLASH50', discountPercent: 50, description: 'Limited Flash Deal for Annual Bundles', active: false, usageCount: 12 },
];

const DEFAULT_ANNOUNCEMENT =
  '✦ USA #1 Digital Tools Reseller ✦ Instant Delivery (60-180s) ✦ 100% Replacement Warranty Guarantee ✦ Code "USA10" for 10% OFF';

// -------------------------------------------------------------
// POSTGRES CONNECTION POOL
// -------------------------------------------------------------
function getConnectionString(): string | undefined {
  return (
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.SUPABASE_DATABASE_URL
  );
}

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool | null {
  if (pool) return pool;

  const connString = getConnectionString();
  if (!connString) {
    return null;
  }

  try {
    const isLocalhost = connString.includes('localhost') || connString.includes('127.0.0.1');
    pool = new Pool({
      connectionString: connString,
      ssl: isLocalhost ? false : { rejectUnauthorized: false },
      max: process.env.VERCEL ? 3 : 10,
      idleTimeoutMillis: 15000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      console.error('[DB Pool Client Warning]', err.message);
    });

    console.log('[DB] PostgreSQL pool initialized successfully with secure SSL.');
    return pool;
  } catch (err) {
    console.error('[DB] Failed to construct PostgreSQL pool:', err);
    return null;
  }
}

// In-Memory / File Fallback cache (Local dev / testing fallback)
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

function ensureWritableDirs() {
  try {
    if (!fs.existsSync(TMP_DIR)) {
      fs.mkdirSync(TMP_DIR, { recursive: true });
    }
    if (!fs.existsSync(TMP_PROOFS_DIR)) {
      fs.mkdirSync(TMP_PROOFS_DIR, { recursive: true });
    }
  } catch {
    // ignore
  }

  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(PROOFS_DIR)) {
      fs.mkdirSync(PROOFS_DIR, { recursive: true });
    }
  } catch {
    // Expected in read-only serverless
  }
}

function loadFallbackDB(): FallbackDB {
  if (fallbackDB) return fallbackDB;
  ensureWritableDirs();

  let initial: FallbackDB = {
    products: PRODUCTS,
    orders: [],
    coupons: INITIAL_COUPONS,
    reviews: REVIEWS,
    activations: LIVE_ACTIVATIONS,
    announcement: DEFAULT_ANNOUNCEMENT,
  };

  // Try reading from /tmp first if Vercel serverless
  try {
    if (fs.existsSync(TMP_DB_FILE)) {
      const content = fs.readFileSync(TMP_DB_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed) {
        if (Array.isArray(parsed.products) && parsed.products.length > 0) initial.products = parsed.products;
        if (Array.isArray(parsed.orders)) initial.orders = parsed.orders;
        if (Array.isArray(parsed.coupons)) initial.coupons = parsed.coupons;
        if (Array.isArray(parsed.reviews)) initial.reviews = parsed.reviews;
        if (Array.isArray(parsed.activations)) initial.activations = parsed.activations;
        if (parsed.announcement) initial.announcement = parsed.announcement;
        fallbackDB = initial;
        return fallbackDB;
      }
    }
  } catch {
    // continue
  }

  // Try reading from data/db.json
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
    console.warn('[DB] Notice: db.json read fallback:', err);
  }

  fallbackDB = initial;
  return fallbackDB;
}

function saveFallbackDB(data: FallbackDB) {
  // Always try saving to /tmp first (works on Vercel Serverless, AWS Lambda, Linux, etc.)
  try {
    ensureWritableDirs();
    fs.writeFileSync(TMP_DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {
    // ignore
  }

  // Try saving to project data directory if writable
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {
    // Read-only serverless environment
  }
}

// -------------------------------------------------------------
// DATABASE INITIALIZATION & SCHEMA AUTO-MIGRATION
// -------------------------------------------------------------
let isInitialized = false;

export async function initDatabase(): Promise<void> {
  if (isInitialized) return;

  const currentPool = getPool();
  if (currentPool) {
    try {
      const client = await currentPool.connect();
      try {
        console.log('[DB] Checking / creating PostgreSQL production tables...');

        await client.query(`
          CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            tagline TEXT,
            category TEXT NOT NULL,
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
            image TEXT,
            availability BOOLEAN DEFAULT TRUE,
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
            coupon TEXT,
            payment_method TEXT NOT NULL,
            payment_proof TEXT,
            transaction_id TEXT,
            status TEXT DEFAULT 'processing',
            credentials JSONB,
            license_key TEXT,
            account_email TEXT,
            delivery_instructions TEXT,
            created_at TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_new BOOLEAN DEFAULT TRUE
          );

          CREATE TABLE IF NOT EXISTS coupons (
            code TEXT PRIMARY KEY,
            discount_percent INTEGER NOT NULL,
            description TEXT,
            active BOOLEAN DEFAULT TRUE,
            usage_count INTEGER DEFAULT 0,
            expiry TEXT
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
            proof TEXT,
            status TEXT DEFAULT 'activated',
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

        // Migration alters to ensure missing columns exist in existing deployments
        await client.query(`
          ALTER TABLE products ADD COLUMN IF NOT EXISTS image TEXT;
          ALTER TABLE products ADD COLUMN IF NOT EXISTS availability BOOLEAN DEFAULT TRUE;

          ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon TEXT;
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS license_key TEXT;
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS account_email TEXT;
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_instructions TEXT;
          ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

          ALTER TABLE coupons ADD COLUMN IF NOT EXISTS expiry TEXT;

          ALTER TABLE activations ADD COLUMN IF NOT EXISTS proof TEXT;
          ALTER TABLE activations ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'activated';
        `);

        // Seed products if table empty
        const prodCountRes = await client.query('SELECT COUNT(*) FROM products');
        if (parseInt(prodCountRes.rows[0].count, 10) === 0) {
          console.log('[DB] Seeding products into PostgreSQL...');
          for (const p of PRODUCTS) {
            await client.query(
              `INSERT INTO products (
                id, name, tagline, category, category_label, icon_name, brand_color, accent_glow,
                rating, reviews_count, features, retail_price_usd, price_usd, in_stock, popular,
                featured, badge, allowed_account_types, description, delivery_time, warranty, availability
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
              ON CONFLICT (id) DO NOTHING`,
              [
                p.id, p.name, p.tagline, p.category, p.categoryLabel, p.iconName || 'Sparkles',
                p.brandColor, p.accentGlow, p.rating, p.reviewsCount, JSON.stringify(p.features),
                p.retailPriceUSD, p.priceUSD, p.inStock, p.popular ?? false, p.featured ?? false,
                p.badge || null, JSON.stringify(p.allowedAccountTypes), p.description, p.deliveryTime, p.warranty, true
              ]
            );
          }
        }

        // Seed coupons
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

        // Seed reviews
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

        // Seed activations
        const actCountRes = await client.query('SELECT COUNT(*) FROM activations');
        if (parseInt(actCountRes.rows[0].count, 10) === 0) {
          for (const a of LIVE_ACTIVATIONS) {
            await client.query(
              `INSERT INTO activations (id, product_name, category, customer_masked, city, state, minutes_ago, plan_duration, status)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
              [a.id, a.productName, a.category, a.customerMasked, a.city, a.state, a.minutesAgo, a.planDuration, 'activated']
            );
          }
        }

        // Seed announcement setting
        const settingRes = await client.query("SELECT value FROM settings WHERE key = 'announcement'");
        if (settingRes.rows.length === 0) {
          await client.query(
            "INSERT INTO settings (key, value) VALUES ('announcement', $1) ON CONFLICT (key) DO NOTHING",
            [DEFAULT_ANNOUNCEMENT]
          );
        }

        console.log('[DB] PostgreSQL schema & seed check complete.');
        isInitialized = true;
      } finally {
        client.release();
      }
    } catch (err: any) {
      console.warn('[DB] PostgreSQL initialization warning:', err.message);
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

  const currentPool = getPool();
  if (currentPool) {
    try {
      await currentPool.query(
        `INSERT INTO payment_proofs (id, mime_type, data, filename) VALUES ($1, $2, $3, $4)`,
        [id, mimeType, dataUriOrBase64, filename || 'payment_proof.jpg']
      );
      return `/api/proofs/${id}`;
    } catch (err: any) {
      console.warn('[DB] PostgreSQL proof write warning, using fallback store:', err.message);
    }
  }

  // Fallback persistent storage
  ensureWritableDirs();
  proofCache.set(id, { mimeType, data: dataUriOrBase64, filename });

  try {
    fs.writeFileSync(
      path.join(TMP_PROOFS_DIR, `${id}.json`),
      JSON.stringify({ mimeType, data: dataUriOrBase64, filename })
    );
  } catch {
    // memory cache still holds it
  }

  try {
    fs.writeFileSync(
      path.join(PROOFS_DIR, `${id}.json`),
      JSON.stringify({ mimeType, data: dataUriOrBase64, filename })
    );
  } catch {
    // Read-only serverless environment
  }

  return `/api/proofs/${id}`;
}

export async function getPaymentProof(id: string): Promise<{ mimeType: string; data: string; filename?: string } | null> {
  await initDatabase();

  const currentPool = getPool();
  if (currentPool) {
    try {
      const res = await currentPool.query('SELECT mime_type, data, filename FROM payment_proofs WHERE id = $1', [id]);
      if (res.rows.length > 0) {
        return {
          mimeType: res.rows[0].mime_type,
          data: res.rows[0].data,
          filename: res.rows[0].filename,
        };
      }
    } catch (err: any) {
      console.warn('[DB] PostgreSQL proof query warning:', err.message);
    }
  }

  if (proofCache.has(id)) {
    return proofCache.get(id)!;
  }

  try {
    const tmpFilePath = path.join(TMP_PROOFS_DIR, `${id}.json`);
    if (fs.existsSync(tmpFilePath)) {
      const content = JSON.parse(fs.readFileSync(tmpFilePath, 'utf-8'));
      proofCache.set(id, content);
      return content;
    }
  } catch {
    // continue
  }

  try {
    const filePath = path.join(PROOFS_DIR, `${id}.json`);
    if (fs.existsSync(filePath)) {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      proofCache.set(id, content);
      return content;
    }
  } catch {
    // continue
  }

  return null;
}

// -------------------------------------------------------------
// ORDERS
// -------------------------------------------------------------
function mapOrderRow(row: any): CustomerOrder & { isNew?: boolean } {
  let items = [];
  try {
    items = typeof row.items === 'string' ? JSON.parse(row.items) : row.items;
  } catch {
    items = [];
  }

  let creds = undefined;
  if (row.credentials) {
    creds = typeof row.credentials === 'string' ? JSON.parse(row.credentials) : row.credentials;
  } else if (row.license_key || row.account_email || row.delivery_instructions) {
    creds = {
      licenseKey: row.license_key || '',
      accountEmail: row.account_email || '',
      instructions: row.delivery_instructions || '',
    };
  }

  return {
    orderId: row.order_id,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone || undefined,
    items,
    subtotalUSD: parseFloat(row.subtotal_usd),
    discountUSD: parseFloat(row.discount_usd || 0),
    totalUSD: parseFloat(row.total_usd),
    coupon: row.coupon || undefined,
    paymentMethod: row.payment_method,
    paymentProof: row.payment_proof || undefined,
    transactionId: row.transaction_id || undefined,
    status: row.status as 'processing' | 'activated' | 'delivered',
    createdAt: row.created_at,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
    licenseKey: row.license_key || (creds?.licenseKey || undefined),
    accountEmail: row.account_email || (creds?.accountEmail || undefined),
    deliveryInstructions: row.delivery_instructions || (creds?.instructions || undefined),
    credentials: creds,
    isNew: row.is_new ?? false,
  };
}

export async function getOrders(): Promise<(CustomerOrder & { isNew?: boolean })[]> {
  await initDatabase();

  const currentPool = getPool();
  if (currentPool) {
    try {
      const res = await currentPool.query('SELECT * FROM orders ORDER BY created_at DESC');
      return res.rows.map(mapOrderRow);
    } catch (err: any) {
      console.warn('[DB] PostgreSQL orders read warning, reading from fallback store:', err.message);
    }
  }

  const db = loadFallbackDB();
  return [...db.orders];
}

export async function getOrderById(orderId: string): Promise<(CustomerOrder & { isNew?: boolean }) | null> {
  await initDatabase();

  const currentPool = getPool();
  if (currentPool) {
    try {
      const res = await currentPool.query('SELECT * FROM orders WHERE order_id = $1', [orderId]);
      if (res.rows.length > 0) {
        return mapOrderRow(res.rows[0]);
      }
      return null;
    } catch (err: any) {
      console.warn('[DB] PostgreSQL order by id warning:', err.message);
    }
  }

  const db = loadFallbackDB();
  return db.orders.find((o) => o.orderId === orderId) || null;
}

export async function createOrder(order: CustomerOrder & { isNew?: boolean }): Promise<CustomerOrder> {
  await initDatabase();

  const currentPool = getPool();
  if (currentPool) {
    try {
      const nowIso = new Date().toISOString();
      const creds = order.credentials || {
        licenseKey: order.licenseKey || '',
        accountEmail: order.accountEmail || '',
        instructions: order.deliveryInstructions || '',
      };

      await currentPool.query(
        `INSERT INTO orders (
          order_id, customer_email, customer_phone, items, subtotal_usd, discount_usd,
          total_usd, coupon, payment_method, payment_proof, transaction_id, status,
          created_at, updated_at, credentials, license_key, account_email, delivery_instructions, is_new
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [
          order.orderId,
          order.customerEmail,
          order.customerPhone || null,
          JSON.stringify(order.items),
          order.subtotalUSD,
          order.discountUSD,
          order.totalUSD,
          order.coupon || null,
          order.paymentMethod,
          order.paymentProof || null,
          order.transactionId || null,
          order.status || 'processing',
          order.createdAt,
          nowIso,
          JSON.stringify(creds || null),
          order.licenseKey || creds.licenseKey || null,
          order.accountEmail || creds.accountEmail || null,
          order.deliveryInstructions || creds.instructions || null,
          order.isNew ?? true,
        ]
      );
      return order;
    } catch (err: any) {
      console.error('[DB] PostgreSQL order insert error:', err.message);
      // If pool was configured but query failed, continue to fallback store so customer order is NOT lost!
    }
  }

  // Fallback persistent store
  const db = loadFallbackDB();
  db.orders.unshift(order);
  saveFallbackDB(db);
  return order;
}

export async function updateOrder(
  orderId: string,
  updates: {
    status?: string;
    credentials?: any;
    isNew?: boolean;
    licenseKey?: string;
    accountEmail?: string;
    deliveryInstructions?: string;
  }
): Promise<CustomerOrder | null> {
  await initDatabase();

  const currentPool = getPool();
  if (currentPool) {
    try {
      const existing = await getOrderById(orderId);
      if (existing) {
        const newStatus = updates.status || existing.status;
        const newCreds = updates.credentials ? { ...existing.credentials, ...updates.credentials } : existing.credentials;
        const newIsNew = updates.isNew !== undefined ? updates.isNew : existing.isNew;
        const newLicense = updates.licenseKey || newCreds?.licenseKey || existing.licenseKey || '';
        const newAccEmail = updates.accountEmail || newCreds?.accountEmail || existing.accountEmail || '';
        const newInstructions = updates.deliveryInstructions || newCreds?.instructions || existing.deliveryInstructions || '';
        const nowIso = new Date().toISOString();

        await currentPool.query(
          `UPDATE orders SET
            status = $1,
            credentials = $2,
            license_key = $3,
            account_email = $4,
            delivery_instructions = $5,
            is_new = $6,
            updated_at = $7
          WHERE order_id = $8`,
          [
            newStatus,
            JSON.stringify(newCreds || null),
            newLicense || null,
            newAccEmail || null,
            newInstructions || null,
            newIsNew,
            nowIso,
            orderId,
          ]
        );

        return {
          ...existing,
          status: newStatus as any,
          credentials: newCreds,
          licenseKey: newLicense,
          accountEmail: newAccEmail,
          deliveryInstructions: newInstructions,
          isNew: newIsNew,
          updatedAt: nowIso,
        };
      }
    } catch (err: any) {
      console.warn('[DB] PostgreSQL order update warning, updating fallback store:', err.message);
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
  if (updates.licenseKey) db.orders[idx].licenseKey = updates.licenseKey;
  if (updates.accountEmail) db.orders[idx].accountEmail = updates.accountEmail;
  if (updates.deliveryInstructions) db.orders[idx].deliveryInstructions = updates.deliveryInstructions;
  if (updates.isNew !== undefined) db.orders[idx].isNew = updates.isNew;
  db.orders[idx].updatedAt = new Date().toISOString();

  saveFallbackDB(db);
  return db.orders[idx];
}

export async function deleteOrder(orderId: string): Promise<boolean> {
  await initDatabase();

  const currentPool = getPool();
  if (currentPool) {
    try {
      const res = await currentPool.query('DELETE FROM orders WHERE order_id = $1', [orderId]);
      if ((res.rowCount ?? 0) > 0) return true;
    } catch (err: any) {
      console.warn('[DB] PostgreSQL delete order warning:', err.message);
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
function mapProductRow(p: any): Product {
  let features = [];
  try {
    features = typeof p.features === 'string' ? JSON.parse(p.features) : p.features;
  } catch {
    features = [];
  }

  let allowedAccountTypes = ['private_account'];
  try {
    allowedAccountTypes = typeof p.allowed_account_types === 'string' ? JSON.parse(p.allowed_account_types) : p.allowed_account_types;
  } catch {
    allowedAccountTypes = ['private_account'];
  }

  return {
    id: p.id,
    name: p.name,
    tagline: p.tagline || '',
    category: p.category as any,
    categoryLabel: p.category_label || '',
    iconName: p.icon_name || 'Sparkles',
    brandColor: p.brand_color || '#00E5FF',
    accentGlow: p.accent_glow || 'rgba(0, 229, 255, 0.25)',
    rating: parseFloat(p.rating || 5.0),
    reviewsCount: parseInt(p.reviews_count || 1, 10),
    features: Array.isArray(features) ? features : [],
    retailPriceUSD: parseFloat(p.retail_price_usd),
    priceUSD: parseFloat(p.price_usd),
    inStock: p.in_stock ?? p.availability ?? true,
    popular: p.popular ?? false,
    featured: p.featured ?? false,
    badge: p.badge || undefined,
    allowedAccountTypes: (Array.isArray(allowedAccountTypes) ? allowedAccountTypes : ['private_account']) as any,
    description: p.description || '',
    deliveryTime: p.delivery_time || 'Instant (2-5 mins)',
    warranty: p.warranty || 'Full 30-Day Auto-Replacement Warranty',
  };
}

export async function getProducts(): Promise<Product[]> {
  await initDatabase();

  const currentPool = getPool();
  if (currentPool) {
    try {
      const res = await currentPool.query('SELECT * FROM products ORDER BY name ASC');
      return res.rows.map(mapProductRow);
    } catch (err: any) {
      console.warn('[DB] PostgreSQL products read warning:', err.message);
    }
  }

  const db = loadFallbackDB();
  return [...db.products];
}

export async function getProductById(id: string): Promise<Product | null> {
  await initDatabase();

  const currentPool = getPool();
  if (currentPool) {
    try {
      const res = await currentPool.query('SELECT * FROM products WHERE id = $1', [id]);
      if (res.rows.length > 0) return mapProductRow(res.rows[0]);
    } catch (err: any) {
      console.warn('[DB] PostgreSQL get product warning:', err.message);
    }
  }

  const db = loadFallbackDB();
  return db.products.find((p) => p.id === id) || null;
}

export async function createProduct(product: Product): Promise<Product> {
  await initDatabase();

  const currentPool = getPool();
  if (currentPool) {
    try {
      await currentPool.query(
        `INSERT INTO products (
          id, name, tagline, category, category_label, icon_name, brand_color, accent_glow,
          rating, reviews_count, features, retail_price_usd, price_usd, in_stock, popular,
          featured, badge, allowed_account_types, description, delivery_time, warranty, availability
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          price_usd = EXCLUDED.price_usd,
          retail_price_usd = EXCLUDED.retail_price_usd,
          features = EXCLUDED.features,
          in_stock = EXCLUDED.in_stock,
          availability = EXCLUDED.in_stock`,
        [
          product.id, product.name, product.tagline, product.category, product.categoryLabel,
          product.iconName, product.brandColor, product.accentGlow, product.rating, product.reviewsCount,
          JSON.stringify(product.features), product.retailPriceUSD, product.priceUSD, product.inStock,
          product.popular ?? false, product.featured ?? false, product.badge || null,
          JSON.stringify(product.allowedAccountTypes), product.description, product.deliveryTime, product.warranty, product.inStock
        ]
      );
      return product;
    } catch (err: any) {
      console.warn('[DB] PostgreSQL create product warning:', err.message);
    }
  }

  const db = loadFallbackDB();
  db.products.push(product);
  saveFallbackDB(db);
  return product;
}

export async function updateProduct(id: string, updates: Partial<Product>): Promise<Product | null> {
  await initDatabase();

  const currentPool = getPool();
  if (currentPool) {
    try {
      const existing = await getProductById(id);
      if (existing) {
        const merged = { ...existing, ...updates };

        await currentPool.query(
          `UPDATE products SET
            name = $1, tagline = $2, category = $3, price_usd = $4, retail_price_usd = $5,
            in_stock = $6, availability = $6, popular = $7, featured = $8, badge = $9,
            features = $10, allowed_account_types = $11, description = $12
          WHERE id = $13`,
          [
            merged.name, merged.tagline, merged.category, merged.priceUSD, merged.retailPriceUSD,
            merged.inStock, merged.popular ?? false, merged.featured ?? false, merged.badge || null,
            JSON.stringify(merged.features), JSON.stringify(merged.allowedAccountTypes), merged.description,
            id
          ]
        );

        return merged;
      }
    } catch (err: any) {
      console.warn('[DB] PostgreSQL update product warning:', err.message);
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

  const currentPool = getPool();
  if (currentPool) {
    try {
      const res = await currentPool.query('DELETE FROM products WHERE id = $1', [id]);
      if ((res.rowCount ?? 0) > 0) return true;
    } catch (err: any) {
      console.warn('[DB] PostgreSQL delete product warning:', err.message);
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

  const currentPool = getPool();
  if (currentPool) {
    try {
      const res = await currentPool.query('SELECT * FROM coupons ORDER BY code ASC');
      return res.rows.map((r) => ({
        code: r.code,
        discountPercent: r.discount_percent,
        description: r.description,
        active: r.active,
        usageCount: r.usage_count,
      }));
    } catch (err: any) {
      console.warn('[DB] PostgreSQL get coupons warning:', err.message);
    }
  }

  const db = loadFallbackDB();
  return [...db.coupons];
}

export async function getCouponByCode(code: string): Promise<PromoCoupon | null> {
  await initDatabase();

  const currentPool = getPool();
  if (currentPool) {
    try {
      const res = await currentPool.query('SELECT * FROM coupons WHERE UPPER(code) = UPPER($1)', [code]);
      if (res.rows.length > 0) {
        const r = res.rows[0];
        return {
          code: r.code,
          discountPercent: r.discount_percent,
          description: r.description,
          active: r.active,
          usageCount: r.usage_count,
        };
      }
      return null;
    } catch (err: any) {
      console.warn('[DB] PostgreSQL get coupon warning:', err.message);
    }
  }

  const db = loadFallbackDB();
  return db.coupons.find((c) => c.code.toUpperCase() === code.toUpperCase()) || null;
}

export async function createCoupon(coupon: PromoCoupon): Promise<PromoCoupon> {
  await initDatabase();

  const currentPool = getPool();
  if (currentPool) {
    try {
      await currentPool.query(
        `INSERT INTO coupons (code, discount_percent, description, active, usage_count)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (code) DO UPDATE SET
          discount_percent = EXCLUDED.discount_percent,
          description = EXCLUDED.description,
          active = EXCLUDED.active,
          usage_count = EXCLUDED.usage_count`,
        [coupon.code.toUpperCase(), coupon.discountPercent, coupon.description, coupon.active, coupon.usageCount]
      );
      return coupon;
    } catch (err: any) {
      console.warn('[DB] PostgreSQL create coupon warning:', err.message);
    }
  }

  const db = loadFallbackDB();
  const idx = db.coupons.findIndex((c) => c.code.toUpperCase() === coupon.code.toUpperCase());
  if (idx > -1) {
    db.coupons[idx] = coupon;
  } else {
    db.coupons.push(coupon);
  }
  saveFallbackDB(db);
  return coupon;
}

export async function toggleCoupon(code: string): Promise<PromoCoupon | null> {
  await initDatabase();

  const currentPool = getPool();
  if (currentPool) {
    try {
      const existing = await getCouponByCode(code);
      if (existing) {
        const nextActive = !existing.active;
        await currentPool.query('UPDATE coupons SET active = $1 WHERE UPPER(code) = UPPER($2)', [nextActive, code]);
        return { ...existing, active: nextActive };
      }
    } catch (err: any) {
      console.warn('[DB] PostgreSQL toggle coupon warning:', err.message);
    }
  }

  const db = loadFallbackDB();
  const idx = db.coupons.findIndex((c) => c.code.toUpperCase() === code.toUpperCase());
  if (idx === -1) return null;
  db.coupons[idx].active = !db.coupons[idx].active;
  saveFallbackDB(db);
  return db.coupons[idx];
}

export async function deleteCoupon(code: string): Promise<boolean> {
  await initDatabase();

  const currentPool = getPool();
  if (currentPool) {
    try {
      const res = await currentPool.query('DELETE FROM coupons WHERE UPPER(code) = UPPER($1)', [code]);
      if ((res.rowCount ?? 0) > 0) return true;
    } catch (err: any) {
      console.warn('[DB] PostgreSQL delete coupon warning:', err.message);
    }
  }

  const db = loadFallbackDB();
  const len = db.coupons.length;
  db.coupons = db.coupons.filter((c) => c.code.toUpperCase() !== code.toUpperCase());
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

  const currentPool = getPool();
  if (currentPool) {
    try {
      const res = await currentPool.query('SELECT * FROM reviews ORDER BY id ASC');
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
    } catch (err: any) {
      console.warn('[DB] PostgreSQL get reviews warning:', err.message);
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

  const currentPool = getPool();
  if (currentPool) {
    try {
      const res = await currentPool.query('SELECT * FROM activations ORDER BY created_at DESC LIMIT 25');
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
    } catch (err: any) {
      console.warn('[DB] PostgreSQL activations read warning:', err.message);
    }
  }

  const db = loadFallbackDB();
  return [...db.activations];
}

export async function createActivation(act: LiveActivation): Promise<LiveActivation> {
  await initDatabase();

  const currentPool = getPool();
  if (currentPool) {
    try {
      await currentPool.query(
        `INSERT INTO activations (id, product_name, category, customer_masked, city, state, minutes_ago, plan_duration, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [act.id, act.productName, act.category, act.customerMasked, act.city, act.state, act.minutesAgo, act.planDuration, 'activated']
      );
      return act;
    } catch (err: any) {
      console.warn('[DB] PostgreSQL create activation warning:', err.message);
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

  const currentPool = getPool();
  if (currentPool) {
    try {
      const res = await currentPool.query('DELETE FROM activations WHERE id = $1', [id]);
      if ((res.rowCount ?? 0) > 0) return true;
    } catch (err: any) {
      console.warn('[DB] PostgreSQL delete activation warning:', err.message);
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

  const currentPool = getPool();
  if (currentPool) {
    try {
      const res = await currentPool.query("SELECT value FROM settings WHERE key = 'announcement'");
      if (res.rows.length > 0) return res.rows[0].value;
    } catch (err: any) {
      console.warn('[DB] PostgreSQL announcement read warning:', err.message);
    }
  }

  const db = loadFallbackDB();
  return db.announcement || DEFAULT_ANNOUNCEMENT;
}

export async function updateAnnouncement(text: string): Promise<string> {
  await initDatabase();

  const currentPool = getPool();
  if (currentPool) {
    try {
      await currentPool.query(
        "INSERT INTO settings (key, value) VALUES ('announcement', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        [text]
      );
      return text;
    } catch (err: any) {
      console.warn('[DB] PostgreSQL announcement update warning:', err.message);
    }
  }

  const db = loadFallbackDB();
  db.announcement = text;
  saveFallbackDB(db);
  return text;
}
