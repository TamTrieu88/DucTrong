import React, { useState, useEffect } from 'react';
import { 
  collection, 
  onSnapshot, 
  query, 
  limit, 
  orderBy 
} from 'firebase/firestore';
import { db } from '../firebase';
import { 
  TrendingUp, 
  Package, 
  Box, 
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';
import { format } from 'date-fns';
import { RawMaterial, FinishedProduct, Sale } from '../types';

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalSales: 0,
    lowStockMaterials: 0,
    totalProducts: 0,
    recentSales: [] as Sale[]
  });
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [products, setProducts] = useState<FinishedProduct[]>([]);

  useEffect(() => {
    const unsubMaterials = onSnapshot(collection(db, 'DT_raw_materials'), (snap) => {
      const mats = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as RawMaterial));
      setMaterials(mats);
      setStats(prev => ({
        ...prev,
        lowStockMaterials: mats.filter(m => m.currentStock < 10).length
      }));
    });

    const unsubProducts = onSnapshot(collection(db, 'DT_finished_products'), (snap) => {
      const prods = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FinishedProduct));
      setProducts(prods);
      setStats(prev => ({
        ...prev,
        totalProducts: prods.length
      }));
    });

    const salesQuery = query(collection(db, 'sales'), orderBy('date', 'desc'), limit(5));
    const unsubSales = onSnapshot(salesQuery, (snap) => {
      const sales = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Sale));
      const total = sales.reduce((acc, s) => acc + s.totalAmount, 0);
      setStats(prev => ({
        ...prev,
        totalSales: total,
        recentSales: sales
      }));
    });

    return () => {
      unsubMaterials();
      unsubProducts();
      unsubSales();
    };
  }, []);

  const statCards = [
    { 
      label: 'Doanh thu (Gần đây)', 
      value: stats.totalSales.toLocaleString('vi-VN') + ' đ', 
      icon: TrendingUp, 
      color: 'text-emerald-600', 
      bg: 'bg-emerald-50' 
    },
    { 
      label: 'Nguyên liệu sắp hết', 
      value: stats.lowStockMaterials, 
      icon: AlertTriangle, 
      color: 'text-amber-600', 
      bg: 'bg-amber-50' 
    },
    { 
      label: 'Sản phẩm thành phẩm', 
      value: stats.totalProducts, 
      icon: Package, 
      color: 'text-blue-600', 
      bg: 'bg-blue-50' 
    },
    { 
      label: 'Tổng nguyên liệu', 
      value: materials.length, 
      icon: Box, 
      color: 'text-purple-600', 
      bg: 'bg-purple-50' 
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-serif text-stone-900">Tổng quan hệ thống</h2>
        <p className="text-stone-500">Chào mừng trở lại, đây là tình hình sản xuất hôm nay.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((stat, i) => (
          <div key={i} className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-4">
              <div className={`p-3 rounded-xl ${stat.bg} ${stat.color}`}>
                <stat.icon size={24} />
              </div>
              <span className="text-xs font-medium text-stone-400 uppercase tracking-wider">Hôm nay</span>
            </div>
            <p className="text-sm font-medium text-stone-500 mb-1">{stat.label}</p>
            <h3 className="text-2xl font-bold text-stone-900">{stat.value}</h3>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Sales */}
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-stone-100 flex items-center justify-between">
            <h3 className="text-lg font-serif text-stone-900">Đơn hàng gần đây</h3>
            <button className="text-sm text-stone-500 hover:text-stone-900 font-medium">Xem tất cả</button>
          </div>
          <div className="divide-y divide-stone-100">
            {stats.recentSales.length > 0 ? (
              stats.recentSales.map((sale) => (
                <div key={sale.id} className="p-4 flex items-center justify-between hover:bg-stone-50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center text-stone-500">
                      <ShoppingCart size={20} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-stone-900">{sale.customerName || 'Khách lẻ'}</p>
                      <p className="text-xs text-stone-500">{format(new Date(sale.date), 'dd/MM/yyyy HH:mm')}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-stone-900">{sale.totalAmount.toLocaleString('vi-VN')} đ</p>
                    <p className="text-xs text-emerald-600 font-medium flex items-center justify-end gap-1">
                      Thành công <ArrowUpRight size={12} />
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-stone-400">Chưa có đơn hàng nào</div>
            )}
          </div>
        </div>

        {/* Low Stock Alert */}
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-stone-100 flex items-center justify-between">
            <h3 className="text-lg font-serif text-stone-900">Cảnh báo tồn kho</h3>
            <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs font-bold rounded-md">Cần nhập hàng</span>
          </div>
          <div className="divide-y divide-stone-100">
            {materials.filter(m => m.currentStock < 10).length > 0 ? (
              materials.filter(m => m.currentStock < 10).map((mat) => (
                <div key={mat.id} className="p-4 flex items-center justify-between hover:bg-stone-50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600">
                      <Box size={20} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-stone-900">{mat.name}</p>
                      <p className="text-xs text-stone-500">Đơn vị: {mat.unit}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-amber-600">{mat.currentStock} {mat.unit}</p>
                    <p className="text-xs text-stone-400">Tồn kho thấp</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-stone-400">Mọi thứ đều ổn</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

import { ShoppingCart } from 'lucide-react';
