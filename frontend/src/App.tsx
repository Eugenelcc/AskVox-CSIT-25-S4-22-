import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './supabaseClient'
import type { Session } from '@supabase/supabase-js'

import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import ConfirmedPage from './pages/auth/Confirmed'
import CheckEmailPage from './pages/auth/CheckEmail'
import RegisterMain from './pages/RegisteredMain'
import PaidMain from './pages/PaidMain'
import UnregisteredMain from './pages/UnregisteredMain'
import Upgrade from './pages/subscription/subscription_detail'
import AccountSettingsPage from './pages/settings/AccountSettingsPage'
import ForgotPassword from './pages/auth/ForgotPassword'
import ResetPassword from './pages/auth/ResetPassword'
import LogoutSuccess from './pages/auth/LogoutSuccess'
import Payment from './pages/subscription/payment'
import PlatformAdminDashboard from './pages/PlatformAdmin/dashboard'
import FlaggedResponsePage from './pages/PlatformAdmin/FlaggedResponse' 
import AdminEducation from './pages/admin/AdminEducation'
import NewsContent from './components/Discover/NewsContent/NewsContent'
import InstituteVerification from './pages/subscription/InstituteVerification.tsx'


function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPaid, setIsPaid] = useState<boolean>(false)
  const [isAdmin, setIsAdmin] = useState<boolean>(false)

  useEffect(() => {
    let cancelled = false

    const checkPaid = async (userId: string) => {
      try {
        const { data } = await supabase
          .from('subscriptions')
          .select('is_active,end_date')
          .eq('user_id', userId)
          .order('end_date', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (!cancelled) setIsPaid(Boolean(data?.is_active))
      } catch {
        if (!cancelled) setIsPaid(false)
      }
    }

    const checkAdmin = async (userId: string) => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', userId)
          .maybeSingle()
        const role = (data?.role ?? '').toString().trim().toLowerCase()
        if (!cancelled) setIsAdmin(role === 'platform_admin')
      } catch {
        if (!cancelled) setIsAdmin(false)
      }
    }

    // Boot: do not block UI on paid check
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
      setSession(session)
      setLoading(false)
      if (session?.user?.id) {
        // reset admin flag for new session; checkAdmin will promote if needed
        setIsAdmin(false)
        checkPaid(session.user.id)
        checkAdmin(session.user.id)
      }
      else {
        setIsPaid(false)
        setIsAdmin(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return
      setSession(session)
      if (session?.user?.id) {
        // new login: start as non-admin until profile says otherwise
        setIsAdmin(false)
        checkPaid(session.user.id)
        checkAdmin(session.user.id)
      }
      else {
        setIsPaid(false)
        setIsAdmin(false)
      }
    })

    return () => { cancelled = true; subscription.unsubscribe() }
  }, [])

  if (loading) {
    return (
      <div style={{ color: 'white', textAlign: 'center', marginTop: '50vh' }}>
        Loading AskVox...
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Root: if logged in, route based on subscription */}
        <Route
          path="/"
          element={
            session
              ? (isAdmin ? <Navigate to="/platformadmin/dashboard" /> : (isPaid ? <Navigate to="/paiduserhome" /> : <Navigate to="/reguserhome" />))
              : <UnregisteredMain session={session} />
          }
        />

        {/* Auth Routes: Redirect to role-aware destination if already logged in */}
        <Route path="/login" element={!session ? <Login /> : <Navigate to={isAdmin ? "/platformadmin/dashboard" : (isPaid ? "/paiduserhome" : "/reguserhome")} />} />
        <Route path="/register" element={!session ? <Register /> : <Navigate to={isAdmin ? "/platformadmin/dashboard" : (isPaid ? "/paiduserhome" : "/reguserhome")} />} />
        <Route path="/auth/confirmed" element={<ConfirmedPage />} />
        <Route path="/auth/check-email" element={<CheckEmailPage />} />

        {/* Protected Route */}
        <Route
          path="/reguserhome"
          element={
            session
              ? (isAdmin
                  ? <Navigate to="/platformadmin/dashboard" />
                  : (isPaid ? <PaidMain session={session} /> : <RegisterMain session={session} />))
              : <UnregisteredMain session={session} />
          }
        />
        <Route
          path="/paiduserhome"
          element={session ? (isAdmin ? <Navigate to="/platformadmin/dashboard" /> : <PaidMain session={session} />) : <Navigate to="/login" />}
        />
        <Route
          path="/discover"
          element={session ? <RegisterMain session={session} paid={isPaid} initialTab="discover" /> : <Navigate to="/login" />}
        />
        {/* Discover → Detailed News Content */}
        <Route
          path="/discover/news/:id"
          element={session ? <NewsContent /> : <Navigate to="/login" />}
        />
        <Route
          path="/discover/news"
          element={session ? <NewsContent /> : <Navigate to="/login" />}
        />
        
        <Route 
          path="/upgrade"
          element={session ? <Upgrade /> : <Navigate to="/login" />}
        />
        <Route
          path="/settings/account"
          element={session ? <AccountSettingsPage session={session} isAdmin={isAdmin} /> : <Navigate to="/login" />}
        />
        {/* Legacy admin routes removed; use Platform Admin routes below */}
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/logout-success" element={<LogoutSuccess />} />

        <Route
          path="/payment"
          element={session ? <Payment /> : <Navigate to="/login" />}
        />

        {/* ✅ Platform Admin Routes */}
        <Route path="/platformadmin/dashboard" element={<PlatformAdminDashboard />} />
        <Route path="/platformadmin/flagged" element={<FlaggedResponsePage />} />
        <Route path="/platformadmin/education" element={session ? <AdminEducation /> : <Navigate to="/login" />} />
        <Route 
          path="/institute-verification"
          element={session ? <InstituteVerification /> : <Navigate to="/login" />}
        />
      </Routes>
    </BrowserRouter>
  )
}

export default App
