// client/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

// Layouts and Pages
import LoginPage from './pages/LoginPages';
import HomePage from './pages/HomePage';
import MainLayout from './components/MainLayout';
import ProtectedRoute from './components/ProtectedRoute';
import ApplicationPage from './pages/ApplicationPage';
import RankingPage from './pages/RankingPage';
import SelectionWorkspacePage from './pages/SelectionWorkspacePage';


function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        {/* Protected Routes */}
        <Route 
          path="/" 
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          {/* Default protected route is home */}
          <Route index element={<Navigate to="/home" />} />
          <Route path="home" element={<HomePage />} />
          <Route path="apply" element={<ApplicationPage />} />
          <Route path="rank" element={<RankingPage />} />
          <Route path="workspace" element={<SelectionWorkspacePage />} />
        </Route>

      </Routes>
    </BrowserRouter>
  );
}

export default App;
