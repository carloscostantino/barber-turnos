import { useEffect, useState, type ReactNode } from 'react'
import {
  createBrowserRouter,
  Navigate,
  NavLink,
  Outlet,
  RouterProvider,
  useParams,
} from 'react-router-dom'
import { DEFAULT_SHOP_SLUG, shopPublicPath } from './config'
import AdminPanel from './pages/AdminPanel'
import BookingPage from './pages/BookingPage'
import CancelBookingPage from './pages/CancelBookingPage'
import HomePage from './pages/HomePage'
import RegisterShopPage from './pages/RegisterShopPage'
import SystemLogin from './pages/SystemLogin'
import SystemPanel from './pages/SystemPanel'
import { getSystemAdminToken } from './systemAdminToken'

function RequireSystemAdmin({ children }: { children: ReactNode }) {
  const token = getSystemAdminToken()
  if (!token) return <Navigate to="/system/login" replace />
  return <>{children}</>
}

function NavShopBrand() {
  const { shopSlug } = useParams()
  const slug = shopSlug ?? DEFAULT_SHOP_SLUG
  const [label, setLabel] = useState('Barbería')
  useEffect(() => {
    void fetch(shopPublicPath(slug, 'public-settings'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { shopName?: string | null } | null) => {
        const n = d?.shopName?.trim()
        if (n) setLabel(n)
      })
      .catch(() => {})
  }, [slug])
  return (
    <NavLink to={`/s/${slug}`} end className={navClass} title={label}>
      <span className="inline-block truncate max-w-[12rem] sm:max-w-md align-middle">
        {label}
      </span>
    </NavLink>
  )
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
    isActive
      ? 'bg-slate-800 text-white'
      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
  }`

function Layout() {
  const { shopSlug } = useParams()
  const base = `/s/${shopSlug ?? DEFAULT_SHOP_SLUG}`
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
      <nav className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-10 shrink-0">
        <div className="max-w-6xl mx-auto px-4 flex flex-wrap items-center gap-2 py-3">
          <NavLink to="/" className={navClass} end>
            Inicio
          </NavLink>
          <NavShopBrand />
          <NavLink to={base} end className={navClass}>
            Reservar
          </NavLink>
          <NavLink to={`${base}/admin`} className={navClass}>
            Panel admin
          </NavLink>
          <NavLink to="/register" className={navClass}>
            Registrar barbería
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
    element: <HomePage />,
  },
  {
    path: '/register',
    element: <RegisterShopPage />,
  },
  {
    path: '/system/login',
    element: <SystemLogin />,
  },
  {
    path: '/system',
    element: (
      <RequireSystemAdmin>
        <SystemPanel />
      </RequireSystemAdmin>
    ),
  },
  {
    path: '/s/:shopSlug',
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
