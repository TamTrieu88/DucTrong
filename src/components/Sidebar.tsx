import React from 'react';
import { 
  LayoutDashboard, 
  Package, 
  Box, 
  FlaskConical, 
  ShoppingCart, 
  LogOut,
  ChevronRight,
  X,
  Users,
  UserCog
} from 'lucide-react';
import { AuthUser } from '../types';
import { cn } from '../utils';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout: () => void;
  user: AuthUser;
  isOpen: boolean;
  onClose: () => void;
}

const allMenuItems = [
  { id: 'overview', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'raw-materials', label: 'Kho nguyên liệu', icon: Package },
  { id: 'finished-products', label: 'Kho thành phẩm', icon: Box },
  { id: 'DT_customers', label: 'Khách hàng', icon: Users },
  { id: 'DT_recipes', label: 'Công thức & Sản xuất', icon: FlaskConical },
  { id: 'sales', label: 'Bán hàng', icon: ShoppingCart },
];

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, onLogout, user, isOpen, onClose }) => {
  const isAdmin = user.role === 'admin';
  const perms = user.permissions || {};

  // Filter menu items: admin sees all, member sees pages with read permission
  const menuItems = isAdmin
    ? allMenuItems
    : allMenuItems.filter(item => perms[item.id]?.read);

  return (
    <>
      {/* Mobile Overlay */}
      <div 
        className={cn(
          "fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 lg:hidden transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />

      <aside className={cn(
        "fixed lg:sticky top-0 left-0 z-50 w-72 bg-white border-r border-slate-200 flex flex-col h-screen transition-transform duration-300 lg:translate-x-0",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-serif font-bold text-slate-900 tracking-tight">Đức Trọng</h1>
            <p className="text-xs text-slate-400 uppercase tracking-widest mt-1 font-medium">Muối Tôm Tây Ninh</p>
          </div>
          <button 
            onClick={onClose}
            className="lg:hidden p-2 hover:bg-slate-50 rounded-lg text-slate-500"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

      <nav className="flex-1 px-4 space-y-1">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={cn(
              "w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200 group",
              activeTab === item.id 
                ? "bg-slate-900 text-white shadow-lg shadow-slate-200" 
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            )}
          >
            <div className="flex items-center gap-3">
              <item.icon className={cn("w-5 h-5", activeTab === item.id ? "text-white" : "text-slate-400 group-hover:text-slate-900")} />
              <span className="font-medium">{item.label}</span>
            </div>
            {activeTab === item.id && <ChevronRight className="w-4 h-4 opacity-50" />}
          </button>
        ))}

        {/* Accounts link — admin only */}
        {isAdmin && (
          <>
            <div className="pt-4 pb-2 px-4">
              <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Quản trị</p>
            </div>
            <button
              onClick={() => setActiveTab('accounts')}
              className={cn(
                "w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200 group",
                activeTab === 'accounts' 
                  ? "bg-slate-900 text-white shadow-lg shadow-slate-200" 
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
              )}
            >
              <div className="flex items-center gap-3">
                <UserCog className={cn("w-5 h-5", activeTab === 'accounts' ? "text-white" : "text-slate-400 group-hover:text-slate-900")} />
                <span className="font-medium">Quản lý tài khoản</span>
              </div>
              {activeTab === 'accounts' && <ChevronRight className="w-4 h-4 opacity-50" />}
            </button>
          </>
        )}
      </nav>

      <div className="p-4 mt-auto border-t border-slate-100">
        <div className="flex items-center gap-3 px-4 py-3 mb-2">
          <img 
            src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName || user.username}`} 
            alt={user.displayName || user.username} 
            className="w-10 h-10 rounded-full border-2 border-slate-100"
            referrerPolicy="no-referrer"
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">{user.displayName || user.username}</p>
            <p className="text-xs text-slate-500 truncate">{isAdmin ? 'Quản trị viên' : 'Thành viên'}</p>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-4 py-3 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors font-medium"
        >
          <LogOut className="w-5 h-5" />
          <span>Đăng xuất</span>
        </button>
      </div>
    </aside>
    </>
  );
};
