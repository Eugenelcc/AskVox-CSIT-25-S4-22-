import EducationalHomepage from './pages/educationalinstutiaonal/homepage'
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
import AccountDetails from './pages/settings/AccountDetails'
import ForgotPassword from './pages/auth/ForgotPassword'
import ResetPassword from './pages/auth/ResetPassword'
import LogoutSuccess from './pages/auth/LogoutSuccess'
import Payment from './pages/subscription/payment'

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPaid, setIsPaid] = useState<boolean>(false)

  // ✅ ADD
  const [role, setRole] = useState<string | null>(null)

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

    // ✅ ADD
    const loadRole = async (userId: string) => {
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single()
      if (!cancelled) setRole(data?.role ?? null)
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
      setSession(session)
      setLoading(false)

      if (session?.user?.id) {
        checkPaid(session.user.id)
        loadRole(session.user.id) // ✅ ADD
      } else {
        setIsPaid(false)
        setRole(null)
      }
    })

    const { data: { subscription } } =
      supabase.auth.onAuthStateChange((_event, session) => {
        if (cancelled) return
        setSession(session)

        if (session?.user?.id) {
          checkPaid(session.user.id)
          loadRole(session.user.id) // ✅ ADD
        } else {
          setIsPaid(false)
          setRole(null)
        }
      })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  if (loading)
    return (
      <div style={{ color: 'white', textAlign: 'center', marginTop: '50vh' }}>
        Loading AskVox...
      </div>
    )

  return (
    <BrowserRouter>
      <Routes>
        {/* ✅ FIXED ROOT REDIRECT */}
        <Route
          path="/"
          element={
            session
              ? role === 'educational_user'
                ? <Navigate to="/educationalinstutiaonal/homepage" />
                : isPaid
                  ? <Navigate to="/paiduserhome" />
                  : <Navigate to="/reguserhome" />
              : <UnregisteredMain session={session} />
          }
        />

        {/* Auth Routes */}
        <Route
          path="/login"
          element={
            !session
              ? <Login />
              : role === 'educational_user'
                ? <Navigate to="/educationalinstutiaonal/homepage" />
                : <Navigate to={isPaid ? '/paiduserhome' : '/reguserhome'} />
          }
        />

        <Route
          path="/register"
          element={
            !session
              ? <Register />
              : role === 'educational_user'
                ? <Navigate to="/educationalinstutiaonal/homepage" />
                : <Navigate to={isPaid ? '/paiduserhome' : '/reguserhome'} />
          }
        />

        <Route path="/auth/confirmed" element={<ConfirmedPage />} />
        <Route path="/auth/check-email" element={<CheckEmailPage />} />

        <Route
          path="/reguserhome"
          element={
            session
              ? role === 'educational_user'
                ? <Navigate to="/educationalinstutiaonal/homepage" replace />
                : isPaid
                  ? <PaidMain session={session} />
                  : <RegisterMain session={session} />
              : <UnregisteredMain session={session} />
          }


        />

        <Route
          path="/paiduserhome"
          element={session ? <PaidMain session={session} /> : <Navigate to="/login" />}
        />

        <Route
          path="/upgrade"
          element={session ? <Upgrade /> : <Navigate to="/login" />}
        />

        <Route
          path="/educationalinstutiaonal/homepage"
          element={<EducationalHomepage />}
        />

        <Route
          path="/settings/account"
          element={session ? <AccountDetails session={session} /> : <Navigate to="/login" />}
        />

        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/logout-success" element={<LogoutSuccess />} />

        <Route
          path="/payment"
          element={session ? <Payment /> : <Navigate to="/login" />}
        />
      </Routes>
    </BrowserRouter>
  )
}

export default App
