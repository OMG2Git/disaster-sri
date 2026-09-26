import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { TopNav } from './components/Nav';
import { DisasterDetailPage } from './pages/DisasterDetailPage';
import { DisastersPage } from './pages/DisastersPage';
import { LoginPage, RegisterPage } from './pages/AuthPages';

export default function App() {
  const { pathname } = useLocation();
  const isAuthPage = pathname === '/login' || pathname === '/register';

  return (
    <div className="min-h-screen">
      {!isAuthPage && <TopNav />}
      {/* Keyed on the path so each navigation replays the entrance transition */}
      <div key={pathname} className="animate-page">
        {isAuthPage ? (
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
          </Routes>
        ) : (
          <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
            <Routes>
              <Route path="/" element={<DisastersPage />} />
              <Route path="/disasters/:id" element={<DisasterDetailPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        )}
      </div>
    </div>
  );
}
