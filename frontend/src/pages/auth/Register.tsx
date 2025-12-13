import { useState, type FormEvent } from 'react'
import { supabase } from '../../supabaseClient'
import { Link, useNavigate } from 'react-router-dom'
import styles from '../cssfiles/Register.module.css' 
import Background from '../../components/background/background'
import AskVoxLogo from '../../components/TopBars/AskVox.png' 

export default function Register() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  
  // New Fields
  const [gender, setGender] = useState('')
  const [birthMonth, setBirthMonth] = useState('')
  const [birthDay, setBirthDay] = useState('')
  const [birthYear, setBirthYear] = useState('')

  const navigate = useNavigate()

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: {
          full_name: username,
          username: username,
          gender: gender,
          dob: `${birthYear}-${birthMonth}-${birthDay}`
        }
      }
    })

    if (error) {
      alert(error.message)
    } else {
      alert('Registration successful! Please check your email.')
      navigate('/login')
    }
    setLoading(false)
  }

  const handleGoogleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/dashboard` },
    })
    if (error) alert(error.message)
  }

  // Helpers for Date Dropdowns
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const years = Array.from({ length: 100 }, (_, i) => new Date().getFullYear() - i);

  return (
    <div className="uv-root">
      <Background />
      {/* ✅ Added Global Class: uv-responsive-container */}
      <div className={`${styles.registerContainer} uv-responsive-container`}>
        
        {/* ✅ Added Global Class: uv-responsive-form */}
        <div className={`${styles.registerForm} uv-responsive-form`}>
          <img src={AskVoxLogo} alt="AskVox" className={styles.logo} />
          
          {/* ✅ Added Global Class: uv-responsive-text */}
          <h2 className={`${styles.title} uv-responsive-text`}>create an account</h2>
          <p className={styles.subtitle}>Your journey with AskVox starts here.</p>

          <button onClick={handleGoogleLogin} className={styles.googleButton}>
            <img 
              src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" 
              alt="Google" 
              className={styles.googleLogo} 
            />
            Sign up with Google
          </button>

          <div className={styles.divider}>
            <div className={styles.dividerLine}></div>
            <span className={styles.dividerText}>or</span>
            <div className={styles.dividerLine}></div>
          </div>

          <form onSubmit={handleRegister} className={styles.form}>
            <div>
              <label className={styles.label}>Profile Name:</label>
              <input 
                type="text" 
                placeholder="Enter your profile name ..." 
                value={username}
                onChange={(e) => setUsername(e.target.value)} 
                className={styles.input}
                required
              />
            </div>

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

            {/* Gender Selection */}
            <div>
              <label className={styles.label}>What's your gender?</label>
              {/* ✅ Added Global Class: uv-stack-on-mobile */}
              <div className={`${styles.genderGroup} uv-stack-on-mobile`}>
                <label className={styles.radioLabel}>
                  <input type="radio" name="gender" value="female" onChange={(e) => setGender(e.target.value)} className={styles.radio} /> Female
                </label>
                <label className={styles.radioLabel}>
                  <input type="radio" name="gender" value="male" onChange={(e) => setGender(e.target.value)} className={styles.radio} /> Male
                </label>
                <label className={styles.radioLabel}>
                  <input type="radio" name="gender" value="other" onChange={(e) => setGender(e.target.value)} className={styles.radio} /> Rather not say
                </label>
              </div>
            </div>

            {/* Date of Birth Selection */}
            <div>
              <label className={styles.label}>What's your date of birth?</label>
              {/* ✅ Added Global Class: uv-stack-on-mobile */}
              <div className={`${styles.dobGroup} uv-stack-on-mobile`}>
                <select className={`${styles.select} uv-full-width-mobile`} value={birthMonth} onChange={(e) => setBirthMonth(e.target.value)} required>
                  <option value="">Month</option>
                  {months.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
                <select className={`${styles.select} uv-full-width-mobile`} value={birthDay} onChange={(e) => setBirthDay(e.target.value)} required>
                  <option value="">Day</option>
                  {days.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <select className={`${styles.select} uv-full-width-mobile`} value={birthYear} onChange={(e) => setBirthYear(e.target.value)} required>
                  <option value="">Year</option>
                  {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>

            <button 
              type="submit" 
              disabled={loading}
              className={styles.submitButton}
            >
              {loading ? 'CREATING ACCOUNT...' : 'SIGN UP'}
            </button>
          </form>

          <p className={styles.loginText}>
            Already have an account? <Link to="/login" className={styles.loginLink}>Log in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}