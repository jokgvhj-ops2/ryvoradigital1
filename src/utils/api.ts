import { CustomerOrder, Product, PromoCoupon, LiveActivation } from '../types';

export async function apiGetOrders(): Promise<CustomerOrder[]> {
  try {
    const res = await fetch('/api/orders');
    if (!res.ok) throw new Error('Failed to fetch orders');
    const data = await res.json();
    return data.orders || [];
  } catch (err) {
    console.warn('API error, falling back to local cache:', err);
    try {
      const cached = localStorage.getItem('ryvora_orders');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  }
}

export async function apiCreateOrder(orderPayload: {
  customerEmail: string;
  customerPhone?: string;
  items: any[];
  subtotalUSD: number;
  discountUSD: number;
  totalUSD: number;
  paymentMethod: string;
}): Promise<CustomerOrder> {
  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(orderPayload),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.message || 'Failed to place order on server');
  }

  const data = await res.json();
  return data.order;
}

export async function apiTrackOrder(query: string): Promise<CustomerOrder | null> {
  try {
    const res = await fetch(`/api/orders/track?query=${encodeURIComponent(query.trim())}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.order || null;
  } catch (err) {
    console.error('Error tracking order:', err);
    return null;
  }
}

export async function apiUpdateOrder(orderId: string, updates: { status?: string; credentials?: any }): Promise<CustomerOrder | null> {
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.order;
  } catch (err) {
    console.error('Error updating order:', err);
    return null;
  }
}

export async function apiDeleteOrder(orderId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch (err) {
    console.error('Error deleting order:', err);
    return false;
  }
}

export async function apiGetProducts(): Promise<Product[] | null> {
  try {
    const res = await fetch('/api/products');
    if (!res.ok) return null;
    const data = await res.json();
    return data.products;
  } catch (err) {
    console.warn('API error fetching products:', err);
    return null;
  }
}

export async function apiUpdateProduct(productId: string, product: Partial<Product>): Promise<Product | null> {
  try {
    const res = await fetch(`/api/products/${encodeURIComponent(productId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(product),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.product;
  } catch (err) {
    console.error('Error updating product:', err);
    return null;
  }
}

export async function apiCreateProduct(product: Product): Promise<Product | null> {
  try {
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(product),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.product;
  } catch (err) {
    console.error('Error creating product:', err);
    return null;
  }
}

export async function apiDeleteProduct(productId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/products/${encodeURIComponent(productId)}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch (err) {
    console.error('Error deleting product:', err);
    return false;
  }
}

export async function apiGetCoupons(): Promise<PromoCoupon[] | null> {
  try {
    const res = await fetch('/api/coupons');
    if (!res.ok) return null;
    const data = await res.json();
    return data.coupons;
  } catch (err) {
    console.warn('API error fetching coupons:', err);
    return null;
  }
}

export async function apiCreateCoupon(coupon: PromoCoupon): Promise<PromoCoupon | null> {
  try {
    const res = await fetch('/api/coupons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(coupon),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.coupon;
  } catch (err) {
    console.error('Error creating coupon:', err);
    return null;
  }
}

export async function apiToggleCoupon(code: string): Promise<PromoCoupon | null> {
  try {
    const res = await fetch(`/api/coupons/${encodeURIComponent(code)}`, {
      method: 'PATCH',
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.coupon;
  } catch (err) {
    console.error('Error toggling coupon:', err);
    return null;
  }
}

export async function apiDeleteCoupon(code: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/coupons/${encodeURIComponent(code)}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch (err) {
    console.error('Error deleting coupon:', err);
    return false;
  }
}

export async function apiGetActivations(): Promise<LiveActivation[] | null> {
  try {
    const res = await fetch('/api/activations');
    if (!res.ok) return null;
    const data = await res.json();
    return data.activations;
  } catch (err) {
    console.warn('API error fetching activations:', err);
    return null;
  }
}

export async function apiAddActivation(activation: LiveActivation): Promise<LiveActivation | null> {
  try {
    const res = await fetch('/api/activations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(activation),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.activation;
  } catch (err) {
    console.error('Error adding activation:', err);
    return null;
  }
}

export async function apiDeleteActivation(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/activations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch (err) {
    console.error('Error deleting activation:', err);
    return false;
  }
}

export async function apiGetAnnouncement(): Promise<string | null> {
  try {
    const res = await fetch('/api/announcement');
    if (!res.ok) return null;
    const data = await res.json();
    return data.announcement;
  } catch (err) {
    return null;
  }
}

export async function apiUpdateAnnouncement(text: string): Promise<boolean> {
  try {
    const res = await fetch('/api/announcement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}
