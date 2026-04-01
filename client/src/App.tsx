import { useEffect, useState } from 'react'
import {
  createBrowserRouter,
  NavLink,
  Outlet,
  RouterProvider,
} from 'react-router-dom'
import { API_BASE } from './config'
import AdminPanel from './pages/AdminPanel'
import BookingPage from './pages/BookingPage'
import CancelBookingPage from './pages/CancelBookingPage'

function NavShopBrand() {
  const [label, setLabel] = useState('Barbería')
  useEffect(() => {
    void fetch(`${API_BASE}/public-settings`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { shopName?: string | null } | null) => {
        const n = d?.shopName?.trim()
        if (n) setLabel(n)
      })
      .catch(() => {})
  }, [])
  return (
    <span
      className="text-slate-400 text-sm font-medium mr-2 truncate max-w-[12rem] sm:max-w-md"
      title={label}
    >
      {label}
    </span>
  )
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
    isActive
      ? 'bg-slate-800 text-white'
      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
  }`

function Layout() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
      <nav className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-10 shrink-0">
        <div className="max-w-6xl mx-auto px-4 flex flex-wrap items-center gap-2 py-3">
          <NavShopBrand />
          <NavLink to="/" end className={navClass}>
            Reservar
          </NavLink>
          <NavLink to="/admin" className={navClass}>
            Panel admin
          </NavLink>
        </div>
      </nav>
      <main className="flex-1 flex flex-col min-h-0 w-full">
        <Outlet />
      </main>
    </div>
  )
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <BookingPage /> },
      { path: 'cancelar', element: <CancelBookingPage /> },
      { path: 'admin', element: <AdminPanel /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
