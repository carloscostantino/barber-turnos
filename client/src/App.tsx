import { NavLink, Route, Routes, BrowserRouter } from 'react-router-dom'
import AdminPanel from './pages/AdminPanel'
import BookingPage from './pages/BookingPage'

const navClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
    isActive
      ? 'bg-slate-800 text-white'
      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
  }`

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-950 text-slate-50">
        <nav className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-4 flex flex-wrap items-center gap-2 py-3">
            <span className="text-slate-500 text-xs uppercase tracking-wider mr-2">
              Barbería
            </span>
            <NavLink to="/" end className={navClass}>
              Reservar
            </NavLink>
            <NavLink to="/admin" className={navClass}>
              Panel admin
            </NavLink>
          </div>
        </nav>
        <Routes>
          <Route path="/" element={<BookingPage />} />
          <Route path="/admin" element={<AdminPanel />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
