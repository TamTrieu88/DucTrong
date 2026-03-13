import React, { useState, useEffect } from 'react';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  increment
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Plus, Search, Package, History, Calendar, AlertTriangle, ChevronDown, ChevronUp, X } from 'lucide-react';
import { format } from 'date-fns';
import { FinishedProduct, FinishedProductLot } from '../types';

export default function FinishedProducts() {
  const [products, setProducts] = useState<FinishedProduct[]>([]);
  const [lots, setLots] = useState<FinishedProductLot[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isLotModalOpen, setIsLotModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<FinishedProduct | null>(null);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);

  // Form states
  const [newProduct, setNewProduct] = useState({ name: '', unit: '', price: 0 });
  const [newLot, setNewLot] = useState({ batchNumber: '', quantity: 0, productionDate: format(new Date(), "yyyy-MM-dd'T'HH:mm"), expiryDate: '' });

  useEffect(() => {
    const unsubProducts = onSnapshot(collection(db, 'finished_products'), (snap) => {
      setProducts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FinishedProduct)));
    });

    const unsubLots = onSnapshot(collection(db, 'finished_product_lots'), (snap) => {
      setLots(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FinishedProductLot)));
    });

    return () => {
      unsubProducts();
      unsubLots();
    };
  }, []);

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'finished_products'), {
        ...newProduct,
        currentStock: 0
      });
      setNewProduct({ name: '', unit: '', price: 0 });
      setIsAddModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'finished_products');
    }
  };

  const handleAddLot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) return;

    try {
      const lotData = {
        productId: selectedProduct.id,
        batchNumber: newLot.batchNumber || `PROD-${Date.now()}`,
        quantity: Number(newLot.quantity),
        remainingQuantity: Number(newLot.quantity),
        productionDate: newLot.productionDate,
        expiryDate: newLot.expiryDate || null
      };

      await addDoc(collection(db, 'finished_product_lots'), lotData);
      
      // Update product stock
      await updateDoc(doc(db, 'finished_products', selectedProduct.id), {
        currentStock: increment(Number(newLot.quantity))
      });

      setNewLot({ batchNumber: '', quantity: 0, productionDate: format(new Date(), "yyyy-MM-dd'T'HH:mm"), expiryDate: '' });
      setIsLotModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'finished_product_lots');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-serif text-stone-900">Kho thành phẩm</h2>
          <p className="text-stone-500">Quản lý sản phẩm đã đóng gói và sẵn sàng bán.</p>
        </div>
        <button 
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-stone-900 text-white rounded-xl hover:bg-stone-800 transition-colors"
        >
          <Plus size={18} />
          Thêm sản phẩm
        </button>
      </div>

      {/* Products Table */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-stone-100 bg-stone-50/50 flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
            <input 
              type="text" 
              placeholder="Tìm kiếm sản phẩm..." 
              className="w-full pl-10 pr-4 py-2 bg-white border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/10"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-xs font-bold text-stone-400 uppercase tracking-wider border-b border-stone-100">
                <th className="px-6 py-4">Tên sản phẩm</th>
                <th className="px-6 py-4">Giá bán</th>
                <th className="px-6 py-4">Tồn kho hiện tại</th>
                <th className="px-6 py-4 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {products.map((prod) => (
                <React.Fragment key={prod.id}>
                  <tr className="hover:bg-stone-50/50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded bg-stone-100 flex items-center justify-center text-stone-500">
                          <Package size={16} />
                        </div>
                        <div>
                          <p className="font-medium text-stone-900">{prod.name}</p>
                          <p className="text-xs text-stone-400">Đơn vị: {prod.unit}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-stone-900 font-medium">
                      {prod.price.toLocaleString('vi-VN')} đ
                    </td>
                    <td className="px-6 py-4">
                      <span className={`font-bold ${prod.currentStock < 20 ? 'text-amber-600' : 'text-stone-900'}`}>
                        {prod.currentStock}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => {
                            setSelectedProduct(prod);
                            setIsLotModalOpen(true);
                          }}
                          className="p-2 text-stone-500 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-all"
                          title="Nhập lô sản xuất"
                        >
                          <Plus size={18} />
                        </button>
                        <button 
                          onClick={() => setExpandedProduct(expandedProduct === prod.id ? null : prod.id)}
                          className="p-2 text-stone-500 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-all"
                          title="Xem lịch sử lô"
                        >
                          {expandedProduct === prod.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedProduct === prod.id && (
                    <tr>
                      <td colSpan={4} className="px-6 py-4 bg-stone-50/50">
                        <div className="space-y-3">
                          <h4 className="text-xs font-bold text-stone-400 uppercase tracking-widest flex items-center gap-2">
                            <History size={14} /> Danh sách lô thành phẩm (FIFO)
                          </h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {lots.filter(l => l.productId === prod.id && l.remainingQuantity > 0).length > 0 ? (
                              lots
                                .filter(l => l.productId === prod.id && l.remainingQuantity > 0)
                                .sort((a, b) => new Date(a.productionDate).getTime() - new Date(b.productionDate).getTime())
                                .map(lot => (
                                  <div key={lot.id} className="bg-white p-3 rounded-xl border border-stone-200 shadow-sm">
                                    <div className="flex justify-between items-start mb-2">
                                      <span className="text-xs font-mono font-bold text-stone-400">{lot.batchNumber}</span>
                                      <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-bold">
                                        Còn: {lot.remainingQuantity}
                                      </span>
                                    </div>
                                    <div className="space-y-1">
                                      <p className="text-xs text-stone-500 flex items-center gap-1">
                                        <Calendar size={12} /> Sản xuất: {format(new Date(lot.productionDate), 'dd/MM/yyyy')}
                                      </p>
                                      {lot.expiryDate && (
                                        <p className="text-xs text-stone-500 flex items-center gap-1">
                                          <AlertTriangle size={12} className="text-amber-500" /> Hạn: {format(new Date(lot.expiryDate), 'dd/MM/yyyy')}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                ))
                            ) : (
                              <p className="text-sm text-stone-400 italic">Không có hàng trong kho.</p>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Product Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-stone-100 flex items-center justify-between">
              <h3 className="text-xl font-serif text-stone-900">Thêm sản phẩm mới</h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-stone-400 hover:text-stone-900">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleAddProduct} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Tên sản phẩm</label>
                <input 
                  required
                  type="text" 
                  value={newProduct.name}
                  onChange={e => setNewProduct({...newProduct, name: e.target.value})}
                  className="w-full px-4 py-2 border border-stone-200 rounded-lg focus:ring-2 focus:ring-stone-900/10 focus:outline-none"
                  placeholder="Ví dụ: Muối tôm loại 1, Muối chay..."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Đơn vị tính</label>
                  <input 
                    required
                    type="text" 
                    value={newProduct.unit}
                    onChange={e => setNewProduct({...newProduct, unit: e.target.value})}
                    className="w-full px-4 py-2 border border-stone-200 rounded-lg focus:ring-2 focus:ring-stone-900/10 focus:outline-none"
                    placeholder="hũ, túi..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Giá bán (đ)</label>
                  <input 
                    required
                    type="number" 
                    value={newProduct.price}
                    onChange={e => setNewProduct({...newProduct, price: Number(e.target.value)})}
                    className="w-full px-4 py-2 border border-stone-200 rounded-lg focus:ring-2 focus:ring-stone-900/10 focus:outline-none"
                  />
                </div>
              </div>
              <div className="pt-4 flex gap-3">
                <button 
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="flex-1 px-4 py-2 border border-stone-200 text-stone-600 rounded-lg hover:bg-stone-50 transition-colors"
                >
                  Hủy
                </button>
                <button 
                  type="submit"
                  className="flex-1 px-4 py-2 bg-stone-900 text-white rounded-lg hover:bg-stone-800 transition-colors"
                >
                  Lưu
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Lot Modal */}
      {isLotModalOpen && selectedProduct && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-stone-100 flex items-center justify-between">
              <h3 className="text-xl font-serif text-stone-900">Nhập lô SX: {selectedProduct.name}</h3>
              <button onClick={() => setIsLotModalOpen(false)} className="text-stone-400 hover:text-stone-900">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleAddLot} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Mã lô sản xuất</label>
                <input 
                  type="text" 
                  value={newLot.batchNumber}
                  onChange={e => setNewLot({...newLot, batchNumber: e.target.value})}
                  className="w-full px-4 py-2 border border-stone-200 rounded-lg focus:ring-2 focus:ring-stone-900/10 focus:outline-none"
                  placeholder="Ví dụ: SX-2024-001"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Số lượng sản xuất ({selectedProduct.unit})</label>
                <input 
                  required
                  type="number" 
                  value={newLot.quantity}
                  onChange={e => setNewLot({...newLot, quantity: Number(e.target.value)})}
                  className="w-full px-4 py-2 border border-stone-200 rounded-lg focus:ring-2 focus:ring-stone-900/10 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Ngày sản xuất</label>
                <input 
                  required
                  type="datetime-local" 
                  value={newLot.productionDate}
                  onChange={e => setNewLot({...newLot, productionDate: e.target.value})}
                  className="w-full px-4 py-2 border border-stone-200 rounded-lg focus:ring-2 focus:ring-stone-900/10 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">Ngày hết hạn (Tùy chọn)</label>
                <input 
                  type="date" 
                  value={newLot.expiryDate}
                  onChange={e => setNewLot({...newLot, expiryDate: e.target.value})}
                  className="w-full px-4 py-2 border border-stone-200 rounded-lg focus:ring-2 focus:ring-stone-900/10 focus:outline-none"
                />
              </div>
              <div className="pt-4 flex gap-3">
                <button 
                  type="button"
                  onClick={() => setIsLotModalOpen(false)}
                  className="flex-1 px-4 py-2 border border-stone-200 text-stone-600 rounded-lg hover:bg-stone-50 transition-colors"
                >
                  Hủy
                </button>
                <button 
                  type="submit"
                  className="flex-1 px-4 py-2 bg-stone-900 text-white rounded-lg hover:bg-stone-800 transition-colors"
                >
                  Nhập kho
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
