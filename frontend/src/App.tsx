import React, { useCallback, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { StoreProvider, useStore } from './contexts/StoreContext';
import { initWorkTrackerListeners } from './hooks/useWorkTracker';
import SyncProgressBanner from './components/SyncProgressBanner';

import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import OnboardingPage from './pages/OnboardingPage';
import WorkspacePage from './pages/WorkspacePage';
import IncomingPage from './pages/IncomingPage';
import IssueFixPage from './pages/IssueFixPage';
import CardListPage from './pages/CardListPage';
import CardDetailPage from './pages/CardDetailPage';
import CardQueuePage from './pages/CardQueuePage';
import PhotoStudioPage from './pages/PhotoStudioPage';
import ABTestsPage from './pages/ABTestsPage';
import TeamPage from './pages/TeamPage';
import ApprovalsPage from './pages/ApprovalsPage';
import StaffPage from './pages/StaffPage';
import AcceptInvitePage from './pages/AcceptInvitePage';
import FixedFilePage from './pages/FixedFilePage';
import ProfilePage from './pages/ProfilePage';
import PresentationPage from './pages/PresentationPage';
import PresentationFullPage from './pages/PresentationFullPage';
import ManagementPage from './pages/ManagementPage';
import AdAnalysisPage from './pages/AdAnalysisPage';

function GlobalSyncBanner() {
  const { activeStore, loadStores } = useStore();
  if (!activeStore) return null;
  const handleComplete = useCallback(() => {
    loadStores();
    window.dispatchEvent(new CustomEvent('syncCompleted', { detail: { storeId: activeStore.id } }));
  }, [loadStores, activeStore.id]);
  return <SyncProgressBanner storeId={activeStore.id} onComplete={handleComplete} />;
}

function ProtectedRoute({ children, permission }: { children: React.ReactNode; permission?: string }) {
  const { isAuthenticated, loading, hasPermission } = useAuth();
  const { storesReady } = useStore();
  if (loading) return <div className="loading-page"><div className="loading-center"><div className="spinner" /></div></div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!storesReady) return <div className="loading-page"><div className="loading-center"><div className="spinner" /></div></div>;
  if (permission && !hasPermission(permission)) return <Navigate to="/workspace" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route path="/presentation" element={<PresentationPage />} />
        <Route path="/presentation-full" element={<PresentationFullPage />} />
        <Route path="/onboard" element={<ProtectedRoute><OnboardingPage /></ProtectedRoute>} />
        <Route path="/workspace" element={<ProtectedRoute><WorkspacePage /></ProtectedRoute>} />
        <Route path="/workspace/incoming" element={<ProtectedRoute><IncomingPage /></ProtectedRoute>} />
        <Route path="/workspace/fix/:severity" element={<ProtectedRoute><IssueFixPage /></ProtectedRoute>} />
        <Route path="/workspace/fix/card/:cardId" element={<ProtectedRoute><IssueFixPage /></ProtectedRoute>} />
        <Route path="/workspace/cards" element={<ProtectedRoute><CardListPage /></ProtectedRoute>} />
        <Route path="/workspace/cards/queue" element={<ProtectedRoute><CardQueuePage /></ProtectedRoute>} />
        <Route path="/workspace/cards/:cardId" element={<ProtectedRoute><CardDetailPage /></ProtectedRoute>} />
        <Route path="/photo-studio" element={<ProtectedRoute permission="photos.manage"><PhotoStudioPage /></ProtectedRoute>} />
        <Route path="/ab-tests" element={<ProtectedRoute><ABTestsPage /></ProtectedRoute>} />
        <Route path="/workspace/team" element={<ProtectedRoute permission="team.view"><TeamPage /></ProtectedRoute>} />
        <Route path="/workspace/approvals" element={<ProtectedRoute><ApprovalsPage /></ProtectedRoute>} />
        <Route path="/workspace/staff" element={<ProtectedRoute permission="team.view"><StaffPage /></ProtectedRoute>} />
        <Route path="/management" element={<ProtectedRoute permission="team.view"><ManagementPage /></ProtectedRoute>} />
        <Route path="/workspace/ad-analysis" element={<ProtectedRoute><AdAnalysisPage /></ProtectedRoute>} />
        <Route path="/workspace/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
        <Route path="/workspace/fixed-file" element={<ProtectedRoute><FixedFilePage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <GlobalSyncBanner />
    </>
  );
}

export default function App() {
  useEffect(() => {
    const cleanup = initWorkTrackerListeners();
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
