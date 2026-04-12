import express, { Request, Response } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { pool, initDb, rowToUser, rowToShop, rowToProduct, rowToOrder } from './db';

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
  const { phoneNumber, pin } = req.body as { phoneNumber?: string; pin?: string };

  if (!phoneNumber) {
    return res.status(400).json({ success: false, message: 'phoneNumber is required' });
  }
  if (!pin || !/^\d{4}$/.test(pin)) {
    return res.status(400).json({ success: false, message: 'A 4-digit PIN is required' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE phone_number = $1',
      [phoneNumber],
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found. Please register.' });
    }

    const user = rows[0];
    if (user.pin === null || user.pin === undefined || user.pin === '') {
      // User registered before PIN feature — auto-set their PIN (migration)
      await pool.query('UPDATE users SET pin = $1 WHERE phone_number = $2', [pin, phoneNumber]);
    } else if (user.pin !== pin) {
      return res.status(401).json({ success: false, message: 'Incorrect PIN. Please try again.' });
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
  const { name, phoneNumber, role, latitude, longitude, pin } = req.body as {
    name?: string;
    phoneNumber?: string;
    role?: 'owner' | 'customer';
    latitude?: number;
    longitude?: number;
    pin?: string;
  };

  if (!phoneNumber || !role) {
    return res.status(400).json({ success: false, message: 'phoneNumber and role are required' });
  }
  if (role !== 'owner' && role !== 'customer') {
    return res.status(400).json({ success: false, message: 'role must be owner or customer' });
  }
  if (!pin || !/^\d{4}$/.test(pin)) {
    return res.status(400).json({ success: false, message: 'A 4-digit numeric PIN is required' });
  }

  try {
    const existing = await pool.query('SELECT 1 FROM users WHERE phone_number = $1', [phoneNumber]);
    if (existing.rowCount && existing.rowCount > 0) {
      return res.status(409).json({ success: false, message: 'User already registered' });
    }

    const userId = `u_${Date.now()}`;
    await pool.query(
      `INSERT INTO users (phone_number, role, user_id, is_setup_complete, name, latitude, longitude, pin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [phoneNumber, role, userId, true, name ?? '', latitude ?? null, longitude ?? null, pin],
    );

    if (role === 'owner') {
      await pool.query(
        `INSERT INTO shops
           (shop_id, owner_id, shop_name, area, category, is_open, rating, owner_phone, shop_address, owner_specialization, latitude, longitude, trial_start_date, is_active, has_paid)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), true, false)`,
        [`s_${Date.now()}`, userId, name ? `${name}'s Shop` : 'New Shop', '', 'General', false, 0, phoneNumber, '', '', latitude ?? null, longitude ?? null],
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
 * GET /api/shops
 * Query params: lat, lng, radius (km, default 10)
 * Returns nearby shops if lat/lng provided, else all shops.
 * Only returns active shops (is_active = true).
 */
app.get('/api/shops', async (req: Request, res: Response) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const radiusKm = parseFloat(req.query.radius as string) || 10;

    let rows;
    if (!isNaN(lat) && !isNaN(lng)) {
      // Haversine formula in SQL to calculate distance in km
      const result = await pool.query(
        `SELECT *,
           ( 6371 * acos(
               LEAST(1.0, cos(radians($1)) * cos(radians(latitude))
               * cos(radians(longitude) - radians($2))
               + sin(radians($1)) * sin(radians(latitude)))
           )) AS distance_km
         FROM shops
         WHERE is_active = true
           AND latitude IS NOT NULL AND longitude IS NOT NULL
         HAVING ( 6371 * acos(
               LEAST(1.0, cos(radians($1)) * cos(radians(latitude))
               * cos(radians(longitude) - radians($2))
               + sin(radians($1)) * sin(radians(latitude)))
           )) <= $3
         ORDER BY distance_km`,
        [lat, lng, radiusKm],
      );
      rows = result.rows;
    } else {
      const result = await pool.query(
        'SELECT * FROM shops WHERE is_active = true ORDER BY shop_name',
      );
      rows = result.rows;
    }

    const shops = rows.map((r: any) => {
      const s = rowToShop(r);
      return { ...s, distanceKm: r.distance_km ? Math.round(r.distance_km * 10) / 10 : null };
    });
    return res.json({ success: true, shops });
  } catch (err) {
    console.error('getAllShops error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

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
 * PATCH /api/shop/details
 * Body: { phoneNumber, shopName?, category?, shopAddress?, ownerSpecialization?, ownerName? }
 * Updates the shop's display details (called from ShopSetupPage / ProfilePage).
 * Also updates the owner's name in the users table if ownerName is supplied.
 */
app.patch('/api/shop/details', async (req: Request, res: Response) => {
  const { phoneNumber, shopName, category, shopAddress, ownerSpecialization, ownerName, latitude, longitude, deliveryCharge } =
    req.body as {
      phoneNumber?: string;
      shopName?: string;
      category?: string;
      shopAddress?: string;
      ownerSpecialization?: string;
      ownerName?: string;
      latitude?: number;
      longitude?: number;
      deliveryCharge?: number;
    };

  if (!phoneNumber) {
    return res.status(400).json({ success: false, message: 'phoneNumber is required' });
  }

  try {
    // Check for duplicate shop_name + shop_address (only if both provided and non-empty)
    if (shopName && shopAddress && shopAddress.trim() !== '') {
      const dup = await pool.query(
        `SELECT shop_id FROM shops WHERE LOWER(shop_name) = LOWER($1) AND LOWER(shop_address) = LOWER($2) AND owner_phone <> $3`,
        [shopName, shopAddress, phoneNumber],
      );
      if (dup.rowCount && dup.rowCount > 0) {
        return res.status(409).json({ success: false, message: 'A shop with this name and address already exists' });
      }
    }

    const sets: string[] = [];
    const vals: (string | number | null)[] = [];
    let i = 1;
    if (shopName !== undefined)             { sets.push(`shop_name = $${i++}`);             vals.push(shopName); }
    if (category !== undefined)             { sets.push(`category = $${i++}`);              vals.push(category); }
    if (shopAddress !== undefined)          { sets.push(`shop_address = $${i++}`);          vals.push(shopAddress); }
    if (ownerSpecialization !== undefined)  { sets.push(`owner_specialization = $${i++}`);  vals.push(ownerSpecialization); }
    if (latitude !== undefined)             { sets.push(`latitude = $${i++}`);              vals.push(latitude); }
    if (longitude !== undefined)            { sets.push(`longitude = $${i++}`);             vals.push(longitude); }
    if (deliveryCharge !== undefined)       { sets.push(`delivery_charge = $${i++}`);       vals.push(deliveryCharge); }

    if (sets.length > 0) {
      vals.push(phoneNumber);
      await pool.query(
        `UPDATE shops SET ${sets.join(', ')} WHERE owner_phone = $${i}`,
        vals,
      );
    }

    if (ownerName !== undefined) {
      await pool.query(
        'UPDATE users SET name = $1 WHERE phone_number = $2',
        [ownerName, phoneNumber],
      );
    }

    return res.json({ success: true, message: 'Shop details updated' });
  } catch (err) {
    console.error('updateShopDetails error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

/**
 * PATCH /api/user/name
 * Body: { phoneNumber, name }
 * Updates the name field for any user (owner or customer).
 */
app.patch('/api/user/name', async (req: Request, res: Response) => {
  const { phoneNumber, name } = req.body as { phoneNumber?: string; name?: string };
  if (!phoneNumber || !name) {
    return res.status(400).json({ success: false, message: 'phoneNumber and name are required' });
  }
  try {
    await pool.query('UPDATE users SET name = $1 WHERE phone_number = $2', [name, phoneNumber]);
    return res.json({ success: true, message: 'User name updated' });
  } catch (err) {
    console.error('updateUserName error:', err);
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
// PRODUCT ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/products/:shopId
 * Returns all products belonging to a shop.
 */
app.get('/api/products/:shopId', async (req: Request, res: Response) => {
  const { shopId } = req.params;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM products WHERE shop_id = $1 ORDER BY name',
      [shopId],
    );
    return res.json({ success: true, products: rows.map(rowToProduct) });
  } catch (err) {
    console.error('getProducts error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

/**
 * PATCH /api/products/:productId/stock
 * Body: { stock: number }
 * Updates the stock count for a product.
 */
app.patch('/api/products/:productId/stock', async (req: Request, res: Response) => {
  const { productId } = req.params;
  const { stock } = req.body as { stock?: number };

  if (typeof stock !== 'number' || stock < 0) {
    return res.status(400).json({ success: false, message: 'stock (non-negative number) is required' });
  }
  try {
    const { rows } = await pool.query(
      'UPDATE products SET stock = $1 WHERE product_id = $2 RETURNING *',
      [stock, productId],
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    return res.json({ success: true, product: rowToProduct(rows[0]) });
  } catch (err) {
    console.error('updateStock error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

/**
 * POST /api/products
 * Body: { shopId, name, category, price, stock, minStock, unit?, imageUrl? }
 * Creates a new product for a shop.
 */
app.post('/api/products', async (req: Request, res: Response) => {
  const { shopId, name, category, price, stock, minStock, unit, imageUrl } = req.body as {
    shopId?: string; name?: string; category?: string;
    price?: number; stock?: number; minStock?: number;
    unit?: string; imageUrl?: string;
  };

  if (!shopId || !name || !category || price == null || stock == null || minStock == null) {
    return res.status(400).json({ success: false, message: 'shopId, name, category, price, stock, minStock are required' });
  }
  try {
    const productId = `p_${Date.now()}`;
    const { rows } = await pool.query(
      `INSERT INTO products (product_id, shop_id, name, category, price, stock, min_stock, unit, image_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [productId, shopId, name, category, price, stock, minStock, unit ?? 'pcs', imageUrl ?? ''],
    );
    return res.status(201).json({ success: true, product: rowToProduct(rows[0]) });
  } catch (err) {
    console.error('addProduct error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

/**
 * PATCH /api/products/:productId
 * Body: { name?, category?, price?, stock?, minStock?, unit?, imageUrl? }
 * Updates product details (full edit — separate from stock-only PATCH).
 */
app.patch('/api/products/:productId', async (req: Request, res: Response) => {
  const { productId } = req.params;
  const { name, category, price, stock, minStock, unit, imageUrl } = req.body as {
    name?: string; category?: string; price?: number;
    stock?: number; minStock?: number; unit?: string; imageUrl?: string;
  };

  if (!name && !category && price == null && stock == null && minStock == null && !unit && !imageUrl) {
    return res.status(400).json({ success: false, message: 'At least one field to update is required' });
  }

  try {
    const sets: string[] = [];
    const vals: (string | number)[] = [];
    let i = 1;
    if (name      !== undefined) { sets.push(`name = $${i++}`);       vals.push(name); }
    if (category  !== undefined) { sets.push(`category = $${i++}`);   vals.push(category); }
    if (price     !== undefined) { sets.push(`price = $${i++}`);      vals.push(price); }
    if (stock     !== undefined) { sets.push(`stock = $${i++}`);      vals.push(stock); }
    if (minStock  !== undefined) { sets.push(`min_stock = $${i++}`);  vals.push(minStock); }
    if (unit      !== undefined) { sets.push(`unit = $${i++}`);       vals.push(unit); }
    if (imageUrl  !== undefined) { sets.push(`image_url = $${i++}`);  vals.push(imageUrl); }
    vals.push(productId);

    const { rows } = await pool.query(
      `UPDATE products SET ${sets.join(', ')} WHERE product_id = $${i} RETURNING *`,
      vals,
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    return res.json({ success: true, product: rowToProduct(rows[0]) });
  } catch (err) {
    console.error('updateProduct error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

/**
 * DELETE /api/products/:productId
 * Removes a product from the database.
 */
app.delete('/api/products/:productId', async (req: Request, res: Response) => {
  const { productId } = req.params;
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM products WHERE product_id = $1',
      [productId],
    );
    if (rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    return res.json({ success: true, message: 'Product deleted' });
  } catch (err) {
    console.error('deleteProduct error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ORDER ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/orders
 * Body: { customerName, customerPhone, shopId, shopName, ownerPhone,
 *         totalAmount, deliveryType, deliveryAddress?, estimatedPickupTime?,
 *         items: [{ name, qty, price }] }
 * Creates a new order with its items.
 */
app.post('/api/orders', async (req: Request, res: Response) => {
  const { customerName, customerPhone, shopId, shopName, ownerPhone,
          totalAmount, deliveryType, deliveryAddress, estimatedPickupTime, items } = req.body as {
    customerName?: string; customerPhone?: string;
    shopId?: string; shopName?: string; ownerPhone?: string;
    totalAmount?: number; deliveryType?: string;
    deliveryAddress?: string; estimatedPickupTime?: string;
    items?: Array<{ name: string; qty: number; price: number }>;
  };

  if (!customerName || !customerPhone || !shopId || !shopName || !ownerPhone ||
      totalAmount == null || !deliveryType || !items?.length) {
    return res.status(400).json({ success: false, message: 'Missing required order fields' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderId = `ord_${Date.now()}`;
    await client.query(
      `INSERT INTO orders
         (order_id, customer_name, customer_phone, shop_id, shop_name, owner_phone,
          total_amount, delivery_type, delivery_address, estimated_pickup_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [orderId, customerName, customerPhone, shopId, shopName, ownerPhone,
       totalAmount, deliveryType, deliveryAddress ?? null, estimatedPickupTime ?? null],
    );
    for (const item of items) {
      await client.query(
        'INSERT INTO order_items (order_id, name, qty, price) VALUES ($1,$2,$3,$4)',
        [orderId, item.name, item.qty, item.price],
      );
    }
    await client.query('COMMIT');
    return res.status(201).json({ success: true, orderId, message: 'Order placed successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('placeOrder error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/orders/shop/:ownerPhone
 * Returns all orders for a shop (owner view), most recent first.
 */
app.get('/api/orders/shop/:ownerPhone', async (req: Request, res: Response) => {
  const { ownerPhone } = req.params;
  try {
    const { rows: orderRows } = await pool.query(
      'SELECT * FROM orders WHERE owner_phone = $1 ORDER BY created_at DESC',
      [ownerPhone],
    );
    const orders = await Promise.all(orderRows.map(async (o) => {
      const { rows: itemRows } = await pool.query(
        'SELECT * FROM order_items WHERE order_id = $1',
        [o.order_id],
      );
      return rowToOrder(o, itemRows);
    }));
    return res.json({ success: true, orders });
  } catch (err) {
    console.error('getShopOrders error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

/**
 * PATCH /api/orders/:orderId/status
 * Body: { status: 'newOrder' | 'preparing' | 'ready' | 'completed' }
 * Advances an order's status.
 */
app.patch('/api/orders/:orderId/status', async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const { status } = req.body as { status?: string };
  const valid = ['newOrder', 'preparing', 'ready', 'completed'];

  if (!status || !valid.includes(status)) {
    return res.status(400).json({ success: false, message: `status must be one of: ${valid.join(', ')}` });
  }
  try {
    const { rows } = await pool.query(
      'UPDATE orders SET status = $1 WHERE order_id = $2 RETURNING *',
      [status, orderId],
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    return res.json({ success: true, message: `Order is now "${status}"`, order: rowToOrder(rows[0]) });
  } catch (err) {
    console.error('updateOrderStatus error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

/**
 * GET /api/orders/customer/:phone
 * Returns all orders placed by a customer, most recent first.
 */
app.get('/api/orders/customer/:phone', async (req: Request, res: Response) => {
  const { phone } = req.params;
  try {
    const { rows: orderRows } = await pool.query(
      'SELECT * FROM orders WHERE customer_phone = $1 ORDER BY created_at DESC',
      [phone],
    );
    const orders = await Promise.all(orderRows.map(async (o) => {
      const { rows: itemRows } = await pool.query(
        'SELECT * FROM order_items WHERE order_id = $1',
        [o.order_id],
      );
      return rowToOrder(o, itemRows);
    }));
    return res.json({ success: true, orders });
  } catch (err) {
    console.error('getCustomerOrders error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SUBSCRIPTION / TRIAL ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/shop/subscription/:phoneNumber
 * Returns subscription status for the shop owner.
 * Logic:
 *   • 7-day free trial from trial_start_date.
 *   • After paying, subscription valid for 30 days from subscription_paid_at.
 *   • If neither is active, deactivate the shop automatically.
 */
app.get('/api/shop/subscription/:phoneNumber', async (req: Request, res: Response) => {
  const { phoneNumber } = req.params;
  try {
    const { rows } = await pool.query(
      'SELECT trial_start_date, is_active, has_paid, payment_reference, subscription_paid_at FROM shops WHERE owner_phone = $1',
      [phoneNumber],
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Shop not found' });
    }
    const shop = rows[0];
    const now = new Date();

    // ── Trial window (7 days) ─────────────────────────────────────────
    // Use date-only comparison (strip time) so a user who signs up today
    // gets the FULL 7 days, not "0 days left" because of time-of-day offset.
    const trialStart      = new Date(shop.trial_start_date);
    const trialStartDay   = new Date(trialStart.getFullYear(), trialStart.getMonth(), trialStart.getDate());
    const todayDay        = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const daysSinceTrial  = Math.floor((todayDay.getTime() - trialStartDay.getTime()) / (1000 * 60 * 60 * 24));
    const trialExpired    = daysSinceTrial >= 7;
    const trialDaysLeft   = Math.max(0, 7 - daysSinceTrial);

    // ── Paid subscription window (30 days from last payment) ──────────
    let subscriptionExpired = true;
    let subDaysLeft         = 0;
    if (shop.subscription_paid_at) {
      const paidAt          = new Date(shop.subscription_paid_at);
      const daysSincePayment = Math.floor((now.getTime() - paidAt.getTime()) / (1000 * 60 * 60 * 24));
      subscriptionExpired   = daysSincePayment > 30;
      subDaysLeft           = Math.max(0, 30 - daysSincePayment);
    }

    // Shop is active if either in trial OR paid subscription is still valid
    const isActive = (!trialExpired) || (shop.has_paid && !subscriptionExpired);

    // Auto-deactivate if neither window is active
    if (!isActive && shop.is_active) {
      await pool.query('UPDATE shops SET is_active = false WHERE owner_phone = $1', [phoneNumber]);
    }
    // Re-activate if payment is recent (e.g. payment was just recorded)
    if (isActive && !shop.is_active) {
      await pool.query('UPDATE shops SET is_active = true WHERE owner_phone = $1', [phoneNumber]);
    }

    return res.json({
      success:              true,
      trialStartDate:       shop.trial_start_date,
      trialDaysRemaining:   trialDaysLeft,
      trialExpired,
      hasPaid:              shop.has_paid,
      subscriptionPaidAt:   shop.subscription_paid_at ?? null,
      subscriptionDaysRemaining: subDaysLeft,
      subscriptionExpired,
      isActive,
      paymentReference:     shop.payment_reference,
    });
  } catch (err) {
    console.error('getSubscription error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

/**
 * POST /api/shop/payment
 * Body: { phoneNumber, paymentReference }
 * Records a payment reference, activates the shop, and resets the 30-day subscription window.
 */
app.post('/api/shop/payment', async (req: Request, res: Response) => {
  const { phoneNumber, paymentReference } = req.body as {
    phoneNumber?: string;
    paymentReference?: string;
  };

  if (!phoneNumber || !paymentReference) {
    return res.status(400).json({ success: false, message: 'phoneNumber and paymentReference are required' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE shops
         SET has_paid = true, is_active = true,
             payment_reference = $1, subscription_paid_at = NOW()
       WHERE owner_phone = $2 RETURNING *`,
      [paymentReference, phoneNumber],
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Shop not found' });
    }
    return res.json({ success: true, message: 'Payment recorded. Shop activated for 30 days!', shop: rowToShop(rows[0]) });
  } catch (err) {
    console.error('recordPayment error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// RATING ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/shop/rate
 * Body: { shopId, customerPhone, rating }
 * Upserts a rating for a shop by a customer, then recalculates the running average.
 * One rating per customer per shop (updates if they rate again).
 */
app.post('/api/shop/rate', async (req: Request, res: Response) => {
  const { shopId, customerPhone, rating } = req.body as {
    shopId?: string;
    customerPhone?: string;
    rating?: number;
  };

  if (!shopId || !customerPhone || typeof rating !== 'number' || rating < 1 || rating > 5) {
    return res.status(400).json({
      success: false,
      message: 'shopId, customerPhone and rating (1–5) are required',
    });
  }

  try {
    // Upsert: insert new rating or update existing one for this customer
    await pool.query(
      `INSERT INTO shop_ratings (shop_id, customer_phone, rating)
       VALUES ($1, $2, $3)
       ON CONFLICT (shop_id, customer_phone)
       DO UPDATE SET rating = EXCLUDED.rating, created_at = NOW()`,
      [shopId, customerPhone, rating],
    );

    // Recalculate average + count and persist back to the shop row
    const { rows } = await pool.query(
      `UPDATE shops
         SET rating        = (SELECT ROUND(AVG(rating)::numeric, 1) FROM shop_ratings WHERE shop_id = $1),
             ratings_count = (SELECT COUNT(*)                        FROM shop_ratings WHERE shop_id = $1)
       WHERE shop_id = $1
       RETURNING rating, ratings_count`,
      [shopId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Shop not found' });
    }

    return res.json({
      success:      true,
      message:      'Rating submitted successfully',
      newRating:    rows[0].rating,
      ratingsCount: rows[0].ratings_count,
    });
  } catch (err) {
    console.error('submitShopRating error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

/**
 * GET /api/shop/myrating/:shopId/:customerPhone
 * Returns the rating this customer has previously submitted for a shop (if any).
 */
app.get('/api/shop/myrating/:shopId/:customerPhone', async (req: Request, res: Response) => {
  const { shopId, customerPhone } = req.params;
  try {
    const { rows } = await pool.query(
      'SELECT rating FROM shop_ratings WHERE shop_id = $1 AND customer_phone = $2',
      [shopId, customerPhone],
    );
    return res.json({
      success:   true,
      myRating:  rows.length > 0 ? rows[0].rating : null,
    });
  } catch (err) {
    console.error('getMyRating error:', err);
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
