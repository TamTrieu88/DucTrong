import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, addDoc, updateDoc, doc, deleteDoc, getDocs, query, where } from 'firebase/firestore';
import { UserAccount, PagePermission, PermissionsMap } from '../types';
import { Users, Plus, Edit2, Trash2, Shield, ShieldCheck, Eye, EyeOff, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '../utils';
import { ConfirmDialog, useConfirmDialog } from './ConfirmDialog';

const SYSTEM_PAGES = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'raw-materials', label: 'Kho nguyên liệu' },
  { id: 'finished-products', label: 'Kho thành phẩm' },
  { id: 'DT_customers', label: 'Khách hàng' },
  { id: 'DT_recipes', label: 'Công thức & Sản xuất' },
  { id: 'sales', label: 'Bán hàng' },
];

const CRUD_LABELS = [
  { key: 'create' as const, label: 'Tạo', short: 'C' },
  { key: 'read' as const, label: 'Xem', short: 'R' },
  { key: 'update' as const, label: 'Sửa', short: 'U' },
  { key: 'delete' as const, label: 'Xóa', short: 'D' },
];

const fullPermissions = (): PermissionsMap => {
  const perms: PermissionsMap = {};
  SYSTEM_PAGES.forEach(p => {
    perms[p.id] = { create: true, read: true, update: true, delete: true };
  });
  return perms;
};

const emptyPermissions = (): PermissionsMap => {
  const perms: PermissionsMap = {};
  SYSTEM_PAGES.forEach(p => {
    perms[p.id] = { create: false, read: false, update: false, delete: false };
  });
  return perms;
};

export const AccountManagement: React.FC = () => {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserAccount | null>(null);
  const [form, setForm] = useState({
    displayName: '',
    username: '',
    password: '',
    role: 'member' as 'admin' | 'member',
    permissions: emptyPermissions(),
  });
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const { confirm, dialogProps } = useConfirmDialog();

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'DT_users'), (snap) => {
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() } as UserAccount)));
    });
    return () => unsub();
  }, []);

  const resetForm = () => {
    setForm({ displayName: '', username: '', password: '', role: 'member', permissions: emptyPermissions() });
    setEditingUser(null);
    setShowPassword(false);
    setMessage(null);
  };

  const handleOpenAdd = () => {
    resetForm();
    setShowModal(true);
  };

  const handleOpenEdit = (user: UserAccount) => {
    setEditingUser(user);
    setForm({
      displayName: user.displayName,
      username: user.username,
      password: '', // Don't show existing password
      role: user.role,
      permissions: { ...emptyPermissions(), ...user.permissions },
    });
    setShowPassword(false);
    setMessage(null);
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!form.displayName.trim() || !form.username.trim()) {
      setMessage({ type: 'error', text: 'Vui lòng nhập đầy đủ thông tin.' });
      return;
    }

    // Check duplicate username
    const existingQ = query(collection(db, 'DT_users'), where('username', '==', form.username.trim()));
    const existingSnap = await getDocs(existingQ);
    const isDuplicate = existingSnap.docs.some(d => d.id !== editingUser?.id);
    if (isDuplicate) {
      setMessage({ type: 'error', text: 'Tên đăng nhập đã tồn tại.' });
      return;
    }

    try {
      if (editingUser) {
        const updateData: any = {
          displayName: form.displayName.trim(),
          username: form.username.trim(),
          role: form.role,
          permissions: form.permissions,
        };
        if (form.password.trim()) {
          updateData.password = form.password.trim();
        }
        await updateDoc(doc(db, 'DT_users', editingUser.id), updateData);
        setMessage({ type: 'success', text: 'Cập nhật tài khoản thành công!' });
      } else {
        if (!form.password.trim()) {
          setMessage({ type: 'error', text: 'Vui lòng nhập mật khẩu cho tài khoản mới.' });
          return;
        }
        await addDoc(collection(db, 'DT_users'), {
          displayName: form.displayName.trim(),
          username: form.username.trim(),
          password: form.password.trim(),
          role: form.role,
          permissions: form.permissions,
        });
        setMessage({ type: 'success', text: 'Tạo tài khoản thành công!' });
      }
      setTimeout(() => {
        setShowModal(false);
        resetForm();
      }, 1000);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleDelete = async (user: UserAccount) => {
    const ok = await confirm({
      title: 'Xóa tài khoản',
      message: `Bạn có chắc chắn muốn xóa tài khoản "${user.displayName}"? Hành động này không thể hoàn tác.`,
      confirmText: 'Xóa',
    });
    if (ok) {
      await deleteDoc(doc(db, 'DT_users', user.id));
    }
  };

  const togglePermission = (pageId: string, key: keyof PagePermission) => {
    setForm(prev => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [pageId]: {
          ...prev.permissions[pageId],
          [key]: !prev.permissions[pageId]?.[key],
        },
      },
    }));
  };

  const toggleAllPage = (pageId: string) => {
    const current = form.permissions[pageId];
    const allTrue = current?.create && current?.read && current?.update && current?.delete;
    setForm(prev => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [pageId]: { create: !allTrue, read: !allTrue, update: !allTrue, delete: !allTrue },
      },
    }));
  };

  const setAllPermissions = (value: boolean) => {
    setForm(prev => ({
      ...prev,
      permissions: value ? fullPermissions() : emptyPermissions(),
    }));
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-serif font-bold text-slate-900">Quản lý tài khoản</h2>
          <p className="text-slate-500 mt-1">Tạo và phân quyền cho từng thành viên trong hệ thống.</p>
        </div>
        <button
          onClick={handleOpenAdd}
          className="flex items-center gap-2 bg-slate-900 text-white px-6 py-3 rounded-xl hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 font-medium"
        >
          <Plus className="w-5 h-5" />
          Thêm tài khoản
        </button>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Tên hiển thị</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Username</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Vai trò</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Quyền hạn</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {users.map((u) => {
                const isAdmin = u.role === 'admin';
                const readPages = SYSTEM_PAGES.filter(p => u.permissions?.[p.id]?.read).length;
                return (
                  <tr key={u.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <img
                          src={`https://ui-avatars.com/api/?name=${encodeURIComponent(u.displayName)}&background=1e293b&color=fff&bold=true`}
                          alt={u.displayName}
                          className="w-9 h-9 rounded-full"
                        />
                        <span className="font-medium text-slate-900">{u.displayName}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-500 font-mono text-sm">{u.username}</td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold',
                        isAdmin ? 'bg-purple-50 text-purple-700' : 'bg-slate-100 text-slate-600'
                      )}>
                        {isAdmin ? <ShieldCheck className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5" />}
                        {isAdmin ? 'Admin' : 'Thành viên'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-slate-500">
                        {isAdmin ? (
                          <span className="text-purple-600 font-medium">Toàn quyền</span>
                        ) : (
                          `${readPages}/${SYSTEM_PAGES.length} trang`
                        )}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        {!isAdmin && (
                          <>
                            <button
                              onClick={() => handleOpenEdit(u)}
                              className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Sửa"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(u)}
                              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                              title="Xóa"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        {isAdmin && (
                          <span className="text-xs text-slate-400 italic px-2 py-2">Admin gốc</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-500 italic bg-slate-50/50">
                    Chưa có tài khoản nào.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center p-8 pb-4 shrink-0">
              <h3 className="text-2xl font-serif font-bold text-slate-900">
                {editingUser ? 'Sửa tài khoản' : 'Tạo tài khoản mới'}
              </h3>
              <button
                onClick={() => { setShowModal(false); resetForm(); }}
                className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleSave} className="overflow-y-auto flex-1 px-8 pb-8 space-y-6">
              {/* Basic Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Tên hiển thị *</label>
                  <input
                    type="text"
                    className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
                    value={form.displayName}
                    onChange={e => setForm({ ...form, displayName: e.target.value })}
                    placeholder="VD: Nguyễn Văn A"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Tên đăng nhập (username) *</label>
                  <input
                    type="text"
                    className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/5 font-mono"
                    value={form.username}
                    onChange={e => setForm({ ...form, username: e.target.value })}
                    placeholder="VD: nguyenvana"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">
                  Mật khẩu {editingUser ? '(để trống nếu không đổi)' : '*'}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="w-full px-4 py-3 rounded-xl border border-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-900/5 pr-12"
                    value={form.password}
                    onChange={e => setForm({ ...form, password: e.target.value })}
                    placeholder="Nhập mật khẩu..."
                    required={!editingUser}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Permission Matrix */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <label className="text-xs font-bold text-slate-400 uppercase">Ma trận phân quyền</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setAllPermissions(true)}
                      className="text-xs font-bold text-emerald-600 hover:underline px-2 py-1 rounded hover:bg-emerald-50"
                    >
                      Chọn tất cả
                    </button>
                    <button
                      type="button"
                      onClick={() => setAllPermissions(false)}
                      className="text-xs font-bold text-slate-500 hover:underline px-2 py-1 rounded hover:bg-slate-50"
                    >
                      Bỏ tất cả
                    </button>
                  </div>
                </div>

                <div className="border border-slate-100 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50/80">
                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Trang</th>
                        {CRUD_LABELS.map(c => (
                          <th key={c.key} className="px-3 py-3 text-center text-xs font-bold text-slate-500 uppercase tracking-wider w-20">
                            <span className="hidden sm:inline">{c.label}</span>
                            <span className="sm:hidden">{c.short}</span>
                          </th>
                        ))}
                        <th className="px-3 py-3 text-center text-xs font-bold text-slate-500 uppercase tracking-wider w-20">Tất cả</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {SYSTEM_PAGES.map(page => {
                        const perms = form.permissions[page.id] || {};
                        const allChecked = perms.create && perms.read && perms.update && perms.delete;
                        return (
                          <tr key={page.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-4 py-3 font-medium text-slate-700">{page.label}</td>
                            {CRUD_LABELS.map(c => (
                              <td key={c.key} className="px-3 py-3 text-center">
                                <label className="inline-flex items-center justify-center cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={!!perms[c.key]}
                                    onChange={() => togglePermission(page.id, c.key)}
                                    className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900/20 cursor-pointer"
                                  />
                                </label>
                              </td>
                            ))}
                            <td className="px-3 py-3 text-center">
                              <label className="inline-flex items-center justify-center cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={!!allChecked}
                                  onChange={() => toggleAllPage(page.id)}
                                  className="w-4 h-4 rounded border-purple-300 text-purple-600 focus:ring-purple-500/20 cursor-pointer"
                                />
                              </label>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {message && (
                <div className={cn(
                  'p-4 rounded-xl flex items-center gap-3',
                  message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'
                )}>
                  {message.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                  <p className="text-sm font-medium">{message.text}</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); resetForm(); }}
                  className="flex-1 px-6 py-3 rounded-xl border border-slate-100 font-bold text-slate-500 hover:bg-slate-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="flex-1 px-6 py-3 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 shadow-lg shadow-slate-200"
                >
                  {editingUser ? 'Cập nhật' : 'Tạo tài khoản'}
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
