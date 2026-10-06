import React, { useState } from 'react';
import { KeyRound, X, AlertCircle, Loader2 } from 'lucide-react';
import { RyvoraLogo } from '../RyvoraLogo';
import { apiAdminLogin } from '../../utils/api';

interface AdminLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: () => void;
}

export const AdminLoginModal: React.FC<AdminLoginModalProps> = ({
  isOpen,
  onClose,
  onLoginSuccess,
}) => {
  if (!isOpen) return null;

  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setLoading(true);
    setError('');

    try {
      const result = await apiAdminLogin(password.trim(), true);
      if (result.success) {
        setError('');
        setPassword('');
        onLoginSuccess();
        onClose();
      } else {
        setError(result.message || 'Invalid admin passcode. Please enter the authorized staff passcode.');
      }
    } catch {
      setError('Connection failure during admin verification. Check network connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="fixed inset-0" onClick={onClose} />

      <div className="relative w-full max-w-md rounded-3xl bg-[#090d16] border border-cyan-500/30 p-6 sm:p-8 shadow-[0_0_50px_rgba(6,182,212,0.2)] z-10">
        {/* Close Button */}
        <button
          onClick={onClose}
          disabled={loading}
          className="absolute top-5 right-5 p-2 rounded-xl text-slate-400 hover:text-white bg-slate-900 border border-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center mb-6">
          <div className="inline-flex justify-center mb-3">
            <RyvoraLogo size="sm" showText={false} />
          </div>

          <h3 className="text-xl font-extrabold text-white font-display">
            Ryvora Admin Console
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Restricted staff access for managing USA product catalog, orders, and license dispatching.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-cyan-400" />
              <span>Admin Passcode</span>
            </label>
            <input
              type="password"
              required
              autoFocus
              disabled={loading}
              placeholder="Enter staff passcode"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 font-mono disabled:opacity-50"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)] cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-950" />}
            <span>{loading ? 'Verifying Passcode...' : 'Authenticate & Open Console'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
