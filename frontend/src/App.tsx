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
import AccountEmailPage from './pages/settings/AccountEmailPage'
import AccountPasswordPage from './pages/settings/AccountPasswordPage'
import AccountAvatarPage from './pages/settings/AccountAvatarPage.tsx'
import ForgotPassword from './pages/auth/ForgotPassword'
import ResetPassword from './pages/auth/ResetPassword'
import LogoutSuccess from './pages/auth/LogoutSuccess'
import OAuthCallback from './pages/auth/OAuthCallback'
import LinkCallback from './pages/auth/LinkCallback'
import Payment from './pages/subscription/payment'
import PlatformAdminDashboard from './pages/PlatformAdmin/dashboard'
import FlaggedResponsePage from './pages/PlatformAdmin/FlaggedResponse' 
import AdminEducation from './pages/admin/AdminEducation'
// import NewsContent from './components/Discover/NewsContent/NewsContent'
import InstituteVerification from './pages/subscription/InstituteVerification.tsx'
import PreferenceSelect from './pages/onboarding/PreferenceSelect'


const MIC_STORAGE_KEY = 'askvox.micEnabled'


function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPaid, setIsPaid] = useState<boolean>(false)
  const [isAdmin, setIsAdmin] = useState<boolean>(false)
  const [needsPreference, setNeedsPreference] = useState<boolean>(false)
  const [micEnabled, setMicEnabled] = useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem(MIC_STORAGE_KEY)
      if (raw === null) return false
      return raw === 'true'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(MIC_STORAGE_KEY, String(micEnabled))
    } catch (err) {
      void err
    }
  }, [micEnabled])

  useEffect(() => {
    let cancelled = false

    const checkPaid = async (userId: string) => {
      try {
        const [subRes, profileRes] = await Promise.all([
          supabase
            .from('subscriptions')
            .select('is_active,end_date')
            .eq('user_id', userId)
            .order('end_date', { ascending: false })
            .limit(1)
            .maybeSingle(),
          // Allow manual override: profiles.role = 'paid_user'
          supabase
            .from('profiles')
            .select('role')
            .eq('id', userId)
            .maybeSingle(),
        ])

        const subPaid = Boolean(subRes?.data?.is_active)
        const rawRole = (profileRes?.data as any)?.role
        const role = (rawRole ?? '').toString().trim().toLowerCase()
        const rolePaid = role === 'paid_user' || role === 'paid'

        if (!cancelled) setIsPaid(subPaid || rolePaid)
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

    const checkPreference = async (userId: string) => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('learning_preference')
          .eq('id', userId)
          .maybeSingle()
        const pref = (data?.learning_preference ?? '').toString().trim().toLowerCase()
        const missing = !(pref === 'secondary' || pref === 'tertiary' || pref === 'university' || pref === 'leisure')
        if (!cancelled) setNeedsPreference(missing)
      } catch {
        if (!cancelled) setNeedsPreference(true)
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
        checkPreference(session.user.id)
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
        checkPreference(session.user.id)
      }
      else {
        setIsPaid(false)
        setIsAdmin(false)
      }
    })

    return () => { cancelled = true; subscription.unsubscribe() }
  }, [])

  // Clean up stray empty hash fragments from placeholder links
  useEffect(() => {
    try {
      if (window.location && window.location.hash === '#') {
        window.history.replaceState(null, '', window.location.pathname)
      }
    } catch (err) {
      void err
    }
  }, [loading])

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
        {/* Root: if logged in, land on New Chat (gate onboarding only for brand new users) */}
        <Route
          path="/"
          element={
            session
              ? (isAdmin ? <Navigate to="/platformadmin/dashboard" /> : (needsPreference ? <Navigate to="/onboarding/preferences" /> : <Navigate to="/newchat" />))
              : <UnregisteredMain session={session} micEnabled={micEnabled} setMicEnabled={setMicEnabled} />
          }
        />

        {/* Auth Routes: Redirect to role-aware destination if already logged in */}
        <Route path="/login" element={!session ? <Login /> : (isAdmin ? <Navigate to="/platformadmin/dashboard" /> : (needsPreference ? <Navigate to="/onboarding/preferences" /> : <Navigate to="/newchat" />))} />
        <Route path="/register" element={!session ? <Register /> : (isAdmin ? <Navigate to="/platformadmin/dashboard" /> : (needsPreference ? <Navigate to="/onboarding/preferences" /> : <Navigate to="/newchat" />))} />
        <Route path="/auth/confirmed" element={<ConfirmedPage />} />
        <Route path="/auth/check-email" element={<CheckEmailPage />} />
        <Route path="/auth/oauth-callback" element={<OAuthCallback />} />
        <Route path="/auth/link-callback" element={<LinkCallback />} />

        {/* Protected Route */}
        <Route
          path="/reguserhome"
          element={
            session ? (
              isAdmin ? (
                <Navigate to="/platformadmin/dashboard" />
              ) : needsPreference ? (
                <Navigate to="/onboarding/preferences" />
              ) : isPaid ? (
                <PaidMain session={session} micEnabled={micEnabled} setMicEnabled={setMicEnabled} />
              ) : (
                <RegisterMain session={session} micEnabled={micEnabled} setMicEnabled={setMicEnabled} />
              )
            ) : (
              <UnregisteredMain session={session} micEnabled={micEnabled} setMicEnabled={setMicEnabled} />
            )
          }
        />
        {/* New Chat route */}
        <Route
          path="/newchat"
          element={
            session
              ? (
                  isAdmin ? (
                    <Navigate to="/platformadmin/dashboard" />
                  ) : isPaid ? (
                    <PaidMain session={session} micEnabled={micEnabled} setMicEnabled={setMicEnabled} />
                  ) : (
                    <RegisterMain session={session} micEnabled={micEnabled} setMicEnabled={setMicEnabled} />
                  )
                )
              : <Navigate to="/login" />
          }
        />
        {/* Back-compat: redirect old /chats/new to /newchat */}
        <Route path="/chats/new" element={<Navigate to="/newchat" replace />} />
        {/* Explicit chat routes for deep-linking a session */}
        <Route
          path="/chats/:sessionId"
          element={
            session
              ? (
                  isAdmin ? (
                    <Navigate to="/platformadmin/dashboard" />
                  ) : isPaid ? (
                    <PaidMain session={session} micEnabled={micEnabled} setMicEnabled={setMicEnabled} />
                  ) : (
                    <RegisterMain session={session} micEnabled={micEnabled} setMicEnabled={setMicEnabled} />
                  )
                )
              : <Navigate to="/login" />
          }
        />
        <Route
          path="/paiduserhome"
          element={session ? (isAdmin ? <Navigate to="/platformadmin/dashboard" /> : <PaidMain session={session} micEnabled={micEnabled} setMicEnabled={setMicEnabled} />) : <Navigate to="/login" />}
        />
        <Route
          path="/discover"
          element={session ? <RegisterMain session={session} paid={isPaid} initialTab="discover" micEnabled={micEnabled} setMicEnabled={setMicEnabled} /> : <Navigate to="/login" />}
        />
        {/* Discover → Detailed News Content (render within RegisteredMain to avoid layout flash) */}
        <Route
          path="/discover/news/:id"
          element={session ? <RegisterMain session={session} paid={isPaid} initialTab="discover" micEnabled={micEnabled} setMicEnabled={setMicEnabled} /> : <Navigate to="/login" />}
        />
        <Route
          path="/discover/news"
          element={session ? <RegisterMain session={session} paid={isPaid} initialTab="discover" micEnabled={micEnabled} setMicEnabled={setMicEnabled} /> : <Navigate to="/login" />}
        />
        
        <Route 
          path="/upgrade"
          element={session ? <Upgrade /> : <Navigate to="/login" />}
        />
        {/* Onboarding: Learning Preference */}
        <Route
          path="/onboarding/preferences"
          element={session ? (isAdmin ? <Navigate to="/platformadmin/dashboard" /> : <PreferenceSelect session={session} />) : <Navigate to="/login" />}
        />
        <Route
          path="/settings/account"
          element={
            session
              ? (
                  isAdmin ? (
                    <AccountSettingsPage session={session} isAdmin={isAdmin} />
                  ) : (
                    <RegisterMain session={session} paid={isPaid} initialTab="settings" micEnabled={micEnabled} setMicEnabled={setMicEnabled} />
                  )
                )
              : <Navigate to="/login" />
          }
        />
        <Route
          path="/settings/account/email"
          element={
            session
              ? (
                  isAdmin ? (
                    <AccountEmailPage session={session} isAdmin={isAdmin} />
                  ) : (
                    <RegisterMain session={session} paid={isPaid} initialTab="settings" micEnabled={micEnabled} setMicEnabled={setMicEnabled} />
                  )
                )
              : <Navigate to="/login" />
          }
        />
        <Route
          path="/settings/account/password"
          element={
            session
              ? (
                  isAdmin ? (
                    <AccountPasswordPage session={session} isAdmin={isAdmin} />
                  ) : (
                    <RegisterMain session={session} paid={isPaid} initialTab="settings" micEnabled={micEnabled} setMicEnabled={setMicEnabled} />
                  )
                )
              : <Navigate to="/login" />
          }
        />
        <Route
          path="/settings/account/avatar"
          element={
            session
              ? (
                  isAdmin ? (
                    <AccountAvatarPage session={session} isAdmin={isAdmin} />
                  ) : (
                    <RegisterMain session={session} paid={isPaid} initialTab="settings" micEnabled={micEnabled} setMicEnabled={setMicEnabled} />
                  )
                )
              : <Navigate to="/login" />
          }
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
