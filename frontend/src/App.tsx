import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './supabaseClient'
import type { Session } from '@supabase/supabase-js'
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import RegisterMain from './pages/RegisteredMain'
import UnregisteredMain from './pages/UnregisteredMain'
import Upgrade from './pages/subscription/subscription_detail'
import AccountDetails from './pages/settings/AccountDetails'; 
// import EditProfileName from "./pages/settings/EditProfileName";
// import EditEmail from "./pages/settings/EditEmail";
// import EditDob from "./pages/settings/EditDob";
// import EditGender from "./pages/settings/EditGender";
// import EditAvatar from "./pages/settings/EditAvatar";
// import ChangePassword from "./pages/settings/ChangePassword";


function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      // Redirect to login on sign-out
      if (event === 'SIGNED_OUT') {
        // Optional: clear any local app state here
      }
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
        <Route path="/login" element={!session ? <Login /> : <Navigate to="/reguserhome" />} />
        <Route path="/register" element={!session ? <Register /> : <Navigate to="/reguserhome" />} />
        
        {/* Protected Route */}
        <Route 
          path="/reguserhome" 
          element={session ? <RegisterMain session={session} /> : <UnregisteredMain session={session} />}
        />
        <Route 
          path="/upgrade"
          element={session ? <Upgrade /> : <Navigate to="/login" />}
        />
        <Route path="/settings/account" element={session ? <AccountDetails session={session} /> : <Navigate to="/login" />} />


      </Routes>
    </BrowserRouter>
  )
}

export default App