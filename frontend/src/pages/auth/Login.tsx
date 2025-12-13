import { useState, type FormEvent } from 'react' 
import { supabase } from '../../supabaseClient'
import { Link, useNavigate } from 'react-router-dom'
import '../cssfiles/UnregisteredMain.css' 
import styles from '../cssfiles/Login.module.css' 
import Background from '../../components/background/background'
import AskVoxLogo from '../../components/TopBars/AskVox.png' 

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      alert(error.message)
    } else {
      // Go to dashboard after successful login
      navigate('/dashboard')
    }
    
    setLoading(false)
  }

  const handleGoogleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
      },
    })
    if (error) alert(error.message)
  }

  return (
    <div className="uv-root">
      <Background />
      {/* ✅ Added Global Class: uv-responsive-container */}
      <div className={`${styles.loginContainer} uv-responsive-container`}>
        
        {/* ✅ Added Global Class: uv-responsive-form */}
        <div className={`${styles.loginForm} uv-responsive-form`}>
          <img src={AskVoxLogo} alt="AskVox" className={styles.logo} />
          
          {/* ✅ Added Global Class: uv-responsive-text */}
          <h2 className={`${styles.title} uv-responsive-text`}>WELCOME BACK</h2>
          <p className={styles.subtitle}>Please enter your details</p>

          <button onClick={handleGoogleLogin} className={styles.googleButton}>
            <img 
              src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" 
              alt="Google" 
              className={styles.googleLogo} 
            />
            Sign in with Google
          </button>
          
          <div className={styles.divider}>
            <div className={styles.dividerLine}></div>
            <span className={styles.dividerText}>or</span>
            <div className={styles.dividerLine}></div>
          </div>

          <form onSubmit={handleLogin} className={styles.form}>
            <div>
              <label className={styles.label}>Email Address:</label>
              <input 
                type="email" 
                placeholder="Enter your email address ..." 
                value={email}
                onChange={(e) => setEmail(e.target.value)} 
                className={styles.input}
                required
              />
            </div>
            <div>
              <label className={styles.label}>Password:</label>
              <input 
                type="password" 
                placeholder="Enter your password ..." 
                value={password}
                onChange={(e) => setPassword(e.target.value)} 
                className={styles.input}
                required
              />
            </div>

            <div className={styles.rememberForgot}>
              <label className={styles.rememberLabel}>
                <input type="checkbox" className={styles.checkbox} />
                Remember me
              </label>
              <Link to="/forgot-password" className={styles.forgotLink}>Forgot your password?</Link>
            </div>

            <button 
              type="submit" 
              disabled={loading}
              className={styles.signInButton}
              style={{ opacity: loading ? 0.7 : 1 }}
            >
              {loading ? 'SIGNING IN...' : 'SIGN IN'}
            </button>
          </form>

          <p className={styles.signUpText}>
            Don't have an account? <Link to="/register" className={styles.signUpLink}>Sign up</Link>
          </p>
        </div>
      </div>
    </div>
  )
}