import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { StoreProvider, useStore } from './contexts/StoreContext';
import { initActivityListeners } from './hooks/useActivityTracker';
import SyncProgressBanner from './components/SyncProgressBanner';

import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import OnboardingPage from './pages/OnboardingPage';
import WorkspacePage from './pages/WorkspacePage';
import IncomingPage from './pages/IncomingPage';
import IssueFixPage from './pages/IssueFixPage';
import CardListPage from './pages/CardListPage';
import CardDetailPage from './pages/CardDetailPage';
import PhotoStudioPage from './pages/PhotoStudioPage';
import ABTestsPage from './pages/ABTestsPage';
import TeamPage from './pages/TeamPage';
import ApprovalsPage from './pages/ApprovalsPage';
import StaffPage from './pages/StaffPage';
import AcceptInvitePage from './pages/AcceptInvitePage';
import FixedFilePage from './pages/FixedFilePage';

function GlobalSyncBanner() {
  const { activeStore, loadStores } = useStore();
  if (!activeStore) return null;
  const handleComplete = () => {
    loadStores();
    // Emit event so WorkspacePage can reload its dashboard
    window.dispatchEvent(new CustomEvent('syncCompleted', { detail: { storeId: activeStore.id } }));
  };
  return <SyncProgressBanner storeId={activeStore.id} onComplete={handleComplete} />;
}

function ProtectedRoute({ children, permission }: { children: React.ReactNode; permission?: string }) {
  const { isAuthenticated, loading, hasPermission } = useAuth();
  const { storesReady } = useStore();

  if (loading) {
    return (
      <div className="loading-page">
        <div className="loading-center">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Wait for stores to load before rendering any protected page.
  // This ensures activeStore is available when page components mount,
  // preventing stuck loading spinners on page refresh.
  if (!storesReady) {
    return (
      <div className="loading-page">
        <div className="loading-center">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (permission && !hasPermission(permission)) {
    return <Navigate to="/workspace" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <>
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />

      {/* Protected routes */}
      <Route
        path="/onboard"
        element={
          <ProtectedRoute>
            <OnboardingPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/workspace"
        element={
          <ProtectedRoute>
            <WorkspacePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/workspace/incoming"
        element={
          <ProtectedRoute>
            <IncomingPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/workspace/fix/:severity"
        element={
          <ProtectedRoute>
            <IssueFixPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/workspace/cards"
        element={
          <ProtectedRoute>
            <CardListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/workspace/cards/:cardId"
        element={
          <ProtectedRoute>
            <CardDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/photo-studio"
        element={
          <ProtectedRoute permission="photos.manage">
            <PhotoStudioPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/ab-tests"
        element={
          <ProtectedRoute>
            <ABTestsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/workspace/team"
        element={
          <ProtectedRoute permission="team.view">
            <TeamPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/workspace/approvals"
        element={
          <ProtectedRoute>
            <ApprovalsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/workspace/staff"
        element={
          <ProtectedRoute permission="team.view">
            <StaffPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/workspace/fixed-file"
        element={
          <ProtectedRoute>
            <FixedFilePage />
          </ProtectedRoute>
        }
      />

      {/* Catch-all redirect */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    <GlobalSyncBanner />
    </>
  );
}

export default function App() {
  useEffect(() => {
    const cleanup = initActivityListeners();
    return cleanup;
  }, []);

  return (
    <BrowserRouter>
      <AuthProvider>
        <StoreProvider>
          <AppRoutes />
        </StoreProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
