import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, addDoc, updateDoc, doc, getDocs, query, where, orderBy, writeBatch } from 'firebase/firestore';
import { FinishedProduct, FinishedProductBatch, Customer } from '../types';
import { ShoppingCart, CheckCircle2, AlertCircle, Loader2, History, Users, X, Trash2 } from 'lucide-react';
import { cn } from '../utils';
import { format } from 'date-fns';
import { ConfirmDialog, useConfirmDialog } from './ConfirmDialog';

export const Sales: React.FC = () => {
  const [products, setProducts] = useState<FinishedProduct[]>([]);
  const [orderItems, setOrderItems] = useState<{productId: string, quantity: number, price: number}[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [quantityToSell, setQuantityToSell] = useState(1);
  const [salePricePerUnit, setSalePricePerUnit] = useState(0);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [amountPaid, setAmountPaid] = useState<number | ''>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [batches, setBatches] = useState<FinishedProductBatch[]>([]);
  const { confirm, dialogProps } = useConfirmDialog();

  useEffect(() => {
    onSnapshot(collection(db, 'finished_products'), (snap) => setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() } as FinishedProduct))));
    onSnapshot(query(collection(db, 'transactions'), where('type', '==', 'OUT'), orderBy('date', 'desc')), (snap) => {
      setTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    onSnapshot(collection(db, 'customers'), (snap) => setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Customer))));
    onSnapshot(collection(db, 'finished_product_batches'), (snap) => setBatches(snap.docs.map(d => ({ id: d.id, ...d.data() } as FinishedProductBatch))));
  }, []);

  const maxAvailable = (() => {
    if (!selectedProductId) return 0;
    const currentInCart = orderItems.filter(i => i.productId === selectedProductId).reduce((sum, i) => sum + i.quantity, 0);
    const product = products.find(p => p.id === selectedProductId);
    return product ? Math.max(0, product.totalQuantity - currentInCart) : 0;
  })();

  const getCalculatedPrices = (qty: number, prodId: string) => {
    if (!prodId || qty <= 0) return { avgCost: 0, suggestedPrice: 0, isMultiBatch: false, batchesBreakdown: [] };
    const currentInCart = orderItems.filter(i => i.productId === prodId).reduce((sum, i) => sum + i.quantity, 0);
    const productBatches = batches
      .filter(b => b.productId === prodId && b.quantity > 0)
      .sort((a, b) => new Date(a.productionDate).getTime() - new Date(b.productionDate).getTime());
      
    let remainingInCart = currentInCart;
    let currentBatchIdx = 0;
    while (currentBatchIdx < productBatches.length && remainingInCart > 0) {
      if (remainingInCart >= productBatches[currentBatchIdx].quantity) {
        remainingInCart -= productBatches[currentBatchIdx].quantity;
        currentBatchIdx++;
      } else {
        break; 
      }
    }

    let remainingToCalculate = qty;
    let totalCost = 0;
    let actualCalculatedQuantity = 0;
    const batchesBreakdown: any[] = [];
    
    let batchAvailable = productBatches[currentBatchIdx] ? productBatches[currentBatchIdx].quantity - remainingInCart : 0;

    while (remainingToCalculate > 0 && currentBatchIdx < productBatches.length) {
      const batch = productBatches[currentBatchIdx];
      const takeAmount = Math.min(batchAvailable, remainingToCalculate);
      
      if (takeAmount > 0) {
        totalCost += takeAmount * (batch.unitCost || 0);
        actualCalculatedQuantity += takeAmount;
        remainingToCalculate -= takeAmount;
        batchesBreakdown.push({ batchId: batch.id, quantity: takeAmount, unitCost: batch.unitCost || 0 });
      }
      
      currentBatchIdx++;
      if (currentBatchIdx < productBatches.length) {
        batchAvailable = productBatches[currentBatchIdx].quantity;
      }
    }

    const avgCost = actualCalculatedQuantity > 0 ? totalCost / actualCalculatedQuantity : 0;
    const suggestedPrice = Math.round((avgCost * 1.5) / 500) * 500;
    return { avgCost, suggestedPrice, isMultiBatch: batchesBreakdown.length > 1, batchesBreakdown };
  };

  const { avgCost: minCostPrice, isMultiBatch } = getCalculatedPrices(quantityToSell, selectedProductId);

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductId || quantityToSell <= 0 || salePricePerUnit < 0) return;
    
    const currentInCart = orderItems.filter(i => i.productId === selectedProductId).reduce((sum, i) => sum + i.quantity, 0);
    const product = products.find(p => p.id === selectedProductId);
    if (!product || product.totalQuantity < (currentInCart + quantityToSell)) {
       setMessage({ type: 'error', text: 'Số lượng tồn kho không đủ.' });
       return;
    }

    setOrderItems([...orderItems, {
      productId: selectedProductId,
      quantity: quantityToSell,
      price: salePricePerUnit
    }]);
    
    setSelectedProductId('');
    setQuantityToSell(1);
    setSalePricePerUnit(0);
    setMessage(null);
  };

  const handleRemoveItem = (index: number) => {
    setOrderItems(orderItems.filter((_, i) => i !== index));
  };

  const totalOrderValue = orderItems.reduce((sum, item) => sum + item.quantity * item.price, 0);

  const handleSale = async () => {
    if (orderItems.length === 0) return;

    setIsProcessing(true);
    setMessage(null);

    try {
      const actualPaid = amountPaid === '' ? totalOrderValue : Number(amountPaid);

      if (actualPaid > totalOrderValue) {
        throw new Error('Số tiền khách trả không thể lớn hơn tổng giá trị đơn hàng.');
      }

      const debtToAdd = totalOrderValue - actualPaid;

      if (debtToAdd > 0 && !selectedCustomerId) {
        throw new Error('Vui lòng chọn khách hàng cụ thể nếu muốn ghi nợ.');
      }

      const batch = writeBatch(db);
      const now = new Date().toISOString();

      if (selectedCustomerId && debtToAdd > 0) {
        const customer = customers.find(c => c.id === selectedCustomerId);
        if (customer) {
          batch.update(doc(db, 'customers', selectedCustomerId), {
            totalDebt: customer.totalDebt + debtToAdd
          });
        }
      }

      for (const item of orderItems) {
        const product = products.find(p => p.id === item.productId);
        if (!product) continue;

        // FIFO Consumption of Finished Products
        const batchesQuery = query(
          collection(db, 'finished_product_batches'),
          where('productId', '==', item.productId),
          where('quantity', '>', 0),
          orderBy('productionDate', 'asc')
        );
        const batchesSnap = await getDocs(batchesQuery);
        
        let remainingToDeduct = item.quantity;
        for (const batchDoc of batchesSnap.docs) {
          if (remainingToDeduct <= 0) break;
          
          const batchData = batchDoc.data() as FinishedProductBatch;
          const deductAmount = Math.min(batchData.quantity, remainingToDeduct);
          
          batch.update(batchDoc.ref, { quantity: batchData.quantity - deductAmount });
          remainingToDeduct -= deductAmount;

          const cogs = deductAmount * (batchData.unitCost || 0);
          const revenue = deductAmount * item.price;
          const profit = revenue - cogs;

          // Log transaction
          const transRef = doc(collection(db, 'transactions'));
          batch.set(transRef, {
            type: 'OUT',
            category: 'FINISHED_PRODUCT',
            itemId: item.productId,
            batchId: batchDoc.id,
            quantity: deductAmount,
            date: now,
            cogs,
            revenue,
            profit,
            note: `Bán hàng ${selectedCustomerId ? `cho khách hàng ${customers.find(c => c.id === selectedCustomerId)?.name}` : 'khách lẻ'}. Tổng đơn: ${totalOrderValue}, Đã thanh toán: ${actualPaid}, Ghi nợ: ${debtToAdd}`
          });
        }

        // Update total product quantity
        batch.update(doc(db, 'finished_products', item.productId), {
          totalQuantity: product.totalQuantity - item.quantity
        });
      }

      await batch.commit();
      setMessage({ type: 'success', text: 'Xuất bán thành công!' });
      setOrderItems([]);
      setAmountPaid('');
      setSelectedCustomerId('');
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClearHistory = async () => {
    const ok = await confirm({
      title: 'Xóa lịch sử xuất bán',
      message: 'Bạn có chắc chắn muốn xóa TOÀN BỘ lịch sử xuất bán? Hành động này không thể hoàn tác.',
      confirmText: 'Xóa toàn bộ',
    });
    if (!ok) return;
    
    setIsProcessing(true);
    setMessage(null);
    try {
      const BATCH_SIZE = 400;
      for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
        const chunk = transactions.slice(i, i + BATCH_SIZE);
        const currentBatch = writeBatch(db);
        chunk.forEach(trans => {
          currentBatch.delete(doc(db, 'transactions', trans.id));
        });
        await currentBatch.commit();
      }
      setMessage({ type: 'success', text: 'Đã xóa lịch sử xuất bán!' });
    } catch (error: any) {
      setMessage({ type: 'error', text: 'Lỗi khi xóa: ' + error.message });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-3xl font-serif font-bold text-slate-900">Bán hàng & Xuất kho</h2>
        <p className="text-slate-500 mt-1">Ghi nhận đơn hàng và tự động xuất kho thành phẩm theo FIFO.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm h-fit">
          <h3 className="text-xl font-serif font-bold mb-6 flex items-center gap-2">
            <ShoppingCart className="w-5 h-5" />
            Tạo đơn hàng mới
          </h3>
          <form onSubmit={handleAddItem} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Chọn sản phẩm</label>
              <select 
                className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:ring-2 focus:ring-slate-900/5"
                value={selectedProductId}
                onChange={e => {
                  const newProductId = e.target.value;
                  setSelectedProductId(newProductId);
                  if (newProductId) {
                    const initQty = 1;
                    const newPrices = getCalculatedPrices(initQty, newProductId);
                    setQuantityToSell(initQty);
                    setSalePricePerUnit(newPrices.suggestedPrice);
                  } else {
                    setQuantityToSell(1);
                    setSalePricePerUnit(0);
                  }
                }}
                required
              >
                <option value="">-- Chọn sản phẩm --</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name} (Tồn: {p.totalQuantity} {p.unit})</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Số lượng bán</label>
                <input 
                  type="number" 
                  className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:ring-2 focus:ring-slate-900/5"
                  value={quantityToSell}
                  onChange={e => {
                    let newQty = Number(e.target.value);
                    if (newQty > maxAvailable) newQty = maxAvailable;
                    if (newQty < 0) newQty = 0;
                    
                    const oldPrices = getCalculatedPrices(quantityToSell, selectedProductId);
                    setQuantityToSell(newQty);
                    
                    if (salePricePerUnit === oldPrices.suggestedPrice || salePricePerUnit === 0) {
                       const newPrices = getCalculatedPrices(newQty, selectedProductId);
                       setSalePricePerUnit(newPrices.suggestedPrice);
                    }
                  }}
                  min="1"
                  max={maxAvailable > 0 ? maxAvailable : 1}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Đơn giá / VNĐ</label>
                <input 
                  type="number" 
                  className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:ring-2 focus:ring-slate-900/5"
                  value={salePricePerUnit}
                  onChange={e => setSalePricePerUnit(Number(e.target.value))}
                  min="0"
                  required
                />
                {selectedProductId && (
                  <p className="text-[10px] text-slate-500 mt-2 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 text-amber-500" />
                    {isMultiBatch ? 'Giá vốn trung bình cộng các lô đang chọn:' : 'Giá vốn ước tính của lô hiện tại:'} <span className={cn("font-bold text-slate-700", salePricePerUnit < minCostPrice && "text-rose-600")}>{Math.round(minCostPrice).toLocaleString('vi-VN')} đ</span>
                  </p>
                )}
                {selectedProductId && salePricePerUnit < minCostPrice && (
                    <p className="text-[10px] font-bold text-rose-500 mt-0.5">Giá bán đang thấp hơn giá vốn trung bình!</p>
                )}
              </div>
            </div>

            <button 
              type="submit"
              className="w-full bg-slate-100 text-slate-900 py-3 rounded-xl font-bold hover:bg-slate-200 transition-all border border-slate-200"
            >
              + Thêm vào đơn
            </button>
          </form>

          {orderItems.length > 0 && (
            <div className="mt-8 space-y-4">
              <h4 className="font-serif font-bold text-lg border-b border-slate-100 pb-2">Các sản phẩm trong đơn</h4>
              <div className="space-y-2">
                {orderItems.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center p-3 border border-slate-100 rounded-xl bg-slate-50">
                    <div>
                      <p className="font-bold text-slate-900">{products.find(p => p.id === item.productId)?.name}</p>
                      <p className="text-sm text-slate-500">{item.quantity} x {item.price.toLocaleString('vi-VN')} đ</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <p className="font-bold text-emerald-600">{(item.quantity * item.price).toLocaleString('vi-VN')} đ</p>
                      <button onClick={() => handleRemoveItem(idx)} className="p-1 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-white">
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-4 border-t border-slate-100 space-y-4 shadow-sm bg-white rounded-2xl p-4 border block">
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-2">
                  <Users className="w-4 h-4 text-slate-400" />
                  Thông tin khách hàng & Công nợ
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Khách hàng</label>
                    <select 
                      className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:ring-2 focus:ring-slate-900/5"
                      value={selectedCustomerId}
                      onChange={e => setSelectedCustomerId(e.target.value)}
                    >
                      <option value="">Khách lẻ (Thanh toán 100%)</option>
                      {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Tổng đơn hàng</label>
                    <p className="px-4 py-3 rounded-xl border border-slate-50 bg-slate-50 font-bold text-slate-900">
                      {totalOrderValue.toLocaleString('vi-VN')} đ
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Khách thanh toán ngay</label>
                    <input 
                      type="number" 
                      className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:ring-2 focus:ring-slate-900/5"
                      value={amountPaid === '' ? totalOrderValue : amountPaid}
                      onChange={e => setAmountPaid(e.target.value === '' ? '' : Number(e.target.value))}
                      min="0"
                      max={totalOrderValue}
                      disabled={!selectedCustomerId} // If Khách lẻ, must pay 100%
                    />
                    {!selectedCustomerId && <p className="text-[10px] text-slate-400 mt-1">Khách lẻ mặc định phải thanh toán đủ</p>}
                  </div>
                </div>
              </div>

              {message && (
                <div className={cn(
                  "p-4 rounded-xl flex items-center gap-3",
                  message.type === 'success' ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-rose-50 text-rose-700 border border-rose-100"
                )}>
                  {message.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                  <p className="text-sm font-medium">{message.text}</p>
                </div>
              )}

              <button 
                onClick={handleSale}
                disabled={isProcessing || orderItems.length === 0}
                className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 flex items-center justify-center gap-2 disabled:opacity-50 mt-4"
              >
                {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShoppingCart className="w-5 h-5" />}
                Xác nhận xuất bán
              </button>
            </div>
          )}
        </div>

        <div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm flex flex-col h-[calc(100vh-10rem)] sticky top-8">
          <div className="flex items-center justify-between mb-6 shrink-0">
            <h3 className="text-xl font-serif font-bold flex items-center gap-2">
              <History className="w-5 h-5" />
              Lịch sử xuất bán
            </h3>
            {transactions.length > 0 && (
              <button 
                onClick={handleClearHistory}
                disabled={isProcessing}
                className="text-sm text-rose-600 hover:text-rose-700 font-medium px-4 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 transition-colors flex items-center gap-2 disabled:opacity-50"
                title="Xóa lịch sử xuất bán"
              >
                <Trash2 className="w-4 h-4" />
                Xóa lịch sử
              </button>
            )}
          </div>
          <div className="space-y-4 overflow-y-auto pr-2 pb-4 flex-1">
            {transactions.slice(0, 100).map((trans) => (
              <div key={trans.id} className="flex items-center justify-between p-4 border border-slate-50 rounded-xl hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-rose-50 rounded-lg">
                    <ShoppingCart className="w-4 h-4 text-rose-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">
                      {products.find(p => p.id === trans.itemId)?.name || 'Sản phẩm'}
                    </p>
                    <p className="text-xs text-slate-400">{format(new Date(trans.date), 'dd/MM/yyyy HH:mm')}</p>
                    {trans.profit !== undefined && (
                      <p className={cn("text-xs font-medium mt-1", trans.profit >= 0 ? "text-emerald-600" : "text-rose-600")}>
                        Biên Lợi Nhuận: {trans.profit >= 0 ? '+' : ''}{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(trans.profit)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-rose-600">-{trans.quantity}</p>
                  <p className="text-xs text-slate-400">{products.find(p => p.id === trans.itemId)?.unit}</p>
                </div>
              </div>
            ))}
            {transactions.length === 0 && (
              <p className="text-center text-slate-400 py-8 italic">Chưa có giao dịch bán hàng nào.</p>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog {...dialogProps} />
    </div>
  );
};

