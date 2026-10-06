import React, { useState } from 'react';
import { CheckCircle2, Clock, Mail, ShieldCheck, Check, Copy, ExternalLink, X, Image as ImageIcon } from 'lucide-react';
import { CustomerOrder, CurrencyCode } from '../types';
import { formatPrice } from '../utils/currency';

interface OrderSuccessModalProps {
  order: CustomerOrder | null;
  currency: CurrencyCode;
  onClose: () => void;
  onOpenChat: () => void;
}

export const OrderSuccessModal: React.FC<OrderSuccessModalProps> = ({
  order,
  currency,
  onClose,
  onOpenChat,
}) => {
  if (!order) return null;

  const [copiedKey, setCopiedKey] = useState(false);
  const [showFullProof, setShowFullProof] = useState(false);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const isDelivered = order.status === 'delivered';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      
      <div className="fixed inset-0" onClick={onClose} />

      <div className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl bg-[#090d16] border border-cyan-500/30 p-6 sm:p-8 shadow-[0_0_50px_rgba(6,182,212,0.2)] z-10">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-xl text-slate-400 hover:text-white bg-slate-900 border border-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Heading */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 mx-auto mb-3 shadow-[0_0_20px_rgba(6,182,212,0.25)]">
            <Clock className="w-8 h-8 text-cyan-400 animate-pulse" />
          </div>

          <span className="text-[11px] font-bold text-amber-400 uppercase tracking-widest block mb-1">
            Payment Screenshot Received
          </span>

          <h2 className="text-2xl font-black text-white font-display">
            Order Submitted for Verification!
          </h2>
          
          <p className="text-xs sm:text-sm text-slate-300 mt-1 font-mono">
            Order Reference: <span className="text-cyan-400 font-bold">{order.orderId}</span>
          </p>
        </div>

        {/* Delivery Notice Box */}
        <div className="mb-6 p-4 rounded-2xl bg-amber-950/20 border border-amber-500/30 flex items-start gap-3">
          <Mail className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-200 leading-relaxed">
            <span className="font-bold text-amber-300 block mb-0.5">
              Account Details will be Delivered via Email / Contact
            </span>
            Our team will verify your uploaded payment screenshot. After quick verification, your dedicated account credentials and login instructions will be delivered directly to <strong className="text-white font-mono">{order.customerEmail}</strong>{order.customerPhone ? ` / ${order.customerPhone}` : ''}.
          </div>
        </div>

        {/* 3-Step Verification Timeline */}
        <div className="mb-6 p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3 text-xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            Verification & Delivery Progress:
          </span>

          <div className="space-y-2.5">
            <div className="flex items-center gap-2.5 text-slate-200">
              <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs font-bold shrink-0">✓</span>
              <span>1. Order & Payment Screenshot Submitted</span>
            </div>

            <div className="flex items-center gap-2.5 text-amber-300">
              <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-xs font-bold shrink-0 animate-pulse">●</span>
              <span>2. Payment Verification (Staff reviewing proof)</span>
            </div>

            <div className="flex items-center gap-2.5 text-slate-400">
              <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-500 flex items-center justify-center text-xs font-bold shrink-0">3</span>
              <span>3. Account Credentials Dispatched to {order.customerEmail}</span>
            </div>
          </div>
        </div>

        {/* Uploaded Payment Proof Section */}
        {order.paymentProof && (
          <div className="mb-6 p-4 rounded-2xl bg-slate-900 border border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-cyan-400" />
                Submitted Payment Proof Screenshot:
              </span>
              <button
                type="button"
                onClick={() => setShowFullProof(!showFullProof)}
                className="text-[11px] text-cyan-400 hover:text-cyan-300 cursor-pointer"
              >
                {showFullProof ? 'Hide Image' : 'View Full Image'}
              </button>
            </div>

            <div className="flex items-center gap-3 bg-slate-950 p-2.5 rounded-xl border border-slate-800">
              <img
                src={order.paymentProof}
                alt="Payment Screenshot Proof"
                className="w-14 h-14 object-cover rounded-lg border border-slate-800 cursor-pointer shrink-0"
                onClick={() => setShowFullProof(true)}
              />
              <div className="text-xs">
                <div className="font-semibold text-white">Payment Receipt Attached</div>
                <div className="text-[11px] text-slate-400">Method: {order.paymentMethod}</div>
                {order.transactionId && (
                  <div className="text-[11px] text-cyan-400 font-mono">Ref: {order.transactionId}</div>
                )}
              </div>
            </div>

            {showFullProof && (
              <div className="mt-3 p-2 bg-slate-950 rounded-xl border border-slate-800">
                <img
                  src={order.paymentProof}
                  alt="Full Payment Proof"
                  className="max-h-80 w-auto mx-auto rounded-lg object-contain"
                />
              </div>
            )}
          </div>
        )}

        {/* If Admin has already dispatched credentials */}
        {isDelivered && order.credentials && (
          <div className="mb-6 p-4 rounded-2xl bg-emerald-950/30 border border-emerald-500/40">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">
                ✓ Verified Account Credentials:
              </span>
              <button
                onClick={() => handleCopy(order.credentials?.licenseKey || '')}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 cursor-pointer"
              >
                {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey ? 'Copied' : 'Copy Key'}</span>
              </button>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-emerald-300 font-bold select-all tracking-wider break-all">
              {order.credentials.licenseKey}
            </div>

            <p className="text-[11px] text-slate-300 mt-2">
              {order.credentials.instructions}
            </p>
          </div>
        )}

        {/* Purchased Items Summary */}
        <div className="mb-6 space-y-2">
          <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
            Order Items:
          </span>
          {order.items.map((item, idx) => (
            <div key={idx} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/50 border border-slate-800 text-xs">
              <div>
                <span className="font-bold text-white uppercase">{item.product.name}</span>
                <span className="text-slate-400 ml-2">({item.duration.replace('_', ' ')})</span>
              </div>
              <span className="font-bold text-emerald-400 tabular-nums">
                {formatPrice(item.priceUSD * item.quantity, currency)}
              </span>
            </div>
          ))}

          <div className="flex items-center justify-between pt-2 px-1 text-xs">
            <span className="text-slate-400">Total Amount</span>
            <span className="font-extrabold text-white text-sm tabular-nums">
              {formatPrice(order.totalUSD, currency)}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
          <button
            onClick={() => {
              onClose();
              onOpenChat();
            }}
            className="w-full sm:flex-1 py-3 px-4 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs font-bold text-white transition-colors cursor-pointer text-center"
          >
            Need Help? Ask Support
          </button>

          <button
            onClick={onClose}
            className="w-full sm:flex-1 py-3 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-colors cursor-pointer text-center shadow-md"
          >
            Done / Return to Store
          </button>
        </div>

      </div>

    </div>
  );
};
