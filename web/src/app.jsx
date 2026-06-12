import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { Splash } from './pages/Splash.jsx';
import { Menu } from './pages/Menu.jsx';
import { Maps } from './pages/Maps.jsx';
import { Detection } from './pages/Detection.jsx';
import { Chatbot } from './pages/Chatbot.jsx';

// Keyed wrapper: remount on path change replays the fade-up enter animation.
function AnimatedRoutes() {
  const location = useLocation();
  return (
    <div key={location.pathname} className="h-full animate-fade-up">
      <Routes location={location}>
        <Route path="/" element={<Splash />} />
        <Route path="/menu" element={<Menu />} />
        <Route path="/maps" element={<Maps />} />
        <Route path="/detection" element={<Detection />} />
        <Route path="/chatbot" element={<Chatbot />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AnimatedRoutes />
    </BrowserRouter>
  );
}
