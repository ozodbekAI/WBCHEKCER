import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Package, Inbox, Camera, FlaskConical, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import '../styles/index.css';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  permission?: string;
}

const navItems: NavItem[] = [
  { path: '/workspace', label: 'Главная', icon: <LayoutDashboard size={16} /> },
  { path: '/workspace/cards', label: 'Карточки', icon: <Package size={16} /> },
  { path: '/workspace/incoming', label: 'Входящие', icon: <Inbox size={16} /> },
  { path: '/photo-studio', label: 'Photo Studio', icon: <Camera size={16} />, permission: 'photos.manage' },
  { path: '/ab-tests', label: 'A/B Тесты', icon: <FlaskConical size={16} /> },
  { path: '/management', label: 'Управление', icon: <Users size={16} />, permission: 'team.view' },
];

export const Navigation: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasAnyPermission } = useAuth();

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
        .map((item) => (
        <button
          key={item.path}
          onClick={() => navigate(item.path)}
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
          }}
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
      ))}
    </nav>
  );
};
