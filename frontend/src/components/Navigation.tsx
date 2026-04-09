import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Package, Inbox, Camera, FlaskConical, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useStore } from '../contexts/StoreContext';
import { getStoreFeatureMessage, isStoreFeatureAllowed, type StoreFeatureKey } from '../lib/storeAccess';
import '../styles/index.css';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  permission?: string;
  storeFeature?: StoreFeatureKey;
}

const navItems: NavItem[] = [
  { path: '/workspace', label: 'Главная', icon: <LayoutDashboard size={16} /> },
  { path: '/workspace/cards', label: 'Карточки', icon: <Package size={16} />, storeFeature: 'cards' },
  { path: '/workspace/incoming', label: 'Входящие', icon: <Inbox size={16} />, storeFeature: 'cards' },
  { path: '/photo-studio', label: 'Photo Studio', icon: <Camera size={16} />, permission: 'photos.manage', storeFeature: 'photo_studio' },
  { path: '/ab-tests', label: 'A/B Тесты', icon: <FlaskConical size={16} />, storeFeature: 'ab_tests' },
  { path: '/management', label: 'Управление', icon: <Users size={16} />, permission: 'team.view' },
];

export const Navigation: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasAnyPermission } = useAuth();
  const { activeStore } = useStore();

  return (
    <nav style={{
      display: 'flex',
      gap: '8px',
      padding: '0 12px',
      flexWrap: 'wrap',
      alignItems: 'center'
    }}>
      {navItems
        .filter(item => !item.permission || hasAnyPermission(item.permission, 'team.manage'))
        .map((item) => {
          const storeBlocked = item.storeFeature ? !isStoreFeatureAllowed(activeStore, item.storeFeature) : false;

          return (
            <button
              key={item.path}
              onClick={() => {
                if (item.storeFeature && storeBlocked) {
                  toast.error(getStoreFeatureMessage(activeStore, item.storeFeature));
                  return;
                }
                navigate(item.path);
              }}
              style={{
                padding: '8px 12px',
                backgroundColor: location.pathname === item.path || (item.path === '/management' && location.pathname.startsWith('/management')) ? 'var(--primary)' : 'transparent',
                color: location.pathname === item.path || (item.path === '/management' && location.pathname.startsWith('/management')) ? 'white' : 'var(--text)',
                border: location.pathname === item.path || (item.path === '/management' && location.pathname.startsWith('/management')) ? 'none' : '1px solid var(--border)',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: location.pathname === item.path ? '600' : '400',
                transition: 'all 0.2s',
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                opacity: storeBlocked ? 0.6 : 1,
              }}
              title={item.storeFeature && storeBlocked ? getStoreFeatureMessage(activeStore, item.storeFeature) : undefined}
              onMouseOver={(e) => {
                if (location.pathname !== item.path) {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--bg-secondary)';
                }
              }}
              onMouseOut={(e) => {
                if (location.pathname !== item.path) {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
                }
              }}
            >
              {item.icon}
              {item.label}
            </button>
          );
        })}
    </nav>
  );
};
