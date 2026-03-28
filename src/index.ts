import express, { Request, Response } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { readData, saveData } from './helpers';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ── Types ──────────────────────────────────────────────────────────────────────
interface User {
  phoneNumber: string;
  role: 'owner' | 'customer';
  userId: string;
  isSetupComplete: boolean;
  name?: string;
  latitude?: number;
  longitude?: number;
}

interface Shop {
  shopId: string;
  ownerId: string;
  shopName: string;
  area: string;
  category: string;
  isOpen: boolean;
  rating: number;
  ownerPhone: string;
  shopAddress: string;
  ownerSpecialization: string;
}

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
 * Searches users.json for the phone number.
 * Returns user object on success, 404 if not found.
 */
app.post('/api/login', (req: Request, res: Response) => {
  const { phoneNumber } = req.body as { phoneNumber?: string };

  if (!phoneNumber) {
    return res.status(400).json({ success: false, message: 'phoneNumber is required' });
  }

  const users = readData<User>('users.json');
  const user = users.find((u) => u.phoneNumber === phoneNumber);

  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found. Please register.' });
  }

  return res.json({ success: true, message: 'Login successful', user });
});

/**
 * POST /api/register
 * Body: { name, phoneNumber, role, latitude?, longitude? }
 * Creates a new user in users.json.
 * If role is 'owner', also creates a default shop entry in shops.json.
 */
app.post('/api/register', (req: Request, res: Response) => {
  const { name, phoneNumber, role, latitude, longitude } = req.body as {
    name?: string;
    phoneNumber?: string;
    role?: 'owner' | 'customer';
    latitude?: number;
    longitude?: number;
  };

  if (!phoneNumber || !role) {
    return res
      .status(400)
      .json({ success: false, message: 'phoneNumber and role are required' });
  }
  if (role !== 'owner' && role !== 'customer') {
    return res.status(400).json({ success: false, message: 'role must be owner or customer' });
  }

  const users = readData<User>('users.json');

  // Prevent duplicate registrations
  if (users.find((u) => u.phoneNumber === phoneNumber)) {
    return res.status(409).json({ success: false, message: 'User already registered' });
  }

  const newUser: User = {
    phoneNumber,
    role,
    userId: `u_${Date.now()}`,
    isSetupComplete: true,
    name: name ?? '',
    latitude,
    longitude,
  };

  users.push(newUser);
  saveData('users.json', users);

  // Auto-create a default shop entry for new owners
  if (role === 'owner') {
    const shops = readData<Shop>('shops.json');
    const defaultShop: Shop = {
      shopId: `s_${Date.now()}`,
      ownerId: newUser.userId,
      shopName: name ? `${name}'s Shop` : 'New Shop',
      area: '',
      category: 'General',
      isOpen: false,
      rating: 0,
      ownerPhone: phoneNumber,
      shopAddress: '',
      ownerSpecialization: '',
    };
    shops.push(defaultShop);
    saveData('shops.json', shops);
  }

  return res.status(201).json({ success: true, message: 'Registration successful', user: newUser });
});

// ─────────────────────────────────────────────────────────────────────────────
// SHOP ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/shop/:phoneNumber
 * Returns the shop linked to the given owner phone number.
 */
app.get('/api/shop/:phoneNumber', (req: Request, res: Response) => {
  const { phoneNumber } = req.params;

  const shops = readData<Shop>('shops.json');
  const shop = shops.find((s) => s.ownerPhone === phoneNumber);

  if (!shop) {
    return res.status(404).json({ success: false, message: 'Shop not found for this phone number' });
  }

  return res.json({ success: true, shop });
});

/**
 * PATCH /api/shop/status
 * Body: { phoneNumber: string, isOpen: boolean }
 * Updates the isOpen field of the matching shop in shops.json.
 */
app.patch('/api/shop/status', (req: Request, res: Response) => {
  const { phoneNumber, isOpen } = req.body as {
    phoneNumber?: string;
    isOpen?: boolean;
  };

  if (!phoneNumber || typeof isOpen !== 'boolean') {
    return res
      .status(400)
      .json({ success: false, message: 'phoneNumber (string) and isOpen (boolean) are required' });
  }

  const shops = readData<Shop>('shops.json');
  const idx = shops.findIndex((s) => s.ownerPhone === phoneNumber);

  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'Shop not found' });
  }

  shops[idx].isOpen = isOpen;
  saveData('shops.json', shops);

  return res.json({
    success: true,
    message: `Shop is now ${isOpen ? 'Open 🟢' : 'Closed 🔴'}`,
    shop: shops[idx],
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  ShopApp backend running on http://localhost:${PORT}`);
});

export default app;
