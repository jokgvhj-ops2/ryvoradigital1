import React, { useState } from 'react';
import { Search, X, CheckCircle2, Clock, Mail, ShieldCheck, Key, AlertCircle, Loader2, Image as ImageIcon } from 'lucide-react';
import { CustomerOrder } from '../types';
import { apiTrackOrder } from '../utils/api';

interface OrderTrackerModalProps {
  isOpen: boolean;
  onClose: () => void;
  orders?: CustomerOrder[];
}

export const OrderTrackerModal: React.FC<OrderTrackerModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const [orderId, setOrderId] = useState('');
  const [email, setEmail] = useState('');
  const [trackedOrder, setTrackedOrder] = useState<CustomerOrder | null>(null);
  const [searched, setSearched] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [showFullProof, setShowFullProof] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanOrderId = orderId.trim();
    const cleanEmail = email.trim();

    if (!cleanOrderId && !cleanEmail) return;

    setLoading(true);
    setSearched(true);
    setErrorMessage('');
    setTrackedOrder(null);

    try {
      const result = await apiTrackOrder(cleanOrderId, cleanEmail);
      if (result.order) {
        setTrackedOrder(result.order);
        setErrorMessage('');
      } else {
        setTrackedOrder(null);
        setErrorMessage(result.error || 'No active order found matching the provided reference.');
      }
    } catch {
      setTrackedOrder(null);
      setErrorMessage('Connection error. Please check your network and retry.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="fixed inset-0" onClick={onClose} />

      <div className="relative w-full max-w-lg rounded-3xl bg-[#090d16] border border-slate-800 p-6 sm:p-8 shadow-2xl z-10 max-h-[90vh] overflow-y-auto">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-xl text-slate-400 hover:text-white bg-slate-900 border border-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="mb-6">
          <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mb-3">
            <Search className="w-6 h-6" />
          </div>

          <h3 className="text-xl font-extrabold text-white font-display">
            Track License Activation
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Enter your Order ID and checkout email address to view live credentials, delivery status, and warranty.
          </p>
        </div>

        {/* Search input form */}
        <form onSubmit={handleSearch} className="mb-6 space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
              Order ID Reference
            </label>
            <input
              type="text"
              required
              placeholder="e.g. RYV-94821-US"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 uppercase font-mono"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
              Checkout Email Address
            </label>
            <input
              type="email"
              required
              placeholder="e.g. your.email@domain.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{loading ? 'Verifying Order Records...' : 'Verify & Lookup Status'}</span>
          </button>
        </form>

        {/* No order found result */}
        {searched && !loading && !trackedOrder && (
          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs space-y-2 animate-in fade-in duration-150">
            <div className="font-semibold flex items-center gap-1.5 text-rose-400">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Verification Unsuccessful</span>
            </div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              {errorMessage || `We couldn't find an order matching "${orderId}". Please verify your email and Order ID.`}
            </p>
          </div>
        )}

        {/* Real Results Timeline */}
        {searched && !loading && trackedOrder && (
          <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <span className="text-[10px] text-slate-500 uppercase font-bold">Order Reference</span>
                <div className="font-mono text-sm font-bold text-cyan-400">{trackedOrder.orderId}</div>
              </div>
              <span
                className={`text-[11px] font-bold px-2.5 py-1 rounded-full uppercase border ${
                  trackedOrder.status === 'delivered'
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                    : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                }`}
              >
                {trackedOrder.status === 'delivered' ? 'DELIVERED & ACTIVE' : 'PENDING VERIFICATION'}
              </span>
            </div>

            {/* Stepper depending on status */}
            {trackedOrder.status === 'processing' ? (
              <div className="space-y-3 pt-1 text-xs">
                <div className="flex items-center gap-2.5 text-slate-200">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>1. Order & Payment Screenshot Submitted</span>
                </div>
                <div className="flex items-center gap-2.5 text-amber-300">
                  <Clock className="w-4 h-4 text-amber-400 shrink-0 animate-pulse" />
                  <span>2. Payment Verification (Staff reviewing proof)</span>
                </div>
                <div className="flex items-center gap-2.5 text-slate-400">
                  <span className="w-4 h-4 rounded-full bg-slate-800 text-slate-500 flex items-center justify-center text-[10px] shrink-0">
                    3
                  </span>
                  <span>
                    3. Account Credentials Dispatched to <strong className="text-cyan-300 font-mono">{trackedOrder.customerEmail}</strong>
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-500/30 text-amber-300 text-[11px]">
                  Payment screenshot is being verified by staff. Once approved, your account login details will be activated here and dispatched to your email.
                </div>
              </div>
            ) : (
              <div className="space-y-3 pt-1 text-xs">
                <div className="flex items-center gap-2.5 text-slate-200">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>1. Payment Verified ({trackedOrder.paymentMethod})</span>
                </div>
                <div className="flex items-center gap-2.5 text-slate-200">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>2. Official Private License Allocated & Tested</span>
                </div>
                <div className="flex items-center gap-2.5 text-slate-200">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    3. Dispatched to inbox: <strong className="text-cyan-300 font-mono">{trackedOrder.customerEmail}</strong>
                  </span>
                </div>
              </div>
            )}

            {/* Payment Proof Preview if present */}
            {trackedOrder.paymentProof && (
              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] text-slate-400 uppercase font-bold flex items-center gap-1">
                    <ImageIcon className="w-3 h-3 text-cyan-400" /> Payment Screenshot Proof:
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowFullProof(!showFullProof)}
                    className="text-[10px] text-cyan-400 hover:text-cyan-300 cursor-pointer"
                  >
                    {showFullProof ? 'Hide' : 'View'}
                  </button>
                </div>

                <img
                  src={trackedOrder.paymentProof}
                  alt="Payment Proof"
                  className={`rounded-lg object-contain border border-slate-800 ${
                    showFullProof ? 'max-h-60 w-auto' : 'h-12 w-20 object-cover'
                  }`}
                />
                {trackedOrder.transactionId && (
                  <div className="text-[10px] text-slate-400 mt-1 font-mono">
                    Ref ID: <span className="text-white">{trackedOrder.transactionId}</span>
                  </div>
                )}
              </div>
            )}

            {/* Items details */}
            <div className="pt-3 border-t border-slate-800 text-xs text-slate-300 space-y-2">
              <div className="font-semibold text-white">Items in Order:</div>
              {trackedOrder.items.map((item, idx) => (
                <div
                  key={idx}
                  className="flex justify-between items-center text-xs text-slate-300 bg-slate-950/60 p-2 rounded-lg border border-slate-800/60"
                >
                  <span>
                    {item.product.name} ({item.duration.replace('_', ' ')})
                  </span>
                  <span className="font-mono text-cyan-400">Qty: {item.quantity}</span>
                </div>
              ))}

              <div className="flex justify-between items-center pt-2 text-[11px] text-slate-400">
                <span>Created: {trackedOrder.createdAt}</span>
                <span>
                  Warranty: <strong className="text-emerald-400">Full Replacement Active</strong>
                </span>
              </div>

              {trackedOrder.credentials?.licenseKey && (
                <div className="mt-2">
                  <span className="text-[10px] text-slate-500 uppercase font-bold">Assigned License / Token:</span>
                  <div className="p-2.5 rounded-lg bg-slate-950 font-mono text-[11px] text-cyan-400 break-all mt-1 select-all border border-slate-800">
                    {trackedOrder.credentials.licenseKey}
                  </div>
                </div>
              )}

              {trackedOrder.credentials?.instructions && (
                <div className="mt-2">
                  <span className="text-[10px] text-slate-500 uppercase font-bold">Dispatch Instructions:</span>
                  <div className="p-2.5 rounded-lg bg-slate-950 text-[11px] text-slate-300 mt-1 border border-slate-800">
                    {trackedOrder.credentials.instructions}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
