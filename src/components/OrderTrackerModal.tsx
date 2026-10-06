import React, { useState } from 'react';
import { Search, X, CheckCircle2, Clock, Mail, ShieldCheck, Key, AlertCircle } from 'lucide-react';
import { CustomerOrder } from '../types';

interface OrderTrackerModalProps {
  isOpen: boolean;
  onClose: () => void;
  orders: CustomerOrder[];
}

export const OrderTrackerModal: React.FC<OrderTrackerModalProps> = ({ isOpen, onClose, orders }) => {
  if (!isOpen) return null;

  const [query, setQuery] = useState('');
  const [trackedOrder, setTrackedOrder] = useState<CustomerOrder | null>(null);
  const [searched, setSearched] = useState(false);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = query.trim().toLowerCase();
    if (!clean) return;

    setSearched(true);
    // Find matching order in real store orders
    const match = orders.find(
      (o) =>
        o.orderId.toLowerCase() === clean ||
        o.customerEmail.toLowerCase() === clean ||
        (o.credentials?.licenseKey && o.credentials.licenseKey.toLowerCase() === clean)
    );

    setTrackedOrder(match || null);
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
            Enter your Order ID (e.g. RYV-94821-US) or your checkout email address to view live credentials and warranty status.
          </p>
        </div>

        {/* Search input form */}
        <form onSubmit={handleSearch} className="mb-6">
          <div className="flex gap-2">
            <input
              type="text"
              required
              placeholder="Order ID (RYV-...) or Email"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 uppercase font-mono"
            />
            <button
              type="submit"
              className="px-5 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-colors cursor-pointer"
            >
              Lookup
            </button>
          </div>
        </form>

        {/* No order found result */}
        {searched && !trackedOrder && (
          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs space-y-2 animate-in fade-in duration-150">
            <div className="font-semibold flex items-center gap-1.5 text-rose-400">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>No Active Order Found</span>
            </div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              We couldn&apos;t find an order matching <span className="font-mono text-white font-bold">{query}</span>.
              Please check your order confirmation details or contact our 24/7 concierge support.
            </p>
          </div>
        )}

        {/* Real Results Timeline */}
        {searched && trackedOrder && (
          <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <span className="text-[10px] text-slate-500 uppercase font-bold">Order Reference</span>
                <div className="font-mono text-sm font-bold text-cyan-400">{trackedOrder.orderId}</div>
              </div>
              <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full uppercase border ${
                trackedOrder.status === 'delivered'
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                  : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
              }`}>
                {trackedOrder.status === 'delivered' ? 'DELIVERED & ACTIVE' : trackedOrder.status}
              </span>
            </div>

            {/* Stepper */}
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
                <span>3. Dispatched to inbox: <strong className="text-cyan-300 font-mono">{trackedOrder.customerEmail}</strong></span>
              </div>
            </div>

            {/* Items details */}
            <div className="pt-3 border-t border-slate-800 text-xs text-slate-300 space-y-2">
              <div className="font-semibold text-white">Items in Order:</div>
              {trackedOrder.items.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center text-xs text-slate-300 bg-slate-950/60 p-2 rounded-lg border border-slate-800/60">
                  <span>{item.product.name} ({item.duration.replace('_', ' ')})</span>
                  <span className="font-mono text-cyan-400">Qty: {item.quantity}</span>
                </div>
              ))}

              <div className="flex justify-between items-center pt-2 text-[11px] text-slate-400">
                <span>Created: {trackedOrder.createdAt}</span>
                <span>Warranty: <strong className="text-emerald-400">Full Replacement Active</strong></span>
              </div>

              {trackedOrder.credentials?.licenseKey && (
                <div className="mt-2">
                  <span className="text-[10px] text-slate-500 uppercase font-bold">Assigned License / Token:</span>
                  <div className="p-2.5 rounded-lg bg-slate-950 font-mono text-[11px] text-cyan-400 break-all mt-1 select-all border border-slate-800">
                    {trackedOrder.credentials.licenseKey}
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
