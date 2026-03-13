import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, addDoc, updateDoc, doc, deleteDoc, query, where, getDocs, orderBy, writeBatch } from '../lib/localStore';
import { RawMaterial, RawMaterialBatch } from '../types';
import { Plus, History, Package, Calendar, Tag, Info, Edit2, Trash2, ArrowUpRight, Loader2, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { cn } from '../utils';
import { format } from 'date-fns';
import { ConfirmDialog, useConfirmDialog } from './ConfirmDialog';

export const RawMaterials: React.FC = () => {
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [batches, setBatches] = useState<RawMaterialBatch[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<RawMaterial | null>(null);
  const [selectedMaterialBatches, setSelectedMaterialBatches] = useState<RawMaterial | null>(null);
  const [editingBatch, setEditingBatch] = useState<RawMaterialBatch | null>(null);
  const [newMaterial, setNewMaterial] = useState({ name: '', unit: '' });
  const [newBatch, setNewBatch] = useState({ materialId: '', quantity: 0, costPerUnit: 0 });
  const [exportData, setExportData] = useState({ materialId: '', quantity: 0, note: '' });
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const { confirm, dialogProps } = useConfirmDialog();

  useEffect(() => {
    const unsubMat = onSnapshot(collection(db, 'raw_materials'), (snap) => {
      setMaterials(snap.docs.map(d => ({ id: d.id, ...d.data() } as RawMaterial)));
    });
    const unsubBatch = onSnapshot(collection(db, 'raw_material_batches'), (snap) => {
      setBatches(snap.docs.map(d => ({ id: d.id, ...d.data() } as RawMaterialBatch)));
    });
    return () => {
      unsubMat();
      unsubBatch();
    };
  }, []);

  const handleAddMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingMaterial) {
      const matRef = doc(db, 'raw_materials', editingMaterial.id);
      await updateDoc(matRef, { name: newMaterial.name, unit: newMaterial.unit });
      setEditingMaterial(null);
    } else {
      await addDoc(collection(db, 'raw_materials'), { ...newMaterial, totalQuantity: 0 });
    }
    setNewMaterial({ name: '', unit: '' });
  };

  const handleDeleteMaterial = async (id: string) => {
    const ok = await confirm({
      title: 'Xóa nguyên liệu',
      message: 'Bạn có chắc chắn muốn xóa nguyên liệu này? Tất cả các lô hàng liên quan cũng sẽ bị xóa.',
      confirmText: 'Xóa',
    });
    if (ok) {
      await deleteDoc(doc(db, 'raw_materials', id));
      
      // Delete associated batches
      const batchesQuery = query(collection(db, 'raw_material_batches'), where('materialId', '==', id));
      const batchesSnap = await getDocs(batchesQuery);
      const batch = writeBatch(db);
      batchesSnap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
  };

  const handleExportBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!exportData.materialId || exportData.quantity <= 0) return;

    setIsProcessing(true);
    setMessage(null);

    try {
      const material = materials.find(m => m.id === exportData.materialId);
      if (!material || material.totalQuantity < exportData.quantity) {
        throw new Error('Số lượng tồn kho không đủ.');
      }

      const batch = writeBatch(db);
      const now = new Date().toISOString();

      // FIFO Consumption
      const batchesQuery = query(
        collection(db, 'raw_material_batches'),
        where('materialId', '==', exportData.materialId),
        where('quantity', '>', 0),
        orderBy('receivedDate', 'asc')
      );
      const batchesSnap = await getDocs(batchesQuery);
      
      let remainingToDeduct = exportData.quantity;
      for (const batchDoc of batchesSnap.docs) {
        if (remainingToDeduct <= 0) break;
        
        const batchData = batchDoc.data() as RawMaterialBatch;
        const deductAmount = Math.min(batchData.quantity, remainingToDeduct);
        
        batch.update(batchDoc.ref, { quantity: batchData.quantity - deductAmount });
        remainingToDeduct -= deductAmount;

        // Log transaction
        const transRef = doc(collection(db, 'transactions'));
        batch.set(transRef, {
          type: 'OUT',
          category: 'RAW_MATERIAL',
          itemId: exportData.materialId,
          batchId: batchDoc.id,
          quantity: deductAmount,
          date: now,
          note: exportData.note || 'Xuất kho thủ công'
        });
      }

      // Update total material quantity
      batch.update(doc(db, 'raw_materials', exportData.materialId), {
        totalQuantity: material.totalQuantity - exportData.quantity
      });

      await batch.commit();
      setMessage({ type: 'success', text: 'Xuất kho thành công!' });
      setExportData({ materialId: '', quantity: 0, note: '' });
      setTimeout(() => setShowExportModal(false), 1500);
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingBatch) {
      const batchRef = doc(db, 'raw_material_batches', editingBatch.id);
      const diff = newBatch.quantity - editingBatch.quantity;
      
      await updateDoc(batchRef, { 
        quantity: newBatch.quantity,
        costPerUnit: newBatch.costPerUnit
      });

      // Update total quantity in material
      const mat = materials.find(m => m.id === editingBatch.materialId);
      if (mat) {
        const matRef = doc(db, 'raw_materials', mat.id);
        await updateDoc(matRef, { totalQuantity: mat.totalQuantity + diff });
      }
      setEditingBatch(null);
    } else {
      const batchNumber = `RM-${format(new Date(), 'yyyyMMdd')}-${Math.floor(Math.random() * 1000)}`;
      const batchData = {
        ...newBatch,
        batchNumber,
        initialQuantity: newBatch.quantity,
        receivedDate: new Date().toISOString(),
      };
      
      const batchRef = await addDoc(collection(db, 'raw_material_batches'), batchData);
      
      // Update total quantity in material
      const mat = materials.find(m => m.id === newBatch.materialId);
      if (mat) {
        const matRef = doc(db, 'raw_materials', mat.id);
        await updateDoc(matRef, { 
          totalQuantity: mat.totalQuantity + newBatch.quantity
        });
      }

      // Log transaction
      await addDoc(collection(db, 'transactions'), {
        type: 'IN',
        category: 'RAW_MATERIAL',
        itemId: newBatch.materialId,
        batchId: batchRef.id,
        quantity: newBatch.quantity,
        date: new Date().toISOString(),
        note: 'Nhập kho nguyên liệu mới'
      });
    }

    setNewBatch({ materialId: '', quantity: 0, costPerUnit: 0 });
    setShowAddModal(false);
  };

  const handleDeleteBatch = async (batch: RawMaterialBatch) => {
    const ok = await confirm({
      title: 'Xóa lô hàng',
      message: 'Bạn có chắc chắn muốn xóa lô hàng này? Tồn kho tổng sẽ bị giảm tương ứng.',
      confirmText: 'Xóa',
    });
    if (ok) {
      await deleteDoc(doc(db, 'raw_material_batches', batch.id));
      
      // Update total quantity in material
      const mat = materials.find(m => m.id === batch.materialId);
      if (mat) {
        const matRef = doc(db, 'raw_materials', mat.id);
        await updateDoc(matRef, { totalQuantity: mat.totalQuantity - batch.quantity });
      }
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-serif font-bold text-slate-900">Kho nguyên liệu</h2>
          <p className="text-slate-500 mt-1">Quản lý nhập kho và theo dõi lô hàng theo FIFO.</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => setShowExportModal(true)}
            className="flex items-center gap-2 bg-white text-slate-900 border border-slate-200 px-6 py-3 rounded-xl hover:bg-slate-50 transition-all font-medium"
          >
            <ArrowUpRight className="w-5 h-5" />
            Xuất kho
          </button>
          <button 
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 bg-slate-900 text-white px-6 py-3 rounded-xl hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 font-medium"
          >
            <Plus className="w-5 h-5" />
            Nhập kho mới
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-50 flex items-center justify-between">
              <h3 className="font-serif font-bold text-lg">Danh sách nguyên liệu</h3>
              <div className="flex items-center gap-2 text-xs text-slate-400 font-medium uppercase tracking-wider">
                <Info className="w-4 h-4" />
                Tổng cộng {materials.length} loại
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50">
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Tên nguyên liệu</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Đơn vị</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Tồn kho</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Trạng thái</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {materials.map((mat) => (
                    <tr key={mat.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 font-medium text-slate-900">{mat.name}</td>
                      <td className="px-6 py-4 text-slate-500">{mat.unit}</td>
                      <td className="px-6 py-4 text-right font-bold text-slate-900">{mat.totalQuantity}</td>
                      <td className="px-6 py-4 text-right">
                        <span className={cn(
                          "px-2 py-1 rounded-md text-xs font-bold",
                          mat.totalQuantity > 50 ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
                        )}>
                          {mat.totalQuantity > 50 ? "Ổn định" : "Sắp hết"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button 
                            onClick={() => setSelectedMaterialBatches(mat)}
                            className="p-2 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                            title="Xem lô hiện có"
                          >
                            <History className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => {
                              setEditingMaterial(mat);
                              setNewMaterial({ name: mat.name || '', unit: mat.unit || '' });
                            }}
                            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleDeleteMaterial(mat.id)}
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
              {editingMaterial ? 'Sửa nguyên liệu' : 'Thêm nguyên liệu mới'}
            </h3>
            <form onSubmit={handleAddMaterial} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Tên nguyên liệu</label>
                <input 
                  type="text" 
                  value={newMaterial.name}
                  onChange={e => setNewMaterial({...newMaterial, name: e.target.value})}
                  className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/5 transition-all"
                  placeholder="VD: Tôm khô"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Đơn vị tính</label>
                <input 
                  type="text" 
                  value={newMaterial.unit}
                  onChange={e => setNewMaterial({...newMaterial, unit: e.target.value})}
                  className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/5 transition-all"
                  placeholder="VD: kg, túi"
                  required
                />
              </div>
              <div className="flex gap-2">
                {editingMaterial && (
                  <button 
                    type="button"
                    onClick={() => {
                      setEditingMaterial(null);
                      setNewMaterial({ name: '', unit: '' });
                    }}
                    className="flex-1 bg-slate-50 text-slate-500 py-3 rounded-xl font-bold hover:bg-slate-100 transition-colors"
                  >
                    Hủy
                  </button>
                )}
                <button className="flex-[2] bg-slate-100 text-slate-900 py-3 rounded-xl font-bold hover:bg-slate-200 transition-colors">
                  {editingMaterial ? 'Cập nhật' : 'Thêm vào danh mục'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-8">
            <h3 className="text-2xl font-serif font-bold mb-6">
              {editingBatch ? 'Sửa lô hàng' : 'Nhập kho lô hàng mới'}
            </h3>
            <form onSubmit={handleAddBatch} className="space-y-6">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Chọn nguyên liệu</label>
                <select 
                  className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/5 disabled:bg-slate-50"
                  value={newBatch.materialId}
                  onChange={e => setNewBatch({...newBatch, materialId: e.target.value})}
                  required
                  disabled={!!editingBatch}
                >
                  <option value="">-- Chọn --</option>
                  {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Số lượng</label>
                  <input 
                    type="number" 
                    className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
                    value={newBatch.quantity}
                    onChange={e => setNewBatch({...newBatch, quantity: Number(e.target.value)})}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Đơn giá (VNĐ)</label>
                  <input 
                    type="number" 
                    className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
                    value={newBatch.costPerUnit}
                    onChange={e => setNewBatch({...newBatch, costPerUnit: Number(e.target.value)})}
                    required
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button 
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingBatch(null);
                    setNewBatch({ materialId: '', quantity: 0, costPerUnit: 0 });
                  }}
                  className="flex-1 px-6 py-3 rounded-xl border border-slate-100 font-bold text-slate-500 hover:bg-slate-50"
                >
                  Hủy
                </button>
                <button 
                  type="submit"
                  className="flex-1 px-6 py-3 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 shadow-lg shadow-slate-200"
                >
                  {editingBatch ? 'Cập nhật' : 'Xác nhận nhập'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showExportModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-8">
            <h3 className="text-2xl font-serif font-bold mb-6">Xuất kho nguyên liệu</h3>
            <form onSubmit={handleExportBatch} className="space-y-6">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Chọn nguyên liệu</label>
                <select 
                  className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
                  value={exportData.materialId}
                  onChange={e => setExportData({...exportData, materialId: e.target.value})}
                  required
                >
                  <option value="">-- Chọn --</option>
                  {materials.map(m => <option key={m.id} value={m.id}>{m.name} (Tồn: {m.totalQuantity} {m.unit})</option>)}
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
      {selectedMaterialBatches && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl p-8 max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-2xl font-serif font-bold text-slate-900">Chi tiết lô: {selectedMaterialBatches.name}</h3>
                <p className="text-slate-500 mt-1">Đơn vị tính: {selectedMaterialBatches.unit}</p>
              </div>
              <button onClick={() => setSelectedMaterialBatches(null)} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="overflow-y-auto flex-1 pr-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {batches.filter(b => b.materialId === selectedMaterialBatches.id && b.quantity > 0).sort((a, b) => new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime()).map(batch => (
                  <div key={batch.id} className="p-4 border border-slate-100 rounded-xl bg-slate-50/30 group relative flex flex-col">
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => {
                          setEditingBatch(batch);
                          setNewBatch({ materialId: batch.materialId || '', quantity: batch.quantity || 0, costPerUnit: batch.costPerUnit || 0 });
                          setShowAddModal(true);
                        }}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-white rounded-md shadow-sm transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
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
                        <p className="text-2xl font-bold text-slate-900">{batch.quantity} <span className="text-sm font-normal text-slate-500">{materials.find(m => m.id === batch.materialId)?.unit}</span></p>
                        <p className="text-xs text-slate-400 mt-1">Nhập ngày: {format(new Date(batch.receivedDate), 'dd/MM/yyyy')}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-400">Đã dùng</p>
                        <p className="text-sm font-medium text-slate-600">{Math.round((1 - batch.quantity / batch.initialQuantity) * 100)}%</p>
                      </div>
                    </div>
                    <div className="pt-3 mt-3 border-t border-slate-100 flex justify-between items-center -mx-4 -mb-4 px-4 py-3 rounded-b-xl bg-white/50">
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Giá nhập / đv</p>
                        <p className="text-sm font-semibold text-slate-700">{batch.costPerUnit?.toLocaleString('vi-VN')} đ</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Giá trị còn lại</p>
                        <p className="text-sm font-bold text-emerald-600">{(batch.quantity * (batch.costPerUnit || 0)).toLocaleString('vi-VN')} đ</p>
                      </div>
                    </div>
                  </div>
                ))}
                {batches.filter(b => b.materialId === selectedMaterialBatches.id && b.quantity > 0).length === 0 && (
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

