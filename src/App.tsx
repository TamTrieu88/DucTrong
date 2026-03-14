/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { db } from './firebase';
import { collection, getDocs, query, where, addDoc } from 'firebase/firestore';
import { AuthUser, PermissionsMap } from './types';
import { Sidebar } from './components/Sidebar';
import { Overview } from './components/Overview';
import { RawMaterials } from './components/RawMaterials';
import { FinishedProducts } from './components/FinishedProducts';
import { Production } from './components/Production';
import { Sales } from './components/Sales';
import { Recipes } from './components/Recipes';
import { Customers } from './components/Customers';
import { AccountManagement } from './components/AccountManagement';
import { LogIn, Loader2, Menu } from 'lucide-react';

const FULL_PERMISSIONS: PermissionsMap = {
  'overview': { create: true, read: true, update: true, delete: true },
  'raw-materials': { create: true, read: true, update: true, delete: true },
  'finished-products': { create: true, read: true, update: true, delete: true },
  'DT_customers': { create: true, read: true, update: true, delete: true },
  'DT_recipes': { create: true, read: true, update: true, delete: true },
  'sales': { create: true, read: true, update: true, delete: true },
  'accounts': { create: true, read: true, update: true, delete: true },
};

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Seed admin user on first load
  useEffect(() => {
    const seedAdmin = async () => {
      const q = query(collection(db, 'DT_users'), where('username', '==', 'admin'));
      const snap = await getDocs(q);
      if (snap.empty) {
        await addDoc(collection(db, 'DT_users'), {
          displayName: 'Administrator',
          username: 'admin',
          password: '123',
          role: 'admin',
          permissions: FULL_PERMISSIONS,
        });
      }
    };
    seedAdmin().catch(console.warn);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const q = query(collection(db, 'DT_users'), where('username', '==', username.trim()));
      const snap = await getDocs(q);

      if (snap.empty) {
        setError('Tài khoản hoặc mật khẩu không đúng');
        setIsLoading(false);
        return;
      }

      const userDoc = snap.docs[0];
      const userData = userDoc.data();

      if (userData.password !== password) {
        setError('Tài khoản hoặc mật khẩu không đúng');
        setIsLoading(false);
        return;
      }

      const permissions = userData.role === 'admin' ? FULL_PERMISSIONS : (userData.permissions || {});

      setUser({
        username: userData.username,
        displayName: userData.displayName || userData.username,
        email: userData.email || `${userData.username}@ductrong.vn`,
        role: userData.role || 'member',
        permissions,
      });
      setError('');
    } catch (err: any) {
      setError('Lỗi kết nối. Vui lòng thử lại.');
      console.warn('Login error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    setUser(null);
    setUsername('');
    setPassword('');
    setError('');
    setActiveTab('overview');
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center border border-slate-100">
          <h1 className="text-4xl font-serif mb-2 text-slate-900">Đức Trọng</h1>
          <p className="text-slate-500 mb-8">Hệ thống quản lý sản xuất muối tôm Tây Ninh</p>
          
          <form onSubmit={handleLogin} className="space-y-4 text-left">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Tài khoản</label>
              <input 
                type="text" 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-slate-900 outline-none transition-all"
                placeholder="Nhập tên tài khoản..."
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Mật khẩu</label>
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-slate-900 outline-none transition-all"
                placeholder="Nhập mật khẩu..."
              />
            </div>
            
            {error && (
              <p className="text-red-500 text-sm mt-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white py-3 px-4 rounded-xl hover:bg-slate-800 transition-colors font-medium mt-6 disabled:opacity-50"
            >
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <LogIn className="w-5 h-5" />}
              {isLoading ? 'Đang đăng nhập...' : 'Đăng nhập'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'overview': return <Overview />;
      case 'raw-materials': return <RawMaterials />;
      case 'finished-products': return <FinishedProducts />;
      case 'DT_customers': return <Customers />;
      case 'sales': return <Sales />;
      case 'DT_recipes': return <Recipes />;
      case 'accounts': return <AccountManagement />;
      default: return <Overview />;
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={(tab) => {
          setActiveTab(tab);
          setSidebarOpen(false);
        }} 
        onLogout={handleLogout} 
        user={user}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      
      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden bg-white border-b border-slate-200 p-4 flex items-center justify-between sticky top-0 z-30">
          <h1 className="text-xl font-serif font-bold text-slate-900">Đức Trọng</h1>
          <button 
            onClick={() => setSidebarOpen(true)}
            className="p-2 hover:bg-slate-50 rounded-lg text-slate-500"
          >
            <Menu className="w-6 h-6" />
          </button>
        </header>

        <main className="flex-1 p-4 lg:p-8 overflow-auto">
          <div className="max-w-7xl mx-auto">
            {renderContent()}
          </div>
        </main>
      </div>
    </div>
  );
}
