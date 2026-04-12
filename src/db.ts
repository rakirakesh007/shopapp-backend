import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// ── Connection Pool ────────────────────────────────────────────────────────────
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway PostgreSQL requires SSL in production
  ssl: process.env.DATABASE_URL?.includes('railway')
    ? { rejectUnauthorized: false }
    : false,
});

// ── Table Setup + Seeding ──────────────────────────────────────────────────────
export async function initDb(): Promise<void> {
  // Create users table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      phone_number      VARCHAR(15)  PRIMARY KEY,
      role              VARCHAR(10)  NOT NULL CHECK (role IN ('owner', 'customer')),
      user_id           VARCHAR(50)  UNIQUE NOT NULL,
      is_setup_complete BOOLEAN      NOT NULL DEFAULT false,
      name              VARCHAR(100),
      latitude          DOUBLE PRECISION,
      longitude         DOUBLE PRECISION,
      pin               VARCHAR(4)
    )
  `);

  // Add pin column to existing users rows (migration for older databases)
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pin VARCHAR(4)`);
  } catch (_) { /* column already exists */ }

  // Create shops table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shops (
      shop_id              VARCHAR(50)  PRIMARY KEY,
      owner_id             VARCHAR(50)  NOT NULL,
      shop_name            VARCHAR(100) NOT NULL,
      area                 VARCHAR(100) NOT NULL DEFAULT '',
      category             VARCHAR(50)  NOT NULL DEFAULT 'General',
      is_open              BOOLEAN      NOT NULL DEFAULT false,
      rating               DOUBLE PRECISION NOT NULL DEFAULT 0,
      owner_phone          VARCHAR(15)  NOT NULL,
      shop_address         TEXT         NOT NULL DEFAULT '',
      owner_specialization VARCHAR(50)  NOT NULL DEFAULT '',
      latitude             DOUBLE PRECISION,
      longitude            DOUBLE PRECISION,
      trial_start_date     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      is_active            BOOLEAN      NOT NULL DEFAULT true,
      has_paid             BOOLEAN      NOT NULL DEFAULT false,
      payment_reference    VARCHAR(100),
      delivery_charge      DOUBLE PRECISION NOT NULL DEFAULT 0,
      ratings_count        INT              NOT NULL DEFAULT 0,
      subscription_paid_at TIMESTAMPTZ
    )
  `);

  // Add new columns if they don't exist (for existing databases)
  const addCol = async (col: string, type: string, def: string) => {
    try {
      await pool.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS ${col} ${type} ${def}`);
    } catch (_) { /* column may already exist */ }
  };
  await addCol('latitude',          'DOUBLE PRECISION', '');
  await addCol('longitude',         'DOUBLE PRECISION', '');
  await addCol('trial_start_date',  'TIMESTAMPTZ',      'DEFAULT NOW()');
  await addCol('is_active',         'BOOLEAN',          'DEFAULT true');
  await addCol('has_paid',          'BOOLEAN',          'DEFAULT false');
  await addCol('payment_reference', 'VARCHAR(100)',     '');
  await addCol('delivery_charge',      'DOUBLE PRECISION', 'DEFAULT 0');
  await addCol('ratings_count',         'INT',              'DEFAULT 0');
  await addCol('subscription_paid_at',  'TIMESTAMPTZ',      '');

  // Unique constraint: prevent duplicate shop_name + shop_address
  try {
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_name_address ON shops (LOWER(shop_name), LOWER(shop_address)) WHERE shop_address <> ''`);
  } catch (_) { /* index may already exist */ }

  // Create products table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      product_id  VARCHAR(50)      PRIMARY KEY,
      shop_id     VARCHAR(50)      NOT NULL,
      name        VARCHAR(150)     NOT NULL,
      category    VARCHAR(50)      NOT NULL,
      price       DOUBLE PRECISION NOT NULL DEFAULT 0,
      stock       INT              NOT NULL DEFAULT 0,
      min_stock   INT              NOT NULL DEFAULT 0,
      unit        VARCHAR(20)      NOT NULL DEFAULT 'pcs',
      image_url   TEXT             NOT NULL DEFAULT ''
    )
  `);

  // Create orders table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      order_id               VARCHAR(50)      PRIMARY KEY,
      customer_name          VARCHAR(100)     NOT NULL,
      customer_phone         VARCHAR(15)      NOT NULL,
      shop_id                VARCHAR(50)      NOT NULL DEFAULT '',
      shop_name              VARCHAR(100)     NOT NULL DEFAULT '',
      owner_phone            VARCHAR(15)      NOT NULL DEFAULT '',
      total_amount           DOUBLE PRECISION NOT NULL DEFAULT 0,
      status                 VARCHAR(20)      NOT NULL DEFAULT 'newOrder'
                               CHECK (status IN ('newOrder','preparing','ready','completed')),
      delivery_type          VARCHAR(10)      NOT NULL DEFAULT 'delivery'
                               CHECK (delivery_type IN ('delivery','pickup')),
      delivery_address       TEXT,
      estimated_pickup_time  VARCHAR(20),
      was_modified_by_owner  BOOLEAN          NOT NULL DEFAULT false,
      removed_item_names     TEXT[]           NOT NULL DEFAULT '{}',
      created_at             TIMESTAMPTZ      NOT NULL DEFAULT NOW()
    )
  `);

  // Create order_items table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id         SERIAL           PRIMARY KEY,
      order_id   VARCHAR(50)      NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
      name       VARCHAR(150)     NOT NULL,
      qty        INT              NOT NULL DEFAULT 1,
      price      DOUBLE PRECISION NOT NULL DEFAULT 0
    )
  `);


  // Create shop_ratings table – one row per customer+shop, prevents duplicate votes
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shop_ratings (
      id             SERIAL      PRIMARY KEY,
      shop_id        VARCHAR(50) NOT NULL,
      customer_phone VARCHAR(15) NOT NULL,
      rating         SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_shop_customer UNIQUE (shop_id, customer_phone)
    )
  `);

  const { rowCount: userCount } = await pool.query('SELECT 1 FROM users LIMIT 1');
  if (!userCount) {
    await pool.query(`
      INSERT INTO users (phone_number, role, user_id, is_setup_complete, name, pin) VALUES
      ('9876543210', 'owner',    'u_101', true, 'Sharma Ji',    '1234'),
      ('1234567890', 'customer', 'u_102', true, 'Rahul Kumar', '1234')
    `);
    console.log('📦  Seeded 2 users');
  }
  // ── Seed products (only if table is empty) ──────────────────────────────────
  const { rowCount: productCount } = await pool.query('SELECT 1 FROM products LIMIT 1');
  if (!productCount) {
    await pool.query(`
      INSERT INTO products (product_id, shop_id, name, category, price, stock, min_stock, unit) VALUES
      ('p_001','s_001','Basmati Rice 5kg',   'Grocery',     320,  10, 5,  'bag'),
      ('p_002','s_001','Amul Butter 500g',   'Grocery',     265,  0,  5,  'pack'),
      ('p_003','s_001','Toor Dal 1kg',       'Grocery',     140,  20, 5,  'kg'),
      ('p_004','s_001','Sunflower Oil 1L',   'Grocery',     175,  8,  3,  'btl'),
      ('p_005','s_002','USB-C Cable 2m',     'Electronics', 199,  15, 3,  'pcs'),
      ('p_006','s_002','Phone Stand',        'Electronics', 249,  0,  2,  'pcs'),
      ('p_007','s_002','Earphones',          'Electronics', 499,  6,  2,  'pcs'),
      ('p_008','s_002','Power Bank 10K',     'Electronics', 899,  4,  2,  'pcs'),
      ('p_009','s_003','Cotton T-Shirt',     'Clothing',    499,  12, 3,  'pcs'),
      ('p_010','s_003','Formal Shirt',       'Clothing',    899,  0,  2,  'pcs'),
      ('p_011','s_003','Jeans (Slim Fit)',   'Clothing',    1199, 7,  2,  'pcs'),
      ('p_012','s_004','Full Cream Milk 1L', 'Dairy',       62,   30, 10, 'btl'),
      ('p_013','s_004','Paneer 200g',        'Dairy',       90,   0,  5,  'pack'),
      ('p_014','s_004','Curd 400g',          'Dairy',       45,   20, 5,  'pack'),
      ('p_015','s_004','Cheese Slice Pack',  'Dairy',       120,  8,  3,  'pack'),
      ('p_016','s_005','Atta 10kg',          'Grocery',     380,  12, 5,  'bag'),
      ('p_017','s_005','Sugar 1kg',          'Grocery',     46,   25, 10, 'kg'),
      ('p_018','s_006','Kurti Set',          'Clothing',    699,  10, 3,  'pcs'),
      ('p_019','s_006','Saree (Cotton)',     'Clothing',    1499, 5,  2,  'pcs'),
      ('p_020','s_007','LED Bulb 9W',        'Electronics', 89,   40, 10, 'pcs'),
      ('p_021','s_007','Extension Board 6pt','Electronics', 349,  8,  3,  'pcs'),
      ('p_022','s_008','Toned Milk 500ml',   'Dairy',       30,   50, 15, 'btl'),
      ('p_023','s_008','Dahi 400g',          'Dairy',       42,   18, 5,  'pack')
    `);
    console.log('📦  Seeded 23 products');
  }
  // ── Seed shops (only if table is empty) ─────────────────────────────────────
  const { rowCount: shopCount } = await pool.query('SELECT 1 FROM shops LIMIT 1');
  if (!shopCount) {
    await pool.query(`
      INSERT INTO shops
        (shop_id, owner_id, shop_name, area, category, is_open, rating, owner_phone, shop_address, owner_specialization, latitude, longitude)
      VALUES
        ('s_001','u_101','Sharma Grocery',       'Munger',    'Grocery',     true,  4.3,'9876543210','12, Station Road, Munger, Bihar',     'Retail',    25.3745, 86.4735),
        ('s_002','u_103','RK Electronics',        'Munger',    'Electronics', true,  4.1,'9123456780','45, Kasim Bazar, Munger, Bihar',      'Retail',    25.3750, 86.4740),
        ('s_003','u_104','Patna Fashions',         'Patna',     'Ethnic Wear', false, 3.8,'9001122334','78, Boring Road, Patna, Bihar',       'Wholesale', 25.6093, 85.1376),
        ('s_004','u_105','Jamalpur Dairy',         'Jamalpur',  'Dairy',       true,  4.5,'9988776655','3, Loco Colony, Jamalpur, Bihar',    'Retail',    25.3133, 86.4875),
        ('s_005','u_106','Munger Mart',            'Munger',    'Grocery',     true,  4.0,'9445566778','22, Gandhi Chowk, Munger, Bihar',    'Both',      25.3760, 86.4730),
        ('s_006','u_107','Darbhanga Cloth House',  'Darbhanga', 'Fabrics',     true,  4.2,'9554433221','56, Laheriasarai, Darbhanga, Bihar', 'Wholesale', 26.1523, 85.8915),
        ('s_007','u_108','Patna Electronics Hub',  'Patna',     'Electronics', false, 3.9,'9667788990','90, Frazer Road, Patna, Bihar',      'Retail',    25.6128, 85.1411),
        ('s_008','u_109','Fresh Dairy Munger',     'Munger',    'Dairy',       true,  4.4,'9778899001','8, Civil Lines, Munger, Bihar',      'Retail',    25.3770, 86.4720)
    `);
    console.log('📦  Seeded 8 shops');
  }

  console.log('✅  Database initialised');
}

// ── Row → JSON mappers ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToUser(row: any) {
  return {
    phoneNumber:      row.phone_number,
    role:             row.role,
    userId:           row.user_id,
    isSetupComplete:  row.is_setup_complete,
    name:             row.name ?? '',
    latitude:         row.latitude  ?? undefined,
    longitude:        row.longitude ?? undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToShop(row: any) {
  return {
    shopId:              row.shop_id,
    ownerId:             row.owner_id,
    shopName:            row.shop_name,
    area:                row.area,
    category:            row.category,
    isOpen:              row.is_open,
    rating:              row.rating,
    ownerPhone:          row.owner_phone,
    shopAddress:         row.shop_address,
    ownerSpecialization: row.owner_specialization,
    latitude:            row.latitude  ?? null,
    longitude:           row.longitude ?? null,
    trialStartDate:      row.trial_start_date ?? null,
    isActive:            row.is_active ?? true,
    hasPaid:             row.has_paid  ?? false,
    paymentReference:    row.payment_reference ?? null,
    deliveryCharge:       row.delivery_charge ?? 0,
    ratingsCount:         row.ratings_count   ?? 0,
    subscriptionPaidAt:   row.subscription_paid_at ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToProduct(row: any) {
  return {
    productId:  row.product_id,
    shopId:     row.shop_id,
    name:       row.name,
    category:   row.category,
    price:      row.price,
    stock:      row.stock,
    minStock:   row.min_stock,
    unit:       row.unit,
    imageUrl:   row.image_url ?? '',
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToOrder(row: any, items: any[] = []) {
  return {
    orderId:             row.order_id,
    customerName:        row.customer_name,
    customerPhone:       row.customer_phone,
    shopId:              row.shop_id,
    shopName:            row.shop_name,
    ownerPhone:          row.owner_phone,
    totalAmount:         row.total_amount,
    status:              row.status,
    deliveryType:        row.delivery_type,
    deliveryAddress:     row.delivery_address      ?? undefined,
    estimatedPickupTime: row.estimated_pickup_time ?? undefined,
    wasModifiedByOwner:  row.was_modified_by_owner,
    removedItemNames:    row.removed_item_names    ?? [],
    createdAt:           row.created_at,
    items: items.map((i) => ({
      name:     i.name,
      qty:      i.qty,
      price:    i.price,
      subtotal: i.qty * i.price,
    })),
  };
}
