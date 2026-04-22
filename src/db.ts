import mongoose, { Schema, model, Document } from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// ── Mongoose Schemas & Models ──────────────────────────────────────────────────

// USER
export interface IUser extends Document {
  phoneNumber: string;
  role: 'owner' | 'customer';
  userId: string;
  isSetupComplete: boolean;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  pin?: string;
}
const userSchema = new Schema<IUser>({
  phoneNumber:     { type: String, required: true, unique: true },
  role:            { type: String, required: true, enum: ['owner', 'customer'] },
  userId:          { type: String, required: true, unique: true },
  isSetupComplete: { type: Boolean, default: false },
  name:            { type: String, default: '' },
  address:         { type: String },
  latitude:        { type: Number },
  longitude:       { type: Number },
  pin:             { type: String },
}, { timestamps: true });
export const User = model<IUser>('User', userSchema);

// SHOP
export interface IShop extends Document {
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
  latitude?: number;
  longitude?: number;
  trialStartDate: Date;
  isActive: boolean;
  hasPaid: boolean;
  paymentReference?: string;
  deliveryCharge: number;
  ratingsCount: number;
  subscriptionPaidAt?: Date;
}
const shopSchema = new Schema<IShop>({
  shopId:              { type: String, required: true, unique: true },
  ownerId:             { type: String, required: true },
  shopName:            { type: String, required: true },
  area:                { type: String, default: '' },
  category:            { type: String, default: 'General' },
  isOpen:              { type: Boolean, default: false },
  rating:              { type: Number, default: 0 },
  ownerPhone:          { type: String, required: true },
  shopAddress:         { type: String, default: '' },
  ownerSpecialization: { type: String, default: '' },
  latitude:            { type: Number },
  longitude:           { type: Number },
  trialStartDate:      { type: Date, default: Date.now },
  isActive:            { type: Boolean, default: true },
  hasPaid:             { type: Boolean, default: false },
  paymentReference:    { type: String },
  deliveryCharge:      { type: Number, default: 0 },
  ratingsCount:        { type: Number, default: 0 },
  subscriptionPaidAt:  { type: Date },
}, { timestamps: true });
// Compound index for duplicate shop detection
shopSchema.index({ shopName: 1, shopAddress: 1 });
export const Shop = model<IShop>('Shop', shopSchema);

// PRODUCT
export interface IProduct extends Document {
  productId: string;
  shopId: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  minStock: number;
  unit: string;
  imageUrl: string;
}
const productSchema = new Schema<IProduct>({
  productId: { type: String, required: true, unique: true },
  shopId:    { type: String, required: true },
  name:      { type: String, required: true },
  category:  { type: String, required: true },
  price:     { type: Number, default: 0 },
  stock:     { type: Number, default: 0 },
  minStock:  { type: Number, default: 0 },
  unit:      { type: String, default: 'pcs' },
  imageUrl:  { type: String, default: '' },
}, { timestamps: true });
export const Product = model<IProduct>('Product', productSchema);

// ORDER ITEM (embedded sub-document)
const orderItemSchema = new Schema({
  name:  { type: String, required: true },
  qty:   { type: Number, default: 1 },
  price: { type: Number, default: 0 },
}, { _id: false });

// ORDER
export interface IOrderItem {
  name: string;
  qty: number;
  price: number;
}
export interface IOrder extends Document {
  orderId: string;
  customerName: string;
  customerPhone: string;
  shopId: string;
  shopName: string;
  ownerPhone: string;
  totalAmount: number;
  status: string;
  deliveryType: string;
  deliveryAddress?: string;
  estimatedPickupTime?: string;
  wasModifiedByOwner: boolean;
  removedItemNames: string[];
  items: IOrderItem[];
  createdAt: Date;
}
const orderSchema = new Schema<IOrder>({
  orderId:             { type: String, required: true, unique: true },
  customerName:        { type: String, required: true },
  customerPhone:       { type: String, required: true },
  shopId:              { type: String, default: '' },
  shopName:            { type: String, default: '' },
  ownerPhone:          { type: String, default: '' },
  totalAmount:         { type: Number, default: 0 },
  status:              { type: String, default: 'newOrder', enum: ['newOrder', 'preparing', 'ready', 'completed'] },
  deliveryType:        { type: String, default: 'delivery', enum: ['delivery', 'pickup'] },
  deliveryAddress:     { type: String },
  estimatedPickupTime: { type: String },
  wasModifiedByOwner:  { type: Boolean, default: false },
  removedItemNames:    { type: [String], default: [] },
  items:               { type: [orderItemSchema], default: [] },
}, { timestamps: true });
export const Order = model<IOrder>('Order', orderSchema);

// SHOP RATING
export interface IShopRating extends Document {
  shopId: string;
  customerPhone: string;
  rating: number;
}
const shopRatingSchema = new Schema<IShopRating>({
  shopId:        { type: String, required: true },
  customerPhone: { type: String, required: true },
  rating:        { type: Number, required: true, min: 1, max: 5 },
}, { timestamps: true });
shopRatingSchema.index({ shopId: 1, customerPhone: 1 }, { unique: true });
export const ShopRating = model<IShopRating>('ShopRating', shopRatingSchema);

// ── Connect to MongoDB ─────────────────────────────────────────────────────────
export async function connectDb(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI environment variable is not set');
  await mongoose.connect(uri);
  console.log('🔗  Connected to MongoDB Atlas');
}

// ── Seed Data (only if collections are empty) ──────────────────────────────────
export async function seedDb(): Promise<void> {
  // Seed users
  const userCount = await User.countDocuments();
  if (userCount === 0) {
    await User.insertMany([
      { phoneNumber: '9876543210', role: 'owner',    userId: 'u_101', isSetupComplete: true, name: 'Sharma Ji',   pin: '1234' },
      { phoneNumber: '1234567890', role: 'customer', userId: 'u_102', isSetupComplete: true, name: 'Rahul Kumar', pin: '1234' },
    ]);
    console.log('📦  Seeded 2 users');
  }

  // Seed shops
  const shopCount = await Shop.countDocuments();
  if (shopCount === 0) {
    await Shop.insertMany([
      { shopId: 's_001', ownerId: 'u_101', shopName: 'Sharma Grocery',        area: 'Munger',    category: 'Grocery',     isOpen: true,  rating: 4.3, ownerPhone: '9876543210', shopAddress: '12, Station Road, Munger, Bihar',     ownerSpecialization: 'Retail',    latitude: 25.3745, longitude: 86.4735 },
      { shopId: 's_002', ownerId: 'u_103', shopName: 'RK Electronics',        area: 'Munger',    category: 'Electronics', isOpen: true,  rating: 4.1, ownerPhone: '9123456780', shopAddress: '45, Kasim Bazar, Munger, Bihar',      ownerSpecialization: 'Retail',    latitude: 25.3750, longitude: 86.4740 },
      { shopId: 's_003', ownerId: 'u_104', shopName: 'Patna Fashions',        area: 'Patna',     category: 'Ethnic Wear', isOpen: false, rating: 3.8, ownerPhone: '9001122334', shopAddress: '78, Boring Road, Patna, Bihar',       ownerSpecialization: 'Wholesale', latitude: 25.6093, longitude: 85.1376 },
      { shopId: 's_004', ownerId: 'u_105', shopName: 'Jamalpur Dairy',        area: 'Jamalpur',  category: 'Dairy',       isOpen: true,  rating: 4.5, ownerPhone: '9988776655', shopAddress: '3, Loco Colony, Jamalpur, Bihar',     ownerSpecialization: 'Retail',    latitude: 25.3133, longitude: 86.4875 },
      { shopId: 's_005', ownerId: 'u_106', shopName: 'Munger Mart',           area: 'Munger',    category: 'Grocery',     isOpen: true,  rating: 4.0, ownerPhone: '9445566778', shopAddress: '22, Gandhi Chowk, Munger, Bihar',     ownerSpecialization: 'Both',      latitude: 25.3760, longitude: 86.4730 },
      { shopId: 's_006', ownerId: 'u_107', shopName: 'Darbhanga Cloth House', area: 'Darbhanga', category: 'Fabrics',     isOpen: true,  rating: 4.2, ownerPhone: '9554433221', shopAddress: '56, Laheriasarai, Darbhanga, Bihar',  ownerSpecialization: 'Wholesale', latitude: 26.1523, longitude: 85.8915 },
      { shopId: 's_007', ownerId: 'u_108', shopName: 'Patna Electronics Hub', area: 'Patna',     category: 'Electronics', isOpen: false, rating: 3.9, ownerPhone: '9667788990', shopAddress: '90, Frazer Road, Patna, Bihar',       ownerSpecialization: 'Retail',    latitude: 25.6128, longitude: 85.1411 },
      { shopId: 's_008', ownerId: 'u_109', shopName: 'Fresh Dairy Munger',    area: 'Munger',    category: 'Dairy',       isOpen: true,  rating: 4.4, ownerPhone: '9778899001', shopAddress: '8, Civil Lines, Munger, Bihar',       ownerSpecialization: 'Retail',    latitude: 25.3770, longitude: 86.4720 },
    ]);
    console.log('📦  Seeded 8 shops');
  }

  // Seed products
  const productCount = await Product.countDocuments();
  if (productCount === 0) {
    await Product.insertMany([
      { productId: 'p_001', shopId: 's_001', name: 'Basmati Rice 5kg',    category: 'Grocery',     price: 320,  stock: 10, minStock: 5,  unit: 'bag' },
      { productId: 'p_002', shopId: 's_001', name: 'Amul Butter 500g',    category: 'Grocery',     price: 265,  stock: 0,  minStock: 5,  unit: 'pack' },
      { productId: 'p_003', shopId: 's_001', name: 'Toor Dal 1kg',        category: 'Grocery',     price: 140,  stock: 20, minStock: 5,  unit: 'kg' },
      { productId: 'p_004', shopId: 's_001', name: 'Sunflower Oil 1L',    category: 'Grocery',     price: 175,  stock: 8,  minStock: 3,  unit: 'btl' },
      { productId: 'p_005', shopId: 's_002', name: 'USB-C Cable 2m',      category: 'Electronics', price: 199,  stock: 15, minStock: 3,  unit: 'pcs' },
      { productId: 'p_006', shopId: 's_002', name: 'Phone Stand',         category: 'Electronics', price: 249,  stock: 0,  minStock: 2,  unit: 'pcs' },
      { productId: 'p_007', shopId: 's_002', name: 'Earphones',           category: 'Electronics', price: 499,  stock: 6,  minStock: 2,  unit: 'pcs' },
      { productId: 'p_008', shopId: 's_002', name: 'Power Bank 10K',      category: 'Electronics', price: 899,  stock: 4,  minStock: 2,  unit: 'pcs' },
      { productId: 'p_009', shopId: 's_003', name: 'Cotton T-Shirt',      category: 'Clothing',    price: 499,  stock: 12, minStock: 3,  unit: 'pcs' },
      { productId: 'p_010', shopId: 's_003', name: 'Formal Shirt',        category: 'Clothing',    price: 899,  stock: 0,  minStock: 2,  unit: 'pcs' },
      { productId: 'p_011', shopId: 's_003', name: 'Jeans (Slim Fit)',    category: 'Clothing',    price: 1199, stock: 7,  minStock: 2,  unit: 'pcs' },
      { productId: 'p_012', shopId: 's_004', name: 'Full Cream Milk 1L',  category: 'Dairy',       price: 62,   stock: 30, minStock: 10, unit: 'btl' },
      { productId: 'p_013', shopId: 's_004', name: 'Paneer 200g',         category: 'Dairy',       price: 90,   stock: 0,  minStock: 5,  unit: 'pack' },
      { productId: 'p_014', shopId: 's_004', name: 'Curd 400g',           category: 'Dairy',       price: 45,   stock: 20, minStock: 5,  unit: 'pack' },
      { productId: 'p_015', shopId: 's_004', name: 'Cheese Slice Pack',   category: 'Dairy',       price: 120,  stock: 8,  minStock: 3,  unit: 'pack' },
      { productId: 'p_016', shopId: 's_005', name: 'Atta 10kg',           category: 'Grocery',     price: 380,  stock: 12, minStock: 5,  unit: 'bag' },
      { productId: 'p_017', shopId: 's_005', name: 'Sugar 1kg',           category: 'Grocery',     price: 46,   stock: 25, minStock: 10, unit: 'kg' },
      { productId: 'p_018', shopId: 's_006', name: 'Kurti Set',           category: 'Clothing',    price: 699,  stock: 10, minStock: 3,  unit: 'pcs' },
      { productId: 'p_019', shopId: 's_006', name: 'Saree (Cotton)',      category: 'Clothing',    price: 1499, stock: 5,  minStock: 2,  unit: 'pcs' },
      { productId: 'p_020', shopId: 's_007', name: 'LED Bulb 9W',         category: 'Electronics', price: 89,   stock: 40, minStock: 10, unit: 'pcs' },
      { productId: 'p_021', shopId: 's_007', name: 'Extension Board 6pt', category: 'Electronics', price: 349,  stock: 8,  minStock: 3,  unit: 'pcs' },
      { productId: 'p_022', shopId: 's_008', name: 'Toned Milk 500ml',    category: 'Dairy',       price: 30,   stock: 50, minStock: 15, unit: 'btl' },
      { productId: 'p_023', shopId: 's_008', name: 'Dahi 400g',           category: 'Dairy',       price: 42,   stock: 18, minStock: 5,  unit: 'pack' },
    ]);
    console.log('📦  Seeded 23 products');
  }

  console.log('✅  Database initialised');
}

// ── Document → JSON mappers (keep same API response shape) ─────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function docToUser(doc: any) {
  return {
    phoneNumber:     doc.phoneNumber,
    role:            doc.role,
    userId:          doc.userId,
    isSetupComplete: doc.isSetupComplete,
    name:            doc.name ?? '',
    latitude:        doc.latitude  ?? undefined,
    longitude:       doc.longitude ?? undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function docToShop(doc: any) {
  return {
    shopId:              doc.shopId,
    ownerId:             doc.ownerId,
    shopName:            doc.shopName,
    area:                doc.area,
    category:            doc.category,
    isOpen:              doc.isOpen,
    rating:              doc.rating,
    ownerPhone:          doc.ownerPhone,
    shopAddress:         doc.shopAddress,
    ownerSpecialization: doc.ownerSpecialization,
    latitude:            doc.latitude  ?? null,
    longitude:           doc.longitude ?? null,
    trialStartDate:      doc.trialStartDate ?? null,
    isActive:            doc.isActive ?? true,
    hasPaid:             doc.hasPaid  ?? false,
    paymentReference:    doc.paymentReference ?? null,
    deliveryCharge:      doc.deliveryCharge ?? 0,
    ratingsCount:        doc.ratingsCount   ?? 0,
    subscriptionPaidAt:  doc.subscriptionPaidAt ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function docToProduct(doc: any) {
  return {
    productId: doc.productId,
    shopId:    doc.shopId,
    name:      doc.name,
    category:  doc.category,
    price:     doc.price,
    stock:     doc.stock,
    minStock:  doc.minStock,
    unit:      doc.unit,
    imageUrl:  doc.imageUrl ?? '',
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function docToOrder(doc: any) {
  return {
    orderId:             doc.orderId,
    customerName:        doc.customerName,
    customerPhone:       doc.customerPhone,
    shopId:              doc.shopId,
    shopName:            doc.shopName,
    ownerPhone:          doc.ownerPhone,
    totalAmount:         doc.totalAmount,
    status:              doc.status,
    deliveryType:        doc.deliveryType,
    deliveryAddress:     doc.deliveryAddress     ?? undefined,
    estimatedPickupTime: doc.estimatedPickupTime ?? undefined,
    wasModifiedByOwner:  doc.wasModifiedByOwner,
    removedItemNames:    doc.removedItemNames    ?? [],
    createdAt:           doc.createdAt,
    items: (doc.items || []).map((i: any) => ({
      name:     i.name,
      qty:      i.qty,
      price:    i.price,
      subtotal: i.qty * i.price,
    })),
  };
}
