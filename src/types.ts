export interface RawMaterial {
  id: string;
  name: string;
  unit: string;
  totalQuantity: number;
}

export interface RawMaterialBatch {
  id: string;
  materialId: string;
  batchNumber: string;
  quantity: number; // Current quantity remaining
  initialQuantity: number;
  receivedDate: string;
  expiryDate?: string;
  costPerUnit: number;
}

export interface FinishedProduct {
  id: string;
  name: string;
  unit: string;
  totalQuantity: number;
}

export interface FinishedProductBatch {
  id: string;
  productId: string;
  batchNumber: string;
  quantity: number;
  initialQuantity: number;
  productionDate: string;
  expiryDate?: string;
  materialCost?: number;   // Tổng chi phí nguyên liệu cho mẻ này
  managementFee?: number;  // Phí quản lý (20% của materialCost)
  unitCost?: number;       // Giá vốn 1 đơn vị = (materialCost + managementFee) / initialQuantity
}

export interface Recipe {
  id: string;
  name: string;
  productId: string;
  outputQuantity: number; // Standard output per batch
  ingredients: {
    materialId: string;
    quantity: number; // quantity per batch
    unit?: string; // unit used in recipe
  }[];
}

export interface Transaction {
  id: string;
  type: 'IN' | 'OUT' | 'PRODUCTION';
  category: 'RAW_MATERIAL' | 'FINISHED_PRODUCT';
  itemId: string;
  batchId: string;
  quantity: number;
  date: string;
  note?: string;
  cogs?: number;       // Giá vốn hàng bán (áp dụng cho xuất bán FP)
  revenue?: number;    // Doanh thu (áp dụng cho xuất bán FP)
  profit?: number;     // Lợi nhuận (áp dụng cho xuất bán FP)
}

export interface PagePermission {
  create?: boolean;
  read?: boolean;
  update?: boolean;
  delete?: boolean;
}

export type PermissionsMap = Record<string, PagePermission>;

export interface UserAccount {
  id: string;
  displayName: string;
  username: string;
  password: string;
  role: 'admin' | 'member';
  permissions: PermissionsMap;
}

export interface AuthUser {
  username: string;
  displayName?: string;
  email?: string;
  photoURL?: string;
  role?: 'admin' | 'member';
  permissions?: PermissionsMap;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  totalDebt: number;
}

export interface Payment {
  id: string;
  customerId: string;
  amount: number;
  date: string;
  note?: string;
}
