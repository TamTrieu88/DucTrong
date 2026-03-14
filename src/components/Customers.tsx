import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, addDoc, updateDoc, doc, deleteDoc, writeBatch } from 'firebase/firestore';
import { Customer } from '../types';
import { Users, Plus, Edit2, Trash2, CreditCard, AlertCircle, CheckCircle2, History, X, Loader2 } from 'lucide-react';
import { cn } from '../utils';
import { ConfirmDialog, useConfirmDialog } from './ConfirmDialog';

export const Customers: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [payingCustomer, setPayingCustomer] = useState<Customer | null>(null);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', address: '', totalDebt: 0 });
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentNote, setPaymentNote] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const { confirm, dialogProps } = useConfirmDialog();

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'DT_customers'), (snap) => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() } as Customer)));
    });
    return () => unsub();
  }, []);

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingCustomer) {
      const custRef = doc(db, 'DT_customers', editingCustomer.id);
      await updateDoc(custRef, newCustomer);
      setEditingCustomer(null);
    } else {
      await addDoc(collection(db, 'DT_customers'), newCustomer);
    }
    setNewCustomer({ name: '', phone: '', address: '', totalDebt: 0 });
    setShowAddModal(false);
  };

  const handleDeleteCustomer = async (id: string) => {
    const ok = await confirm({
      title: 'Xóa khách hàng',
      message: 'Bạn có chắc chắn muốn xóa khách hàng này? Mọi dữ liệu về công nợ của họ cũng sẽ bị mất.',
      confirmText: 'Xóa',
    });
    if (ok) {
      await deleteDoc(doc(db, 'DT_customers', id));
    }
  };

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingCustomer || paymentAmount <= 0 || paymentAmount > payingCustomer.totalDebt) {
      setMessage({ type: 'error', text: 'Số tiền thanh toán không hợp lệ (phải > 0 và <= tổng nợ hiện tại).' });
      return;
    }

    setIsProcessing(true);
    setMessage(null);

    try {
      const batch = writeBatch(db);
      
      // Update customer debt
      const custRef = doc(db, 'DT_customers', payingCustomer.id);
      batch.update(custRef, {
        totalDebt: payingCustomer.totalDebt - paymentAmount
      });

      // Log payment
      const paymentRef = doc(collection(db, 'payments'));
      batch.set(paymentRef, {
        customerId: payingCustomer.id,
        amount: paymentAmount,
        date: new Date().toISOString(),
        note: paymentNote || 'Thanh toán công nợ'
      });

      // (Optional) Log transaction if needed
      const transRef = doc(collection(db, 'DT_transactions'));
      batch.set(transRef, {
        type: 'IN', // Receiving money
        category: 'FINISHED_PRODUCT', // Assuming all debts are from FP
        itemId: 'DEBT_PAYMENT',
        batchId: paymentRef.id,
        quantity: 0,
        revenue: paymentAmount,
        date: new Date().toISOString(),
        note: `Thu nợ khách hàng: ${payingCustomer.name}. Ghi chú: ${paymentNote}`
      });

      await batch.commit();

      setMessage({ type: 'success', text: 'Thu nợ thành công!' });
      setTimeout(() => {
        setShowPaymentModal(false);
        setPayingCustomer(null);
        setPaymentAmount(0);
        setPaymentNote('');
        setMessage(null);
      }, 1500);

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
          <h2 className="text-3xl font-serif font-bold text-slate-900">Khách hàng & Công nợ</h2>
          <p className="text-slate-500 mt-1">Quản lý thông tin khách hàng và theo dõi công nợ.</p>
        </div>
        <button 
          onClick={() => {
            setEditingCustomer(null);
            setNewCustomer({ name: '', phone: '', address: '', totalDebt: 0 });
            setShowAddModal(true);
          }}
          className="flex items-center gap-2 bg-slate-900 text-white px-6 py-3 rounded-xl hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 font-medium"
        >
          <Plus className="w-5 h-5" />
          Thêm khách hàng
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Tên khách hàng</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Điện thoại</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Địa chỉ</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Tổng nợ</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {customers.map((cust) => (
                <tr key={cust.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4 font-medium text-slate-900">{cust.name}</td>
                  <td className="px-6 py-4 text-slate-500">{cust.phone || '---'}</td>
                  <td className="px-6 py-4 text-slate-500">{cust.address || '---'}</td>
                  <td className="px-6 py-4 text-right font-bold text-rose-600">
                    {cust.totalDebt ? cust.totalDebt.toLocaleString('vi-VN') + ' đ' : '0 đ'}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button 
                        onClick={() => {
                          setPayingCustomer(cust);
                          setPaymentAmount(cust.totalDebt);
                          setPaymentNote('');
                          setShowPaymentModal(true);
                        }}
                        className={cn("p-2 rounded-lg transition-colors flex items-center gap-1", cust.totalDebt > 0 ? "text-emerald-600 hover:bg-emerald-50 bg-emerald-50/50" : "text-slate-300 pointer-events-none")}
                        title="Thu nợ"
                      >
                        <CreditCard className="w-4 h-4" />
                        <span className="text-xs font-bold">Thu</span>
                      </button>
                      <button 
                        onClick={() => {
                          setEditingCustomer(cust);
                          setNewCustomer({ name: cust.name, phone: cust.phone || '', address: cust.address || '', totalDebt: cust.totalDebt || 0 });
                          setShowAddModal(true);
                        }}
                        className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDeleteCustomer(cust.id)}
                        className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {customers.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-500 italic bg-slate-50/50">
                    Chưa có khách hàng nào.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-8">
            <h3 className="text-2xl font-serif font-bold mb-6">
              {editingCustomer ? 'Sửa khách hàng' : 'Thêm khách hàng'}
            </h3>
            <form onSubmit={handleSaveCustomer} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Tên khách hàng *</label>
                <input 
                  type="text" 
                  className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
                  value={newCustomer.name}
                  onChange={e => setNewCustomer({...newCustomer, name: e.target.value})}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Số điện thoại</label>
                <input 
                  type="tel" 
                  className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
                  value={newCustomer.phone}
                  onChange={e => setNewCustomer({...newCustomer, phone: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Địa chỉ</label>
                <input 
                  type="text" 
                  className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
                  value={newCustomer.address}
                  onChange={e => setNewCustomer({...newCustomer, address: e.target.value})}
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button 
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-6 py-3 rounded-xl border border-slate-100 font-bold text-slate-500 hover:bg-slate-50"
                >
                  Hủy
                </button>
                <button 
                  type="submit"
                  className="flex-1 px-6 py-3 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 shadow-lg shadow-slate-200"
                >
                  {editingCustomer ? 'Cập nhật' : 'Thêm mới'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showPaymentModal && payingCustomer && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-8">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-2xl font-serif font-bold text-slate-900">Thu nợ khách hàng</h3>
              <button 
                onClick={() => {
                  setShowPaymentModal(false);
                  setMessage(null);
                }} 
                className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"
              >
                <X className="w-5 h-5"/>
              </button>
            </div>

            <div className="mb-6 p-4 bg-rose-50 rounded-xl border border-rose-100 flex justify-between items-center">
              <div>
                <p className="text-xs font-bold text-rose-800 uppercase tracking-widest mb-1">Khách hàng</p>
                <p className="font-medium text-rose-900">{payingCustomer.name}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold text-rose-800 uppercase tracking-widest mb-1">Tổng nợ</p>
                <p className="font-bold text-rose-600 text-lg">{payingCustomer.totalDebt.toLocaleString('vi-VN')} đ</p>
              </div>
            </div>

            <form onSubmit={handlePayment} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2 flex justify-between">
                  <span>Số tiền thu *</span>
                  <button type="button" onClick={() => setPaymentAmount(payingCustomer.totalDebt)} className="text-emerald-600 hover:underline">Điền Tối Đa</button>
                </label>
                <input 
                  type="number" 
                  className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/5 text-slate-900 font-bold text-lg"
                  value={paymentAmount}
                  onChange={e => setPaymentAmount(Number(e.target.value))}
                  min="1"
                  max={payingCustomer.totalDebt}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Ghi chú (Tùy chọn)</label>
                <input 
                  type="text" 
                  className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
                  value={paymentNote}
                  onChange={e => setPaymentNote(e.target.value)}
                  placeholder="Ví dụ: Chuyển khoản Techcombank"
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
                  onClick={() => {
                    setShowPaymentModal(false);
                    setMessage(null);
                  }}
                  disabled={isProcessing}
                  className="flex-1 px-6 py-3 rounded-xl border border-slate-100 font-bold text-slate-500 hover:bg-slate-50"
                >
                  Hủy
                </button>
                <button 
                  type="submit"
                  disabled={isProcessing}
                  className="flex-1 px-6 py-3 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 shadow-lg shadow-emerald-200 flex justify-center items-center gap-2"
                >
                  {isProcessing && <Loader2 className="w-4 h-4 animate-spin"/>}
                  Xác nhận Thu
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog {...dialogProps} />
    </div>
  );
};
