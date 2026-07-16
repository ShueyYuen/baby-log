import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(username, password);
      navigate('/');
    } catch (err: any) {
      setError(err.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-login-bg">
      {/* Animated gradient orbs */}
      <div className="glass-orb glass-orb-1" />
      <div className="glass-orb glass-orb-2" />
      <div className="glass-orb glass-orb-3" />

      {/* Noise texture overlay */}
      <div className="glass-noise" />

      <div className="relative z-10 w-full max-w-sm px-4">
        {/* Brand */}
        <div className="text-center mb-10">
          <div className="glass-brand-icon">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 12h.01M15 12h.01M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5" />
              <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-wide mt-5">
            宝宝日志
          </h1>
          <p className="text-white/50 text-sm mt-2 tracking-widest uppercase">
            新生儿照护记录系统
          </p>
        </div>

        {/* Glass card */}
        <form onSubmit={handleSubmit} className="glass-card">
          {/* Inner glow highlight */}
          <div className="glass-card-glow" />

          <h2 className="text-lg font-semibold text-white/90 text-center mb-6 relative z-10">
            登录
          </h2>

          {error && (
            <div className="relative z-10 mb-4 rounded-lg border border-red-500/30 bg-red-500/10 backdrop-blur-sm px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="space-y-5 relative z-10">
            <div>
              <label className="block text-xs font-medium text-white/60 mb-2 tracking-wide uppercase">
                用户名
              </label>
              <div className={`glass-input-wrapper ${focused === 'username' ? 'glass-input-focused' : ''}`}>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onFocus={() => setFocused('username')}
                  onBlur={() => setFocused(null)}
                  className="glass-input"
                  placeholder="请输入用户名"
                  required
                  autoComplete="username"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-white/60 mb-2 tracking-wide uppercase">
                密码
              </label>
              <div className={`glass-input-wrapper ${focused === 'password' ? 'glass-input-focused' : ''}`}>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocused('password')}
                  onBlur={() => setFocused(null)}
                  className="glass-input"
                  placeholder="请输入密码"
                  required
                  autoComplete="current-password"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="glass-btn w-full"
            >
              <span className="glass-btn-glow" />
              <span className="relative z-10">
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    登录中…
                  </span>
                ) : '登录'}
              </span>
            </button>
          </div>

          <p className="text-center text-xs text-white/30 mt-6 relative z-10">
            请联系管理员获取账号
          </p>
        </form>
      </div>
    </div>
  );
}
