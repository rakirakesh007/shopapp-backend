import express, { Request, Response } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { connectDb, seedDb, User, Shop, Product, Order, ShopRating,
         docToUser, docToShop, docToProduct, docToOrder } from './db';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/', (_req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'ShopApp API is running 🚀' });
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/login', async (req: Request, res: Response) => {
  const { phoneNumber, pin } = req.body as { phoneNumber?: string; pin?: string };

  if (!phoneNumber) {
    return res.status(400).json({ success: false, message: 'phoneNumber is required' });
  }
  if (!pin || !/^\d{4}$/.test(pin)) {
    return res.status(400).json({ success: false, message: 'A 4-digit PIN is required' });
  }

  try {
    const user = await User.findOne({ phoneNumber });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found. Please register.' });
    }

    if (!user.pin) {
      user.pin = pin;
      await user.save();
    } else if (user.pin !== pin) {
      return res.status(401).json({ success: false, message: 'Incorrect PIN. Please try again.' });
    }

    return res.json({ success: true, message: 'Login successful', user: docToUser(user) });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.post('/api/register', async (req: Request, res: Response) => {
  const { name, phoneNumber, role, latitude, longitude, pin } = req.body as {
    name?: string; phoneNumber?: string; role?: 'owner' | 'customer';
    latitude?: number; longitude?: number; pin?: string;
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
    const existing = await User.findOne({ phoneNumber });
    if (existing) {
      return res.status(409).json({ success: false, message: 'User already registered' });
    }

    const userId = `u_${Date.now()}`;
    await User.create({
      phoneNumber, role, userId, isSetupComplete: true,
      name: name ?? '', latitude: latitude ?? undefined, longitude: longitude ?? undefined, pin,
    });

    if (role === 'owner') {
      await Shop.create({
        shopId: `s_${Date.now()}`, ownerId: userId,
        shopName: name ? `${name}'s Shop` : 'New Shop',
        area: '', category: 'General', isOpen: false, rating: 0,
        ownerPhone: phoneNumber, shopAddress: '', ownerSpecialization: '',
        latitude: latitude ?? undefined, longitude: longitude ?? undefined,
        trialStartDate: new Date(), isActive: true, hasPaid: false,
      });
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

app.get('/api/shops', async (req: Request, res: Response) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const radiusKm = parseFloat(req.query.radius as string) || 10;

    let shopDocs;
    if (!isNaN(lat) && !isNaN(lng)) {
      // Get all active shops with coordinates, then filter by Haversine in JS
      shopDocs = await Shop.find({ isActive: true, latitude: { $ne: null }, longitude: { $ne: null } });
      const toRad = (d: number) => (d * Math.PI) / 180;
      const withDist = shopDocs
        .map((s: any) => {
          const dLat = toRad(s.latitude! - lat);
          const dLng = toRad(s.longitude! - lng);
          const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat)) * Math.cos(toRad(s.latitude!)) * Math.sin(dLng / 2) ** 2;
          const dist = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          return { doc: s, distanceKm: Math.round(dist * 10) / 10 };
        })
        .filter((s: any) => s.distanceKm <= radiusKm)
        .sort((a: any, b: any) => a.distanceKm - b.distanceKm);

      const shops = withDist.map((s: any) => ({ ...docToShop(s.doc), distanceKm: s.distanceKm }));
      return res.json({ success: true, shops });
    } else {
      shopDocs = await Shop.find({ isActive: true }).sort({ shopName: 1 });
      const shops = shopDocs.map((s: any) => ({ ...docToShop(s), distanceKm: null }));
      return res.json({ success: true, shops });
    }
  } catch (err) {
    console.error('getAllShops error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.get('/api/shop/:phoneNumber', async (req: Request, res: Response) => {
  const { phoneNumber } = req.params;
  try {
    const shop = await Shop.findOne({ ownerPhone: phoneNumber });
    if (!shop) {
      return res.status(404).json({ success: false, message: 'Shop not found for this phone number' });
    }
    return res.json({ success: true, shop: docToShop(shop) });
  } catch (err) {
    console.error('getShop error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.patch('/api/shop/details', async (req: Request, res: Response) => {
  const { phoneNumber, shopName, category, shopAddress, ownerSpecialization, ownerName, latitude, longitude, deliveryCharge } =
    req.body as {
      phoneNumber?: string; shopName?: string; category?: string;
      shopAddress?: string; ownerSpecialization?: string; ownerName?: string;
      latitude?: number; longitude?: number; deliveryCharge?: number;
    };

  if (!phoneNumber) {
    return res.status(400).json({ success: false, message: 'phoneNumber is required' });
  }

  try {
    if (shopName && shopAddress && shopAddress.trim() !== '') {
      const dup = await Shop.findOne({
        shopName: { $regex: new RegExp(`^${shopName}$`, 'i') },
        shopAddress: { $regex: new RegExp(`^${shopAddress}$`, 'i') },
        ownerPhone: { $ne: phoneNumber },
      });
      if (dup) {
        return res.status(409).json({ success: false, message: 'A shop with this name and address already exists' });
      }
    }

    const update: any = {};
    if (shopName !== undefined)            update.shopName = shopName;
    if (category !== undefined)            update.category = category;
    if (shopAddress !== undefined)         update.shopAddress = shopAddress;
    if (ownerSpecialization !== undefined)  update.ownerSpecialization = ownerSpecialization;
    if (latitude !== undefined)            update.latitude = latitude;
    if (longitude !== undefined)           update.longitude = longitude;
    if (deliveryCharge !== undefined)       update.deliveryCharge = deliveryCharge;

    if (Object.keys(update).length > 0) {
      await Shop.updateOne({ ownerPhone: phoneNumber }, { $set: update });
    }

    if (ownerName !== undefined) {
      await User.updateOne({ phoneNumber }, { $set: { name: ownerName } });
    }

    return res.json({ success: true, message: 'Shop details updated' });
  } catch (err) {
    console.error('updateShopDetails error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.patch('/api/user/name', async (req: Request, res: Response) => {
  const { phoneNumber, name } = req.body as { phoneNumber?: string; name?: string };
  if (!phoneNumber || !name) {
    return res.status(400).json({ success: false, message: 'phoneNumber and name are required' });
  }
  try {
    await User.updateOne({ phoneNumber }, { $set: { name } });
    return res.json({ success: true, message: 'User name updated' });
  } catch (err) {
    console.error('updateUserName error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.patch('/api/user/address', async (req: Request, res: Response) => {
  const { phoneNumber, address } = req.body as { phoneNumber?: string; address?: string };
  if (!phoneNumber || !address) {
    return res.status(400).json({ success: false, message: 'phoneNumber and address are required' });
  }
  try {
    await User.updateOne({ phoneNumber }, { $set: { address } });
    return res.json({ success: true, message: 'User address updated' });
  } catch (err) {
    console.error('updateUserAddress error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.patch('/api/shop/status', async (req: Request, res: Response) => {
  const { phoneNumber, isOpen } = req.body as { phoneNumber?: string; isOpen?: boolean };

  if (!phoneNumber || typeof isOpen !== 'boolean') {
    return res.status(400).json({ success: false, message: 'phoneNumber (string) and isOpen (boolean) are required' });
  }

  try {
    const shop = await Shop.findOneAndUpdate(
      { ownerPhone: phoneNumber },
      { $set: { isOpen } },
      { new: true },
    );
    if (!shop) {
      return res.status(404).json({ success: false, message: 'Shop not found' });
    }
    return res.json({
      success: true,
      message: `Shop is now ${isOpen ? 'Open 🟢' : 'Closed 🔴'}`,
      shop: docToShop(shop),
    });
  } catch (err) {
    console.error('toggleStatus error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCT ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/products/:shopId', async (req: Request, res: Response) => {
  const { shopId } = req.params;
  try {
    const products = await Product.find({ shopId }).sort({ name: 1 });
    return res.json({ success: true, products: products.map(docToProduct) });
  } catch (err) {
    console.error('getProducts error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.patch('/api/products/:productId/stock', async (req: Request, res: Response) => {
  const { productId } = req.params;
  const { stock } = req.body as { stock?: number };

  if (typeof stock !== 'number' || stock < 0) {
    return res.status(400).json({ success: false, message: 'stock (non-negative number) is required' });
  }
  try {
    const product = await Product.findOneAndUpdate(
      { productId },
      { $set: { stock } },
      { new: true },
    );
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    return res.json({ success: true, product: docToProduct(product) });
  } catch (err) {
    console.error('updateStock error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

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
    const product = await Product.create({
      productId, shopId, name, category, price, stock, minStock,
      unit: unit ?? 'pcs', imageUrl: imageUrl ?? '',
    });
    return res.status(201).json({ success: true, product: docToProduct(product) });
  } catch (err) {
    console.error('addProduct error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

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
    const update: any = {};
    if (name     !== undefined) update.name     = name;
    if (category !== undefined) update.category = category;
    if (price    !== undefined) update.price    = price;
    if (stock    !== undefined) update.stock    = stock;
    if (minStock !== undefined) update.minStock = minStock;
    if (unit     !== undefined) update.unit     = unit;
    if (imageUrl !== undefined) update.imageUrl = imageUrl;

    const product = await Product.findOneAndUpdate(
      { productId },
      { $set: update },
      { new: true },
    );
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    return res.json({ success: true, product: docToProduct(product) });
  } catch (err) {
    console.error('updateProduct error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.delete('/api/products/:productId', async (req: Request, res: Response) => {
  const { productId } = req.params;
  try {
    const result = await Product.deleteOne({ productId });
    if (result.deletedCount === 0) {
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

  try {
    const orderId = `ord_${Date.now()}`;
    await Order.create({
      orderId, customerName, customerPhone, shopId, shopName, ownerPhone,
      totalAmount, deliveryType,
      deliveryAddress: deliveryAddress ?? undefined,
      estimatedPickupTime: estimatedPickupTime ?? undefined,
      items,
    });
    return res.status(201).json({ success: true, orderId, message: 'Order placed successfully' });
  } catch (err) {
    console.error('placeOrder error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.get('/api/orders/shop/:ownerPhone', async (req: Request, res: Response) => {
  const { ownerPhone } = req.params;
  try {
    const orders = await Order.find({ ownerPhone }).sort({ createdAt: -1 });
    return res.json({ success: true, orders: orders.map(docToOrder) });
  } catch (err) {
    console.error('getShopOrders error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.patch('/api/orders/:orderId/status', async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const { status } = req.body as { status?: string };
  const valid = ['newOrder', 'preparing', 'ready', 'completed'];

  if (!status || !valid.includes(status)) {
    return res.status(400).json({ success: false, message: `status must be one of: ${valid.join(', ')}` });
  }
  try {
    const order = await Order.findOneAndUpdate(
      { orderId },
      { $set: { status } },
      { new: true },
    );
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    return res.json({ success: true, message: `Order is now "${status}"`, order: docToOrder(order) });
  } catch (err) {
    console.error('updateOrderStatus error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.get('/api/orders/customer/:phone', async (req: Request, res: Response) => {
  const { phone } = req.params;
  try {
    const orders = await Order.find({ customerPhone: phone }).sort({ createdAt: -1 });
    return res.json({ success: true, orders: orders.map(docToOrder) });
  } catch (err) {
    console.error('getCustomerOrders error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SUBSCRIPTION / TRIAL ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/shop/subscription/:phoneNumber', async (req: Request, res: Response) => {
  const { phoneNumber } = req.params;
  try {
    const shop = await Shop.findOne({ ownerPhone: phoneNumber });
    if (!shop) {
      return res.status(404).json({ success: false, message: 'Shop not found' });
    }
    const now = new Date();

    const trialStart    = new Date(shop.trialStartDate);
    const trialStartDay = new Date(trialStart.getFullYear(), trialStart.getMonth(), trialStart.getDate());
    const todayDay      = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const daysSinceTrial = Math.floor((todayDay.getTime() - trialStartDay.getTime()) / (1000 * 60 * 60 * 24));
    const trialExpired   = daysSinceTrial >= 7;
    const trialDaysLeft  = Math.max(0, 7 - daysSinceTrial);

    let subscriptionExpired = true;
    let subDaysLeft         = 0;
    if (shop.subscriptionPaidAt) {
      const paidAt           = new Date(shop.subscriptionPaidAt);
      const daysSincePayment = Math.floor((now.getTime() - paidAt.getTime()) / (1000 * 60 * 60 * 24));
      subscriptionExpired    = daysSincePayment > 30;
      subDaysLeft            = Math.max(0, 30 - daysSincePayment);
    }

    const isActive = (!trialExpired) || (shop.hasPaid && !subscriptionExpired);

    if (!isActive && shop.isActive) {
      await Shop.updateOne({ ownerPhone: phoneNumber }, { $set: { isActive: false } });
    }
    if (isActive && !shop.isActive) {
      await Shop.updateOne({ ownerPhone: phoneNumber }, { $set: { isActive: true } });
    }

    return res.json({
      success:              true,
      trialStartDate:       shop.trialStartDate,
      trialDaysRemaining:   trialDaysLeft,
      trialExpired,
      hasPaid:              shop.hasPaid,
      subscriptionPaidAt:   shop.subscriptionPaidAt ?? null,
      subscriptionDaysRemaining: subDaysLeft,
      subscriptionExpired,
      isActive,
      paymentReference:     shop.paymentReference,
    });
  } catch (err) {
    console.error('getSubscription error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.post('/api/shop/payment', async (req: Request, res: Response) => {
  const { phoneNumber, paymentReference } = req.body as {
    phoneNumber?: string; paymentReference?: string;
  };

  if (!phoneNumber || !paymentReference) {
    return res.status(400).json({ success: false, message: 'phoneNumber and paymentReference are required' });
  }

  try {
    const shop = await Shop.findOneAndUpdate(
      { ownerPhone: phoneNumber },
      { $set: { hasPaid: true, isActive: true, paymentReference, subscriptionPaidAt: new Date() } },
      { new: true },
    );
    if (!shop) {
      return res.status(404).json({ success: false, message: 'Shop not found' });
    }
    return res.json({ success: true, message: 'Payment recorded. Shop activated for 30 days!', shop: docToShop(shop) });
  } catch (err) {
    console.error('recordPayment error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// RATING ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/shop/rate', async (req: Request, res: Response) => {
  const { shopId, customerPhone, rating } = req.body as {
    shopId?: string; customerPhone?: string; rating?: number;
  };

  if (!shopId || !customerPhone || typeof rating !== 'number' || rating < 1 || rating > 5) {
    return res.status(400).json({
      success: false, message: 'shopId, customerPhone and rating (1–5) are required',
    });
  }

  try {
    await ShopRating.findOneAndUpdate(
      { shopId, customerPhone },
      { $set: { rating } },
      { upsert: true, new: true },
    );

    // Recalculate average
    const agg = await ShopRating.aggregate([
      { $match: { shopId } },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    const newRating    = agg.length > 0 ? Math.round(agg[0].avg * 10) / 10 : 0;
    const ratingsCount = agg.length > 0 ? agg[0].count : 0;

    await Shop.updateOne({ shopId }, { $set: { rating: newRating, ratingsCount } });

    return res.json({ success: true, message: 'Rating submitted successfully', newRating, ratingsCount });
  } catch (err) {
    console.error('submitShopRating error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.get('/api/shop/myrating/:shopId/:customerPhone', async (req: Request, res: Response) => {
  const { shopId, customerPhone } = req.params;
  try {
    const doc = await ShopRating.findOne({ shopId, customerPhone });
    return res.json({ success: true, myRating: doc ? doc.rating : null });
  } catch (err) {
    console.error('getMyRating error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  await connectDb();
  await seedDb();
  app.listen(PORT, () => {
    console.log(`✅  ShopApp backend running on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

export default app;
