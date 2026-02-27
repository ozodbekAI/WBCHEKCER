import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Package, Inbox, Camera, FlaskConical } from 'lucide-react';
import '../styles/index.css';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { path: '/workspace', label: 'Главная', icon: <LayoutDashboard size={16} /> },
  { path: '/workspace/cards', label: 'Карточки', icon: <Package size={16} /> },
  { path: '/workspace/incoming', label: 'Входящие', icon: <Inbox size={16} /> },
  { path: '/photo-studio', label: 'Photo Studio', icon: <Camera size={16} /> },
  { path: '/ab-tests', label: 'A/B Тесты', icon: <FlaskConical size={16} /> },
];

export const Navigation: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <nav style={{
      display: 'flex',
      gap: '8px',
      padding: '0 12px',
      flexWrap: 'wrap',
      alignItems: 'center'
    }}>
      {navItems.map((item) => (
        <button
          key={item.path}
          onClick={() => navigate(item.path)}
          style={{
            padding: '8px 12px',
            backgroundColor: location.pathname === item.path ? 'var(--primary)' : 'transparent',
            color: location.pathname === item.path ? 'white' : 'var(--text)',
            border: location.pathname === item.path ? 'none' : '1px solid var(--border)',
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
