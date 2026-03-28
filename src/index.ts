import express, { Request, Response } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { pool, initDb, rowToUser, rowToShop } from './db';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ── Types ──────────────────────────────────────────────────────────────────────
// (kept for request-body typing only — DB returns are mapped by rowToUser/rowToShop)

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/', (_req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'ShopApp API is running 🚀' });
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/login
 * Body: { phoneNumber: string }
 * Looks up the user in the PostgreSQL `users` table.
 */
app.post('/api/login', async (req: Request, res: Response) => {
  const { phoneNumber } = req.body as { phoneNumber?: string };

  if (!phoneNumber) {
    return res.status(400).json({ success: false, message: 'phoneNumber is required' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE phone_number = $1',
      [phoneNumber],
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found. Please register.' });
    }
    return res.json({ success: true, message: 'Login successful', user: rowToUser(rows[0]) });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

/**
 * POST /api/register
 * Body: { name?, phoneNumber, role, latitude?, longitude? }
 * Inserts a new row into `users`.
 * If role is 'owner', also inserts a default row into `shops`.
 */
app.post('/api/register', async (req: Request, res: Response) => {
  const { name, phoneNumber, role, latitude, longitude } = req.body as {
    name?: string;
    phoneNumber?: string;
    role?: 'owner' | 'customer';
    latitude?: number;
    longitude?: number;
  };

  if (!phoneNumber || !role) {
    return res.status(400).json({ success: false, message: 'phoneNumber and role are required' });
  }
  if (role !== 'owner' && role !== 'customer') {
    return res.status(400).json({ success: false, message: 'role must be owner or customer' });
  }

  try {
    const existing = await pool.query('SELECT 1 FROM users WHERE phone_number = $1', [phoneNumber]);
    if (existing.rowCount && existing.rowCount > 0) {
      return res.status(409).json({ success: false, message: 'User already registered' });
    }

    const userId = `u_${Date.now()}`;
    await pool.query(
      `INSERT INTO users (phone_number, role, user_id, is_setup_complete, name, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [phoneNumber, role, userId, true, name ?? '', latitude ?? null, longitude ?? null],
    );

    if (role === 'owner') {
      await pool.query(
        `INSERT INTO shops
           (shop_id, owner_id, shop_name, area, category, is_open, rating, owner_phone, shop_address, owner_specialization)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [`s_${Date.now()}`, userId, name ? `${name}'s Shop` : 'New Shop', '', 'General', false, 0, phoneNumber, '', ''],
      );
    }

    const newUser = { phoneNumber, role, userId, isSetupComplete: true, name: name ?? '' };
    return res.status(201).json({ success: true, message: 'Registration successful', user: newUser });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SHOP ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/shop/:phoneNumber
 * Returns the shop linked to the given owner phone number.
 */
app.get('/api/shop/:phoneNumber', async (req: Request, res: Response) => {
  const { phoneNumber } = req.params;

  try {
    const { rows } = await pool.query(
      'SELECT * FROM shops WHERE owner_phone = $1',
      [phoneNumber],
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Shop not found for this phone number' });
    }
    return res.json({ success: true, shop: rowToShop(rows[0]) });
  } catch (err) {
    console.error('getShop error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

/**
 * PATCH /api/shop/status
 * Body: { phoneNumber: string, isOpen: boolean }
 * Updates the is_open flag in the `shops` table and returns the updated row.
 */
app.patch('/api/shop/status', async (req: Request, res: Response) => {
  const { phoneNumber, isOpen } = req.body as {
    phoneNumber?: string;
    isOpen?: boolean;
  };

  if (!phoneNumber || typeof isOpen !== 'boolean') {
    return res
      .status(400)
      .json({ success: false, message: 'phoneNumber (string) and isOpen (boolean) are required' });
  }

  try {
    const { rows } = await pool.query(
      'UPDATE shops SET is_open = $1 WHERE owner_phone = $2 RETURNING *',
      [isOpen, phoneNumber],
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Shop not found' });
    }
    return res.json({
      success: true,
      message: `Shop is now ${isOpen ? 'Open 🟢' : 'Closed 🔴'}`,
      shop: rowToShop(rows[0]),
    });
  } catch (err) {
    console.error('toggleStatus error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  await initDb();           // create tables + seed data on first boot
  app.listen(PORT, () => {
    console.log(`✅  ShopApp backend running on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

export default app;
