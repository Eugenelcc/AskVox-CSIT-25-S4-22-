import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './supabaseClient'
import type { Session } from '@supabase/supabase-js'
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import RegisterMain from './pages/RegisteredMain'
import UnregisteredMain from './pages/UnregisteredMain'

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) return <div style={{color: 'white', textAlign: 'center', marginTop: '50vh'}}>Loading AskVox...</div>

  return (
    <BrowserRouter>
      <Routes>
        {/* REQUEST: Root is always UnregisteredMain (Public Demo) */}
        <Route path="/" element={<UnregisteredMain session={session} />} />
        
        {/* Auth Routes: Redirect to Dashboard if already logged in */}
        <Route path="/login" element={!session ? <Login /> : <Navigate to="/dashboard" />} />
        <Route path="/register" element={!session ? <Register /> : <Navigate to="/dashboard" />} />
        
        {/* Protected Route */}
        <Route 
          path="/dashboard" 
          element={session ? <RegisterMain session={session} /> : <Navigate to="/login" />} 
        />
      </Routes>
    </BrowserRouter>
  )
}

export default App