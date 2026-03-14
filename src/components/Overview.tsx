import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, query, limit, orderBy } from 'firebase/firestore';
import { Package, Box, ShoppingCart, TrendingUp, ArrowUpRight, ArrowDownRight, AlertTriangle, CalendarDays } from 'lucide-react';
import { cn } from '../utils';
import { format, subDays, addDays } from 'date-fns';
import { RawMaterial, RawMaterialBatch, FinishedProduct, FinishedProductBatch, Transaction } from '../types';

const safeDate = (dateStr: string | undefined | null): Date | null => {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
};

const safeFormat = (dateStr: string | undefined | null, fmt: string): string => {
  const d = safeDate(dateStr);
  return d ? format(d, fmt) : '';
};

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);

export const Overview: React.FC = () => {
  const [rawMaterialValue, setRawMaterialValue] = useState(0);
  const [finishedProductValue, setFinishedProductValue] = useState(0);
  const [revenue7d, setRevenue7d] = useState(0);
  const [profit7d, setProfit7d] = useState(0);
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [alerts, setAlerts] = useState<{ id: string; type: string; title: string; desc: string; color: string; iconType: string }[]>([]);
  const [chartData, setChartData] = useState<{ date: string; revenue: number; profit: number }[]>([]);

  useEffect(() => {
    const unsubs: (() => void)[] = [];

    // 1. Raw Material Batches → Total Value
    unsubs.push(
      onSnapshot(
        collection(db, 'DT_raw_material_batches'),
        (snap) => {
          let total = 0;
          snap.docs.forEach((docSnap) => {
            const d = docSnap.data() as RawMaterialBatch;
            if (d.quantity > 0) total += d.quantity * (d.costPerUnit || 0);
          });
          setRawMaterialValue(total);
        },
        (err) => console.warn('raw_material_batches listener error:', err)
      )
    );

    // 2. Finished Product Batches → Total Value + Expiry alerts
    unsubs.push(
      onSnapshot(
        collection(db, 'DT_finished_product_batches'),
        (snap) => {
          let total = 0;
          const soonDate = addDays(new Date(), 7);
          const expAlerts: typeof alerts = [];

          snap.docs.forEach((docSnap) => {
            const d = docSnap.data() as FinishedProductBatch;
            if (d.quantity > 0) {
              total += d.quantity * (d.unitCost || 0);
              // Check expiry
              const exp = safeDate(d.expiryDate);
              if (exp && exp < soonDate) {
                expAlerts.push({
                  id: 'fpexp_' + docSnap.id,
                  type: 'expiry',
                  title: `Lô ${d.batchNumber || docSnap.id} (Sắp hết hạn)`,
                  desc: `HSD: ${safeFormat(d.expiryDate, 'dd/MM/yyyy')} • Tồn: ${d.quantity}`,
                  color: 'rose',
                  iconType: 'alert',
                });
              }
            }
          });
          setFinishedProductValue(total);
          setAlerts((prev) => [...prev.filter((a) => !a.id.startsWith('fpexp_')), ...expAlerts]);
        },
        (err) => console.warn('finished_product_batches listener error:', err)
      )
    );

    // 3. Transactions → Recent activity + chart + 7d revenue/profit
    unsubs.push(
      onSnapshot(
        query(collection(db, 'DT_transactions'), orderBy('date', 'desc'), limit(50)),
        (snap) => {
          const trans = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as Transaction));
          setRecentTransactions(trans.slice(0, 5));

          const sevenDaysAgo = subDays(new Date(), 7);
          let rev = 0;
          let prof = 0;
          const sales7d: Transaction[] = [];

          trans.forEach((t) => {
            if (t.type !== 'OUT') return;
            const d = safeDate(t.date);
            if (d && d > sevenDaysAgo) {
              rev += t.revenue || 0;
              prof += t.profit || 0;
              sales7d.push(t);
            }
          });
          setRevenue7d(rev);
          setProfit7d(prof);

          // Chart data grouped by day
          const dataMap: Record<string, { revenue: number; profit: number }> = {};
          for (let i = 6; i >= 0; i--) {
            dataMap[format(subDays(new Date(), i), 'dd/MM')] = { revenue: 0, profit: 0 };
          }
          sales7d.forEach((t) => {
            const key = safeFormat(t.date, 'dd/MM');
            if (key && dataMap[key]) {
              dataMap[key].revenue += t.revenue || 0;
              dataMap[key].profit += t.profit || 0;
            }
          });
          setChartData(Object.entries(dataMap).map(([date, vals]) => ({ date, ...vals })));
        },
        (err) => console.warn('transactions listener error:', err)
      )
    );

    // 4. Raw Materials → Low stock alerts
    unsubs.push(
      onSnapshot(
        collection(db, 'DT_raw_materials'),
        (snap) => {
          const rmAlerts = snap.docs
            .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as RawMaterial))
            .filter((rm) => rm.totalQuantity < 20)
            .map((rm) => ({
              id: 'rm_' + rm.id,
              type: 'low_stock',
              title: `${rm.name} (Sắp hết)`,
              desc: `Còn lại: ${rm.totalQuantity} ${rm.unit}`,
              color: 'rose',
              iconType: 'package',
            }));
          setAlerts((prev) => [...prev.filter((a) => !a.id.startsWith('rm_')), ...rmAlerts]);
        },
        (err) => console.warn('raw_materials listener error:', err)
      )
    );

    // 5. Finished Products → Low stock alerts
    unsubs.push(
      onSnapshot(
        collection(db, 'DT_finished_products'),
        (snap) => {
          const fpAlerts = snap.docs
            .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as FinishedProduct))
            .filter((fp) => fp.totalQuantity < 10)
            .map((fp) => ({
              id: 'fp_' + fp.id,
              type: 'low_stock',
              title: `${fp.name} (Sắp hết)`,
              desc: `Còn lại: ${fp.totalQuantity} ${fp.unit}`,
              color: 'amber',
              iconType: 'box',
            }));
          setAlerts((prev) => [...prev.filter((a) => !a.id.startsWith('fp_')), ...fpAlerts]);
        },
        (err) => console.warn('finished_products listener error:', err)
      )
    );

    return () => unsubs.forEach((fn) => fn());
  }, []);

  const AlertIcon = ({ type }: { type: string }) => {
    if (type === 'package') return <Package className="w-5 h-5 text-rose-600" />;
    if (type === 'box') return <Box className="w-5 h-5 text-amber-600" />;
    return <AlertTriangle className="w-5 h-5 text-rose-600" />;
  };

  const StatCard = ({ title, value, icon: Icon, trend, color, trendLabel }: any) => (
    <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className={cn('p-3 rounded-xl', color)}>
          <Icon className="w-6 h-6 text-white" />
        </div>
        {trend !== undefined && (
          <div className="flex flex-col items-end">
            <div className={cn('flex items-center gap-1 text-sm font-bold', trend >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
              {trend >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
              {formatCurrency(Math.abs(trend))}
            </div>
            {trendLabel && <span className="text-[10px] text-slate-400 font-medium">{trendLabel}</span>}
          </div>
        )}
      </div>
      <h3 className="text-slate-500 text-sm font-medium mb-1">{title}</h3>
      <p className="text-2xl lg:text-3xl font-bold text-slate-900 truncate" title={value}>
        {value}
      </p>
    </div>
  );

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-3xl font-serif font-bold text-slate-900">Tổng quan hệ thống</h2>
        <p className="text-slate-500 mt-1">Quản lý hiệu quả dòng tiền và tồn kho của bạn.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Tổng GT Nguyên Liệu" value={formatCurrency(rawMaterialValue)} icon={Package} color="bg-blue-600" />
        <StatCard title="Tổng GT Thành Phẩm" value={formatCurrency(finishedProductValue)} icon={Box} color="bg-purple-600" />
        <StatCard title="Doanh Thu (7 ngày)" value={formatCurrency(revenue7d)} icon={ShoppingCart} color="bg-orange-600" trend={revenue7d} trendLabel="Doanh thu" />
        <StatCard title="Lợi Nhuận (7 ngày)" value={formatCurrency(profit7d)} icon={TrendingUp} color="bg-emerald-600" trend={profit7d} trendLabel="Lợi nhuận" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Biểu đồ */}
        <div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm col-span-1 lg:col-span-2">
          <h3 className="text-xl font-serif font-bold mb-6 flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-slate-400" />
            Biểu đồ Bán Hàng &amp; Lợi Nhuận (7 ngày)
          </h3>
          <div className="h-64 flex items-end gap-4 mt-8 pb-6 border-b border-slate-100 relative max-w-full overflow-x-auto">
            {chartData.length === 0 && (
              <p className="text-slate-400 italic absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">Chưa có dữ liệu giao dịch.</p>
            )}
            {chartData.map((data, idx) => {
              const maxVal = Math.max(...chartData.map((d) => Math.max(d.revenue, d.profit, 1)));
              const revHeight = `${(data.revenue / maxVal) * 100}%`;
              const profHeight = `${(data.profit / maxVal) * 100}%`;
              return (
                <div key={idx} className="flex-1 flex flex-col items-center justify-end h-full group min-w-[50px]">
                  <div className="w-full flex justify-center gap-1 h-full items-end">
                    <div
                      className="w-1/3 bg-orange-400 rounded-t-sm transition-all hover:bg-orange-500"
                      style={{ height: revHeight, minHeight: data.revenue > 0 ? '4px' : '0' }}
                      title={`Doanh thu: ${formatCurrency(data.revenue)}`}
                    />
                    <div
                      className="w-1/3 bg-emerald-400 rounded-t-sm transition-all hover:bg-emerald-500"
                      style={{ height: profHeight, minHeight: data.profit > 0 ? '4px' : '0' }}
                      title={`Lợi nhuận: ${formatCurrency(data.profit)}`}
                    />
                  </div>
                  <div className="mt-4 text-xs font-medium text-slate-400 text-center w-full">{data.date}</div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-center gap-6 mt-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-orange-400 rounded-sm" />
              <span className="text-sm text-slate-600 font-medium">Doanh thu</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-emerald-400 rounded-sm" />
              <span className="text-sm text-slate-600 font-medium">Lợi nhuận gộp</span>
            </div>
          </div>
        </div>

        {/* Cảnh báo */}
        <div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm flex flex-col max-h-[400px]">
          <h3 className="text-xl font-serif font-bold mb-6 flex items-center gap-2 shrink-0">
            <AlertTriangle className="w-5 h-5 text-rose-500" />
            Cảnh báo cần xử lý
          </h3>
          <div className="space-y-4 overflow-y-auto pr-2 flex-1">
            {alerts.length === 0 && <p className="text-slate-400 text-sm italic text-center py-4">Hệ thống đang hoạt động ổn định.</p>}
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={cn(
                  'p-4 border rounded-xl flex items-center gap-3',
                  alert.color === 'rose' ? 'bg-rose-50 border-rose-100' : 'bg-amber-50 border-amber-100'
                )}
              >
                <AlertIcon type={alert.iconType} />
                <div>
                  <p className={cn('text-sm font-bold', alert.color === 'rose' ? 'text-rose-900' : 'text-amber-900')}>{alert.title}</p>
                  <p className={cn('text-xs mt-0.5', alert.color === 'rose' ? 'text-rose-700' : 'text-amber-700')}>{alert.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Hoạt động gần đây */}
        <div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm lg:col-span-3">
          <h3 className="text-xl font-serif font-bold mb-6">Hoạt động hệ thống gần đây</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {recentTransactions.length === 0 && <p className="text-slate-400 italic">Chưa có giao dịch nào gần đây.</p>}
            {recentTransactions.map((t) => (
              <div key={t.id} className="p-4 rounded-xl border border-slate-100 bg-slate-50 flex items-start gap-4 hover:bg-slate-100 transition-colors">
                <div className="mt-1">
                  {t.type === 'IN' && <Package className="w-5 h-5 text-blue-500" />}
                  {t.type === 'OUT' && <ShoppingCart className="w-5 h-5 text-emerald-500" />}
                  {t.type === 'PRODUCTION' && <Box className="w-5 h-5 text-purple-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-900 truncate">
                    {t.type === 'IN' ? 'Nhập kho' : t.type === 'OUT' ? 'Xuất bán' : 'Sản xuất'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2">{t.note || `Số lượng: ${t.quantity}`}</p>
                  <p className="text-[10px] font-bold text-slate-400 mt-2">{safeFormat(t.date, 'dd/MM/yyyy HH:mm')}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
