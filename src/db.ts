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
      longitude         DOUBLE PRECISION
    )
  `);

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
      owner_specialization VARCHAR(50)  NOT NULL DEFAULT ''
    )
  `);

  // ── Seed users (only if table is empty) ─────────────────────────────────────
  const { rowCount: userCount } = await pool.query('SELECT 1 FROM users LIMIT 1');
  if (!userCount) {
    await pool.query(`
      INSERT INTO users (phone_number, role, user_id, is_setup_complete, name) VALUES
      ('9876543210', 'owner',    'u_101', true, 'Sharma Ji'),
      ('1234567890', 'customer', 'u_102', true, 'Rahul Kumar')
    `);
    console.log('📦  Seeded 2 users');
  }

  // ── Seed shops (only if table is empty) ─────────────────────────────────────
  const { rowCount: shopCount } = await pool.query('SELECT 1 FROM shops LIMIT 1');
  if (!shopCount) {
    await pool.query(`
      INSERT INTO shops
        (shop_id, owner_id, shop_name, area, category, is_open, rating, owner_phone, shop_address, owner_specialization)
      VALUES
        ('s_001','u_101','Sharma Grocery',       'Munger',    'Grocery',     true,  4.3,'9876543210','12, Station Road, Munger, Bihar',     'Retail'),
        ('s_002','u_103','RK Electronics',        'Munger',    'Electronics', true,  4.1,'9123456780','45, Kasim Bazar, Munger, Bihar',      'Retail'),
        ('s_003','u_104','Patna Fashions',         'Patna',     'Ethnic Wear', false, 3.8,'9001122334','78, Boring Road, Patna, Bihar',       'Wholesale'),
        ('s_004','u_105','Jamalpur Dairy',         'Jamalpur',  'Dairy',       true,  4.5,'9988776655','3, Loco Colony, Jamalpur, Bihar',    'Retail'),
        ('s_005','u_106','Munger Mart',            'Munger',    'Grocery',     true,  4.0,'9445566778','22, Gandhi Chowk, Munger, Bihar',    'Both'),
        ('s_006','u_107','Darbhanga Cloth House',  'Darbhanga', 'Fabrics',     true,  4.2,'9554433221','56, Laheriasarai, Darbhanga, Bihar', 'Wholesale'),
        ('s_007','u_108','Patna Electronics Hub',  'Patna',     'Electronics', false, 3.9,'9667788990','90, Frazer Road, Patna, Bihar',      'Retail'),
        ('s_008','u_109','Fresh Dairy Munger',     'Munger',    'Dairy',       true,  4.4,'9778899001','8, Civil Lines, Munger, Bihar',      'Retail')
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
  };
}
