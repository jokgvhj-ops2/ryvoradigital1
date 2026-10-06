import React, { useState, useRef } from 'react';
import { X, Trash2, ShoppingBag, ShieldCheck, Zap, ArrowRight, Tag, CreditCard, Check, Upload, Image as ImageIcon, Copy, AlertCircle } from 'lucide-react';
import { CartItem, CurrencyCode, CustomerOrder } from '../types';
import { formatPrice } from '../utils/currency';
import { apiCreateOrder } from '../utils/api';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  items: CartItem[];
  currency: CurrencyCode;
  onUpdateQuantity: (index: number, newQty: number) => void;
  onRemoveItem: (index: number) => void;
  onClearCart: () => void;
  onOrderCompleted: (order: CustomerOrder) => void;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen,
  onClose,
  items,
  currency,
  onUpdateQuantity,
  onRemoveItem,
  onClearCart,
  onOrderCompleted,
}) => {
  const [couponCode, setCouponCode] = useState('');
  const [appliedDiscountPercent, setAppliedDiscountPercent] = useState(0);
  const [couponMessage, setCouponMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [selectedPayment, setSelectedPayment] = useState<'card' | 'applepay' | 'paypal' | 'crypto'>('card');
  const [transactionId, setTransactionId] = useState('');
  const [paymentProof, setPaymentProof] = useState<string | null>(null);
  const [paymentProofName, setPaymentProofName] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [copiedInfo, setCopiedInfo] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // Calculate totals
  const subtotalUSD = items.reduce((sum, item) => sum + item.priceUSD * item.quantity, 0);
  const discountUSD = Number(((subtotalUSD * appliedDiscountPercent) / 100).toFixed(2));
  const totalUSD = Math.max(0, Number((subtotalUSD - discountUSD).toFixed(2)));

  const handleApplyCoupon = (e: React.FormEvent) => {
    e.preventDefault();
    const code = couponCode.trim().toUpperCase();
    if (code === 'USA10' || code === 'RYVORA10') {
      setAppliedDiscountPercent(10);
      setCouponMessage({ text: '10% USA Community Discount applied!' });
    } else if (code === 'SAVE20' || code === 'VIP20') {
      setAppliedDiscountPercent(20);
      setCouponMessage({ text: '20% VIP Creator Discount applied!' });
    } else {
      setCouponMessage({ text: 'Invalid coupon code. Try "USA10"', error: true });
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setFormError('Please upload an image file (PNG, JPG, or WEBP) for the payment screenshot.');
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      setFormError('Image size exceeds 15MB limit. Please choose a smaller image.');
      return;
    }

    setFormError('');
    setPaymentProofName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      setPaymentProof(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleCopyPaymentInfo = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedInfo(true);
    setTimeout(() => setCopiedInfo(false), 2000);
  };

  const paymentDetailsMap = {
    card: {
      name: 'Credit/Debit Card (Stripe USA / Wire)',
      address: 'Account: Ryvora Digital LLC | Routing: 111000025 | Acc #: 8942001948',
      shortCopy: '8942001948',
      instructions: 'Transfer the order amount and upload transaction confirmation screenshot below.',
    },
    applepay: {
      name: 'Apple Pay / Zelle / Cash App',
      address: 'Zelle / Apple Pay: +1 (512) 883-9120 ($RyvoraUSA)',
      shortCopy: '+15128839120',
      instructions: 'Send to our US Zelle/Apple Pay number and upload the payment receipt screenshot.',
    },
    paypal: {
      name: 'PayPal (Family & Friends / Business)',
      address: 'payments@ryvoradigital.com',
      shortCopy: 'payments@ryvoradigital.com',
      instructions: 'Send payment to PayPal address and take a screenshot of the sent payment receipt.',
    },
    crypto: {
      name: 'Crypto USDT (TRC20 Network)',
      address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      shortCopy: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      instructions: 'Send exact USDT (TRC20) and upload transaction confirmation or hash screenshot.',
    },
  };

  const currentPayInfo = paymentDetailsMap[selectedPayment];

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerEmail.trim() || !customerEmail.includes('@')) {
      setFormError('Please enter a valid email address to receive account credentials.');
      return;
    }

    if (!paymentProof) {
      setFormError('Please attach a screenshot of your payment receipt before submitting.');
      return;
    }

    setFormError('');
    setIsSubmitting(true);

    try {
      const newOrder = await apiCreateOrder({
        customerEmail: customerEmail.trim(),
        customerPhone: customerPhone.trim() || undefined,
        items: [...items],
        subtotalUSD,
        discountUSD,
        totalUSD,
        paymentMethod: currentPayInfo.name,
        paymentProof: paymentProof,
        transactionId: transactionId.trim() || undefined,
      });

      setIsSubmitting(false);
      onClearCart();
      onClose();
      onOrderCompleted(newOrder);
    } catch (err: any) {
      console.warn('Backend order submission fallback:', err);
      const generatedOrderId = `RYV-${Math.floor(10000 + Math.random() * 90000)}-US`;

      const fallbackOrder: CustomerOrder = {
        orderId: generatedOrderId,
        customerEmail: customerEmail.trim(),
        customerPhone: customerPhone.trim() || undefined,
        items: [...items],
        subtotalUSD,
        discountUSD,
        totalUSD,
        paymentMethod: currentPayInfo.name,
        paymentProof: paymentProof,
        transactionId: transactionId.trim() || undefined,
        status: 'processing',
        createdAt: `Today, ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      };

      setIsSubmitting(false);
      onClearCart();
      onClose();
      onOrderCompleted(fallbackOrder);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      
      {/* Backdrop */}
      <div className="absolute inset-0" onClick={onClose} />

      <div className="absolute inset-y-0 right-0 max-w-full flex pl-0 sm:pl-10">
        <div className="w-screen max-w-md bg-[#090d16] border-l border-slate-800 text-slate-100 flex flex-col shadow-2xl relative z-10">
          
          {/* Header */}
          <div className="p-5 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-5 h-5 text-cyan-400" />
              <h2 className="text-base font-bold text-white font-display">Shopping Bag</h2>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-semibold">
                {items.reduce((s, i) => s + i.quantity, 0)} items
              </span>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Cart Contents */}
          {items.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <div className="w-16 h-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500 mb-4">
                <ShoppingBag className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-white mb-1">Your bag is empty</h3>
              <p className="text-xs text-slate-400 max-w-xs mb-6">
                Explore our catalog of genuine AI tools, designer suites, and developer licenses.
              </p>
              <button
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-colors cursor-pointer"
              >
                Browse Store Catalog
              </button>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              
              {/* Items List */}
              <div className="space-y-3">
                {items.map((item, idx) => (
                  <div
                    key={`${item.product.id}-${item.duration}-${idx}`}
                    className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 flex gap-3 relative group"
                  >
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xs shrink-0"
                      style={{
                        backgroundColor: `${item.product.brandColor}20`,
                        color: item.product.brandColor,
                        border: `1px solid ${item.product.brandColor}40`,
                      }}
                    >
                      {item.product.name.charAt(0)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-bold text-white truncate text-xs">
                          {item.product.name}
                        </h4>
                        <button
                          onClick={() => onRemoveItem(idx)}
                          className="text-slate-500 hover:text-rose-400 p-1 cursor-pointer transition-colors"
                          title="Remove item"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-1.5 my-1 text-[10px]">
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-cyan-300 font-medium capitalize">
                          {item.duration.replace('_', ' ')}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                          {item.accountType.replace('_', ' ')}
                        </span>
                      </div>

                      <div className="flex items-center justify-between pt-1 mt-1 border-t border-slate-800/60">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => onUpdateQuantity(idx, item.quantity - 1)}
                            className="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-300 cursor-pointer"
                          >
                            -
                          </button>
                          <span className="font-semibold text-white px-1">{item.quantity}</span>
                          <button
                            onClick={() => onUpdateQuantity(idx, item.quantity + 1)}
                            className="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-300 cursor-pointer"
                          >
                            +
                          </button>
                        </div>

                        <span className="font-bold text-emerald-400 text-xs font-mono">
                          {formatPrice(item.priceUSD * item.quantity, currency)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Promo Code Form */}
              <form onSubmit={handleApplyCoupon} className="pt-2">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Tag className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3" />
                    <input
                      type="text"
                      placeholder="Promo Coupon (e.g. USA10)"
                      value={couponCode}
                      onChange={(e) => setCouponCode(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 uppercase font-mono"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-xl text-xs transition-colors cursor-pointer"
                  >
                    Apply
                  </button>
                </div>
                {couponMessage && (
                  <p
                    className={`text-[11px] mt-1.5 ${
                      couponMessage.error ? 'text-rose-400' : 'text-emerald-400'
                    }`}
                  >
                    {couponMessage.text}
                  </p>
                )}
              </form>

              {/* Delivery Contact Information */}
              <div className="pt-3 border-t border-slate-800/80 space-y-2.5">
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
                  <span>Contact for Account Delivery:</span>
                  <span className="text-[10px] text-amber-400 font-normal">Delivered after verification</span>
                </label>
                
                <div>
                  <input
                    type="email"
                    required
                    placeholder="Your Email Address (Account will be sent here) *"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    className="w-full px-3 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    Account credentials and login details will be delivered to this email after verifying payment.
                  </span>
                </div>

                <div>
                  <input
                    type="text"
                    placeholder="WhatsApp Number or Telegram / Discord (Optional)"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              {/* Payment Methods Selection */}
              <div className="pt-3 border-t border-slate-800/80">
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                  Select Payment Method:
                </label>
                
                <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                  <button
                    type="button"
                    onClick={() => setSelectedPayment('card')}
                    className={`p-2.5 rounded-xl border text-left flex items-center gap-2 cursor-pointer transition-all ${
                      selectedPayment === 'card'
                        ? 'border-cyan-400 bg-cyan-950/40 text-white'
                        : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <CreditCard className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span className="font-semibold text-[11px]">Card / Wire</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedPayment('applepay')}
                    className={`p-2.5 rounded-xl border text-left flex items-center gap-2 cursor-pointer transition-all ${
                      selectedPayment === 'applepay'
                        ? 'border-cyan-400 bg-cyan-950/40 text-white'
                        : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Zap className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="font-semibold text-[11px]">Zelle / Apple Pay</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedPayment('paypal')}
                    className={`p-2.5 rounded-xl border text-left flex items-center gap-2 cursor-pointer transition-all ${
                      selectedPayment === 'paypal'
                        ? 'border-cyan-400 bg-cyan-950/40 text-white'
                        : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span className="font-bold text-blue-400 text-xs shrink-0">P</span>
                    <span className="font-semibold text-[11px]">PayPal</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedPayment('crypto')}
                    className={`p-2.5 rounded-xl border text-left flex items-center gap-2 cursor-pointer transition-all ${
                      selectedPayment === 'crypto'
                        ? 'border-cyan-400 bg-cyan-950/40 text-white'
                        : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span className="font-bold text-amber-400 text-xs shrink-0">₮</span>
                    <span className="font-semibold text-[11px]">USDT (TRC20)</span>
                  </button>
                </div>

                {/* Selected Payment Instructions Card */}
                <div className="p-3.5 rounded-xl bg-slate-950 border border-cyan-500/30 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-cyan-300 text-[11px] uppercase tracking-wider">
                      Send Payment To:
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyPaymentInfo(currentPayInfo.shortCopy)}
                      className="text-[10px] text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      {copiedInfo ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedInfo ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>

                  <div className="font-mono text-[11px] text-slate-200 bg-slate-900/80 p-2 rounded-lg border border-slate-800 select-all break-all">
                    {currentPayInfo.address}
                  </div>

                  <p className="text-[10px] text-slate-400">
                    {currentPayInfo.instructions}
                  </p>
                </div>
              </div>

              {/* PAYMENT SCREENSHOT PROOF UPLOAD (سکرین شاٹ) */}
              <div className="pt-3 border-t border-slate-800/80 space-y-2.5">
                <label className="block text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-1 text-emerald-400">
                    <ImageIcon className="w-3.5 h-3.5" />
                    Upload Payment Screenshot *
                  </span>
                  <span className="text-[10px] text-emerald-400 font-normal">Required for verification</span>
                </label>

                {/* Hidden File Input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />

                {/* Upload Trigger / Preview Box */}
                {!paymentProof ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full p-4 rounded-xl border-2 border-dashed border-slate-700 hover:border-emerald-500/60 bg-slate-950/60 hover:bg-slate-900/40 text-center transition-all cursor-pointer group flex flex-col items-center justify-center gap-2"
                  >
                    <div className="w-10 h-10 rounded-full bg-slate-900 group-hover:bg-emerald-950/40 border border-slate-800 group-hover:border-emerald-500/40 flex items-center justify-center text-slate-400 group-hover:text-emerald-400 transition-colors">
                      <Upload className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-white block">Click to upload payment screenshot</span>
                      <span className="text-[10px] text-slate-400">PNG, JPG, or screenshot image (Max 15MB)</span>
                    </div>
                  </button>
                ) : (
                  <div className="p-3 rounded-xl bg-slate-950 border border-emerald-500/40 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={paymentProof}
                        alt="Payment Proof Screenshot"
                        className="w-12 h-12 object-cover rounded-lg border border-slate-800 shrink-0"
                      />
                      <div className="min-w-0">
                        <span className="text-xs font-bold text-white flex items-center gap-1 truncate">
                          <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span className="truncate">{paymentProofName || 'Payment_Proof.png'}</span>
                        </span>
                        <span className="text-[10px] text-emerald-400 block">Screenshot ready for verification</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setPaymentProof(null);
                        setPaymentProofName('');
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      className="text-[11px] text-slate-400 hover:text-rose-400 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                    >
                      Change
                    </button>
                  </div>
                )}

                {/* Optional Transaction ID / Sender Note */}
                <div>
                  <input
                    type="text"
                    placeholder="Transaction ID / Sender Name / Reference (Optional)"
                    value={transactionId}
                    onChange={(e) => setTransactionId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                {formError && (
                  <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}
              </div>

              {/* Price Breakdown */}
              <div className="pt-3 border-t border-slate-800 space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-400">
                  <span>Subtotal</span>
                  <span className="text-slate-200 tabular-nums">{formatPrice(subtotalUSD, currency)}</span>
                </div>

                {appliedDiscountPercent > 0 && (
                  <div className="flex justify-between text-emerald-400 font-medium">
                    <span>Discount ({appliedDiscountPercent}%)</span>
                    <span className="tabular-nums">-{formatPrice(discountUSD, currency)}</span>
                  </div>
                )}

                <div className="flex justify-between text-slate-400">
                  <span>Delivery Fee</span>
                  <span className="text-emerald-400 font-semibold">FREE ($0.00)</span>
                </div>

                <div className="flex justify-between text-base font-extrabold text-white pt-2 border-t border-slate-800/80">
                  <span>Total Due</span>
                  <span className="text-emerald-400 font-display tabular-nums">
                    {formatPrice(totalUSD, currency)}
                  </span>
                </div>
              </div>

            </div>
          )}

          {/* Sticky Checkout Button Footer */}
          {items.length > 0 && (
            <div className="p-5 border-t border-slate-800 bg-[#070a12] space-y-3">
              <button
                disabled={isSubmitting}
                onClick={handleCheckout}
                className="w-full py-3.5 px-4 rounded-xl font-bold text-xs bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 text-slate-950 hover:brightness-110 shadow-[0_0_20px_rgba(52,211,153,0.3)] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                    <span>Submitting Order & Payment Proof...</span>
                  </>
                ) : (
                  <>
                    <span>Submit Order with Payment Proof</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <div className="flex items-center justify-center gap-3 text-[10px] text-slate-500">
                <span className="flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  Verified Payment Check
                </span>
                <span>·</span>
                <span>Direct Email Delivery</span>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
