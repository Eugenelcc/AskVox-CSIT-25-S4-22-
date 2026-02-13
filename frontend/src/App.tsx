import { useEffect, useRef, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './supabaseClient'
import type { Session } from '@supabase/supabase-js'

import Background from './components/background/background'

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
import EducationInstitutionalHome from './pages/educationalinstutiaonal/homepage'


const MIC_STORAGE_KEY = 'askvox.micEnabled'


function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPaid, setIsPaid] = useState<boolean>(false)
  const [isAdmin, setIsAdmin] = useState<boolean>(false)
  const [isEducationalUser, setIsEducationalUser] = useState<boolean>(false)
  const [roleLoaded, setRoleLoaded] = useState<boolean>(false)
  const [needsPreference, setNeedsPreference] = useState<boolean>(false)
  const lastUserIdRef = useRef<string | null>(null)
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

    const checkRole = async (userId: string) => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', userId)
          .maybeSingle()

        const role = (data?.role ?? '').toString().trim().toLowerCase()
        if (cancelled) return
        setIsAdmin(role === 'platform_admin')
        setIsEducationalUser(role === 'educational_user')
      } catch {
        if (cancelled) return
        setIsAdmin(false)
        setIsEducationalUser(false)
      } finally {
        if (!cancelled) setRoleLoaded(true)
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
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (cancelled) return
        setSession(session)
        if (session?.user?.id) {
          lastUserIdRef.current = session.user.id
          // reset admin flag for new session; checkAdmin will promote if needed
          setIsAdmin(false)
          setIsEducationalUser(false)
          setRoleLoaded(false)
          checkPaid(session.user.id)
          checkRole(session.user.id)
          checkPreference(session.user.id)
        } else {
          lastUserIdRef.current = null
          setIsPaid(false)
          setIsAdmin(false)
          setIsEducationalUser(false)
          setRoleLoaded(true)
        }
      } catch {
        if (cancelled) return
        setSession(null)
        lastUserIdRef.current = null
        setIsPaid(false)
        setIsAdmin(false)
        setIsEducationalUser(false)
        setRoleLoaded(true)
        setNeedsPreference(false)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      setSession(session)

      const nextUserId = session?.user?.id ?? null
      const prevUserId = lastUserIdRef.current

      if (!nextUserId) {
        // Signed out
        lastUserIdRef.current = null
        setIsPaid(false)
        setIsAdmin(false)
        setIsEducationalUser(false)
        setRoleLoaded(true)
        return
      }

      // User switched or first time seeing a user in this session
      const userChanged = prevUserId !== nextUserId
      if (userChanged) {
        lastUserIdRef.current = nextUserId
        setIsAdmin(false)
        setIsEducationalUser(false)
        setRoleLoaded(false)
        checkPaid(nextUserId)
        checkRole(nextUserId)
        checkPreference(nextUserId)
        return
      }

      // Same user: avoid role/preference flicker on background token refresh.
      // Supabase emits TOKEN_REFRESHED when tab regains focus.
      if (event === 'TOKEN_REFRESHED') {
        return
      }

      // Same user: for other events (e.g. SIGNED_IN/USER_UPDATED), refresh flags
      // without blocking the UI. This prevents the full-screen loading gate from
      // flashing when the browser tab regains focus.
      checkPaid(nextUserId)
      checkRole(nextUserId)
      checkPreference(nextUserId)
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
      <div style={{ minHeight: '100dvh', position: 'relative' }}>
        <Background />
        <div style={{ color: 'white', textAlign: 'center', marginTop: '50vh' }}>
          Loading AskVox...
        </div>
      </div>
    )
  }

  // Prevent role-based redirect flicker on refresh: wait until role is resolved.
  if (session && !roleLoaded) {
    return (
      <div style={{ minHeight: '100dvh', position: 'relative' }}>
        <Background />
        <div style={{ color: 'white', textAlign: 'center', marginTop: '50vh' }}>
          Loading AskVox...
        </div>
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
              ? (isAdmin
                  ? <Navigate to="/platformadmin/dashboard" />
                  : (isEducationalUser
                      ? <Navigate to="/educationInstitutional" />
                      : (needsPreference
                          ? <Navigate to="/onboarding/preferences" />
                          : <Navigate to="/newchat" />
                        )
                    )
                )
              : <UnregisteredMain session={session} micEnabled={micEnabled} setMicEnabled={setMicEnabled} />
          }
        />

        {/* Auth Routes: Redirect to role-aware destination if already logged in */}
        <Route
          path="/login"
          element={!session
            ? <Login />
            : (isAdmin
                ? <Navigate to="/platformadmin/dashboard" />
                : (isEducationalUser
                    ? <Navigate to="/educationInstitutional" />
                    : (needsPreference
                        ? <Navigate to="/onboarding/preferences" />
                        : <Navigate to="/newchat" />
                      )
                  )
              )
          }
        />
        <Route
          path="/register"
          element={!session
            ? <Register />
            : (isAdmin
                ? <Navigate to="/platformadmin/dashboard" />
                : (isEducationalUser
                    ? <Navigate to="/educationInstitutional" />
                    : (needsPreference
                        ? <Navigate to="/onboarding/preferences" />
                        : <Navigate to="/newchat" />
                      )
                  )
              )
          }
        />
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
              ) : isEducationalUser ? (
                <Navigate to="/educationInstitutional" />
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
                  ) : isEducationalUser ? (
                    <Navigate to="/educationInstitutional" />
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
                  ) : isEducationalUser ? (
                    <Navigate to="/educationInstitutional" />
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
          element={session
            ? (isAdmin
                ? <Navigate to="/platformadmin/dashboard" />
                : (isEducationalUser
                    ? <Navigate to="/educationInstitutional" />
                    : <PaidMain session={session} micEnabled={micEnabled} setMicEnabled={setMicEnabled} />
                  )
              )
            : <Navigate to="/login" />
          }
        />
        <Route
          path="/discover"
          element={session
            ? (isAdmin
                ? <Navigate to="/platformadmin/dashboard" />
                : (isEducationalUser
                    ? <Navigate to="/educationInstitutional" />
                    : <RegisterMain session={session} paid={isPaid} initialTab="discover" micEnabled={micEnabled} setMicEnabled={setMicEnabled} />
                  )
              )
            : <Navigate to="/login" />
          }
        />
        {/* Discover → Detailed News Content (render within RegisteredMain to avoid layout flash) */}
        <Route
          path="/discover/news/:id"
          element={session
            ? (isAdmin
                ? <Navigate to="/platformadmin/dashboard" />
                : (isEducationalUser
                    ? <Navigate to="/educationInstitutional" />
                    : <RegisterMain session={session} paid={isPaid} initialTab="discover" micEnabled={micEnabled} setMicEnabled={setMicEnabled} />
                  )
              )
            : <Navigate to="/login" />
          }
        />
        <Route
          path="/discover/news"
          element={session
            ? (isAdmin
                ? <Navigate to="/platformadmin/dashboard" />
                : (isEducationalUser
                    ? <Navigate to="/educationInstitutional" />
                    : <RegisterMain session={session} paid={isPaid} initialTab="discover" micEnabled={micEnabled} setMicEnabled={setMicEnabled} />
                  )
              )
            : <Navigate to="/login" />
          }
        />
        
        <Route 
          path="/upgrade"
          element={session ? <Upgrade /> : <Navigate to="/login" />}
        />
        {/* Onboarding: Learning Preference */}
        <Route
          path="/onboarding/preferences"
          element={session
            ? (isAdmin
                ? <Navigate to="/platformadmin/dashboard" />
                : (isEducationalUser
                    ? <Navigate to="/educationInstitutional" />
                    : <PreferenceSelect session={session} />
                  )
              )
            : <Navigate to="/login" />
          }
        />

        {/* ✅ Educational Institutional Route */}
        <Route
          path="/educationInstitutional"
          element={
            session
              ? (
                  isAdmin ? (
                    <Navigate to="/platformadmin/dashboard" />
                  ) : isEducationalUser ? (
                    <EducationInstitutionalHome />
                  ) : needsPreference ? (
                    <Navigate to="/onboarding/preferences" />
                  ) : (
                    <Navigate to="/newchat" />
                  )
                )
              : <Navigate to="/login" />
          }
        />
        {/* Educational User Settings Route */}
        <Route
          path="/educationaluser/settings"
          element={
            session
              ? (
                  isEducationalUser ? (
                    <RegisterMain session={session} paid={false} initialTab="settings" micEnabled={micEnabled} setMicEnabled={setMicEnabled} sidebarVariant="educational" />
                  ) : (
                    <Navigate to="/newchat" />
                  )
                )
              : <Navigate to="/login" />
          }
        />
        <Route
          path="/settings/account"
          element={
            session
              ? (
                  isAdmin ? (
                    <AccountSettingsPage session={session} isAdmin={isAdmin} />
                  ) : isEducationalUser ? (
                    <AccountSettingsPage session={session} isAdmin={false} sidebarVariant="educational" />
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
                  ) : isEducationalUser ? (
                    <AccountEmailPage session={session} isAdmin={false} sidebarVariant="educational" />
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
                  ) : isEducationalUser ? (
                    <AccountPasswordPage session={session} isAdmin={false} sidebarVariant="educational" />
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
                  ) : isEducationalUser ? (
                    <AccountAvatarPage session={session} isAdmin={false} sidebarVariant="educational" />
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
