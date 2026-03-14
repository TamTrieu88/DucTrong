import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, addDoc, updateDoc, doc, deleteDoc, query, where, getDocs, orderBy, writeBatch } from 'firebase/firestore';
import { FinishedProduct, FinishedProductBatch } from '../types';
import { Plus, Box, Info, Edit2, Trash2, ArrowUpRight, Loader2, CheckCircle2, AlertCircle, History, X } from 'lucide-react';
import { cn } from '../utils';
import { format } from 'date-fns';
import { ConfirmDialog, useConfirmDialog } from './ConfirmDialog';

export const FinishedProducts: React.FC = () => {
  const [products, setProducts] = useState<FinishedProduct[]>([]);
  const [batches, setBatches] = useState<FinishedProductBatch[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<FinishedProduct | null>(null);
  const [selectedProductBatches, setSelectedProductBatches] = useState<FinishedProduct | null>(null);
  const [editingBatch, setEditingBatch] = useState<FinishedProductBatch | null>(null);
  const [newProduct, setNewProduct] = useState({ name: '', unit: '' });
  const [exportData, setExportData] = useState({ productId: '', quantity: 0, note: '' });
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const { confirm, dialogProps } = useConfirmDialog();

  useEffect(() => {
    const unsubProd = onSnapshot(collection(db, 'DT_finished_products'), (snap) => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() } as FinishedProduct)));
    });
    const unsubBatch = onSnapshot(collection(db, 'DT_finished_product_batches'), (snap) => {
      setBatches(snap.docs.map(d => ({ id: d.id, ...d.data() } as FinishedProductBatch)));
    });
    return () => {
      unsubProd();
      unsubBatch();
    };
  }, []);

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingProduct) {
      const prodRef = doc(db, 'DT_finished_products', editingProduct.id);
      await updateDoc(prodRef, { name: newProduct.name, unit: newProduct.unit });
      setEditingProduct(null);
    } else {
      await addDoc(collection(db, 'DT_finished_products'), { ...newProduct, totalQuantity: 0 });
    }
    setNewProduct({ name: '', unit: '' });
  };

  const handleDeleteProduct = async (id: string) => {
    const ok = await confirm({
      title: 'Xóa sản phẩm',
      message: 'Bạn có chắc chắn muốn xóa sản phẩm này? Tất cả các lô hàng liên quan cũng sẽ bị xóa.',
      confirmText: 'Xóa',
    });
    if (ok) {
      await deleteDoc(doc(db, 'DT_finished_products', id));
      
      // Delete associated batches
      const batchesQuery = query(collection(db, 'DT_finished_product_batches'), where('productId', '==', id));
      const batchesSnap = await getDocs(batchesQuery);
      const batch = writeBatch(db);
      batchesSnap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
  };

  const handleDeleteBatch = async (batch: FinishedProductBatch) => {
    const ok = await confirm({
      title: 'Xóa lô hàng',
      message: 'Bạn có chắc chắn muốn xóa lô hàng này? Tồn kho tổng sẽ bị giảm tương ứng.',
      confirmText: 'Xóa',
    });
    if (ok) {
      await deleteDoc(doc(db, 'DT_finished_product_batches', batch.id));
      
      const prod = products.find(p => p.id === batch.productId);
      if (prod) {
        const prodRef = doc(db, 'DT_finished_products', prod.id);
        await updateDoc(prodRef, { totalQuantity: prod.totalQuantity - batch.quantity });
      }
    }
  };

  const handleExportBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!exportData.productId || exportData.quantity <= 0) return;

    setIsProcessing(true);
    setMessage(null);

    try {
      const product = products.find(p => p.id === exportData.productId);
      if (!product || product.totalQuantity < exportData.quantity) {
        throw new Error('Số lượng tồn kho không đủ.');
      }

      const batch = writeBatch(db);
      const now = new Date().toISOString();

      // FIFO Consumption
      const batchesQuery = query(
        collection(db, 'DT_finished_product_batches'),
        where('productId', '==', exportData.productId),
        where('quantity', '>', 0),
        orderBy('productionDate', 'asc')
      );
      const batchesSnap = await getDocs(batchesQuery);
      
      let remainingToDeduct = exportData.quantity;
      for (const batchDoc of batchesSnap.docs) {
        if (remainingToDeduct <= 0) break;
        
        const batchData = batchDoc.data() as FinishedProductBatch;
        const deductAmount = Math.min(batchData.quantity, remainingToDeduct);
        
        batch.update(batchDoc.ref, { quantity: batchData.quantity - deductAmount });
        remainingToDeduct -= deductAmount;

        // Log transaction
        const transRef = doc(collection(db, 'DT_transactions'));
        batch.set(transRef, {
          type: 'OUT',
          category: 'FINISHED_PRODUCT',
          itemId: exportData.productId,
          batchId: batchDoc.id,
          quantity: deductAmount,
          date: now,
          note: exportData.note || 'Xuất kho thủ công'
        });
      }

      // Update total product quantity
      batch.update(doc(db, 'DT_finished_products', exportData.productId), {
        totalQuantity: product.totalQuantity - exportData.quantity
      });

      await batch.commit();
      setMessage({ type: 'success', text: 'Xuất kho thành công!' });
      setExportData({ productId: '', quantity: 0, note: '' });
      setTimeout(() => setShowExportModal(false), 1500);
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-serif font-bold text-slate-900">Kho thành phẩm</h2>
          <p className="text-slate-500 mt-1">Quản lý sản phẩm đã đóng gói và sẵn sàng xuất bán.</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => setShowExportModal(true)}
            className="flex items-center gap-2 bg-white text-slate-900 border border-slate-200 px-6 py-3 rounded-xl hover:bg-slate-50 transition-all font-medium"
          >
            <ArrowUpRight className="w-5 h-5" />
            Xuất kho
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-50 flex items-center justify-between">
              <h3 className="font-serif font-bold text-lg">Danh mục sản phẩm</h3>
              <div className="flex items-center gap-2 text-xs text-slate-400 font-medium uppercase tracking-wider">
                <Info className="w-4 h-4" />
                Tổng cộng {products.length} loại
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50">
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Tên sản phẩm</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Đơn vị</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Tồn kho</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Tổng giá trị vốn</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {products.map((prod) => (
                    <tr key={prod.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 font-medium text-slate-900">{prod.name}</td>
                      <td className="px-6 py-4 text-slate-500">{prod.unit}</td>
                      <td className="px-6 py-4 text-right font-bold text-slate-900">{prod.totalQuantity}</td>
                      <td className="px-6 py-4 text-right font-bold text-emerald-600">
                        {batches.filter(b => b.productId === prod.id).reduce((sum, b) => sum + (b.quantity * (b.unitCost || 0)), 0).toLocaleString('vi-VN')} đ
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button 
                            onClick={() => setSelectedProductBatches(prod)}
                            className="p-2 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                            title="Xem lô hiện có"
                          >
                            <History className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => {
                              setEditingProduct(prod);
                              setNewProduct({ name: prod.name || '', unit: prod.unit || '' });
                            }}
                            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleDeleteProduct(prod.id)}
                            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm">
            <h3 className="font-serif font-bold text-lg mb-6">
              {editingProduct ? 'Sửa sản phẩm' : 'Thêm sản phẩm mới'}
            </h3>
            <form onSubmit={handleAddProduct} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Tên sản phẩm</label>
                <input 
                  type="text" 
                  value={newProduct.name}
                  onChange={e => setNewProduct({...newProduct, name: e.target.value})}
                  className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/5 transition-all"
                  placeholder="VD: Muối tôm loại 1"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Đơn vị tính</label>
                <input 
                  type="text" 
                  value={newProduct.unit}
                  onChange={e => setNewProduct({...newProduct, unit: e.target.value})}
                  className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/5 transition-all"
                  placeholder="VD: hũ 500g"
                  required
                />
              </div>
              <div className="flex gap-2">
                {editingProduct && (
                  <button 
                    type="button"
                    onClick={() => {
                      setEditingProduct(null);
                      setNewProduct({ name: '', unit: '' });
                    }}
                    className="flex-1 bg-slate-50 text-slate-500 py-3 rounded-xl font-bold hover:bg-slate-100 transition-colors"
                  >
                    Hủy
                  </button>
                )}
                <button className="flex-[2] bg-slate-100 text-slate-900 py-3 rounded-xl font-bold hover:bg-slate-200 transition-colors">
                  {editingProduct ? 'Cập nhật' : 'Thêm vào danh mục'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {showExportModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-8">
            <h3 className="text-2xl font-serif font-bold mb-6">Xuất kho thành phẩm</h3>
            <form onSubmit={handleExportBatch} className="space-y-6">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Chọn sản phẩm</label>
                <select 
                  className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
                  value={exportData.productId}
                  onChange={e => setExportData({...exportData, productId: e.target.value})}
                  required
                >
                  <option value="">-- Chọn --</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} (Tồn: {p.totalQuantity} {p.unit})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Số lượng xuất</label>
                <input 
                  type="number" 
                  className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
                  value={exportData.quantity}
                  onChange={e => setExportData({...exportData, quantity: Number(e.target.value)})}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Ghi chú</label>
                <input 
                  type="text" 
                  className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
                  value={exportData.note}
                  onChange={e => setExportData({...exportData, note: e.target.value})}
                  placeholder="Lý do xuất kho..."
                />
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

              <div className="flex gap-3 pt-4">
                <button 
                  type="button"
                  onClick={() => setShowExportModal(false)}
                  className="flex-1 px-6 py-3 rounded-xl border border-slate-100 font-bold text-slate-500 hover:bg-slate-50"
                  disabled={isProcessing}
                >
                  Hủy
                </button>
                <button 
                  type="submit"
                  className="flex-1 px-6 py-3 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 shadow-lg shadow-slate-200 flex items-center justify-center gap-2"
                  disabled={isProcessing}
                >
                  {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowUpRight className="w-5 h-5" />}
                  Xác nhận xuất
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedProductBatches && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl p-8 max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-2xl font-serif font-bold text-slate-900">Chi tiết lô: {selectedProductBatches.name}</h3>
                <p className="text-slate-500 mt-1">Đơn vị tính: {selectedProductBatches.unit}</p>
              </div>
              <button onClick={() => setSelectedProductBatches(null)} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="overflow-y-auto flex-1 pr-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {batches.filter(b => b.productId === selectedProductBatches.id && b.quantity > 0).sort((a, b) => new Date(a.productionDate).getTime() - new Date(b.productionDate).getTime()).map(batch => (
                  <div key={batch.id} className="p-4 border border-slate-100 rounded-xl bg-slate-50/30 group relative flex flex-col">
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => handleDeleteBatch(batch)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-white rounded-md shadow-sm transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-tighter">Lô: {batch.batchNumber}</span>
                    </div>
                    <div className="flex items-end justify-between flex-1">
                      <div>
                        <p className="text-2xl font-bold text-slate-900">{batch.quantity} <span className="text-sm font-normal text-slate-500">{products.find(p => p.id === batch.productId)?.unit}</span></p>
                        <p className="text-xs text-slate-400 mt-1">Sản xuất: {format(new Date(batch.productionDate), 'dd/MM/yyyy')}</p>
                      </div>
                    </div>
                    <div className="pt-3 mt-3 border-t border-slate-100 flex justify-between items-center -mx-4 -mb-4 px-4 py-3 rounded-b-xl bg-white/50">
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Giá vốn / đv</p>
                        <p className="text-sm font-semibold text-slate-700">{(batch.unitCost || 0).toLocaleString('vi-VN')} đ</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5" title="Giá vốn x 1.5 làm tròn 500đ">Giá bán lẻ đề xuất</p>
                        <p className="text-sm font-bold text-purple-600">{Math.round(((batch.unitCost || 0) * 1.5) / 500) * 500 > 0 ? (Math.round(((batch.unitCost || 0) * 1.5) / 500) * 500).toLocaleString('vi-VN') + ' đ' : '---' }</p>
                      </div>
                    </div>
                  </div>
                ))}
                {batches.filter(b => b.productId === selectedProductBatches.id && b.quantity > 0).length === 0 && (
                  <p className="text-slate-500 col-span-full py-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">Không có lô hàng nào còn tồn kho.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog {...dialogProps} />
    </div>
  );
};

