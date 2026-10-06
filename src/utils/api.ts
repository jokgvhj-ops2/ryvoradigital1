import { CustomerOrder, Product, PromoCoupon, LiveActivation } from '../types';

const ADMIN_TOKEN_KEY = 'ryvora_admin_auth_token';

export function getStoredAdminToken(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY) || localStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredAdminToken(token: string, remember: boolean = false): void {
  try {
    sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    if (remember) {
      localStorage.setItem(ADMIN_TOKEN_KEY, token);
    }
  } catch (err) {
    console.error('Failed to store admin token:', err);
  }
}

export function clearStoredAdminToken(): void {
  try {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch (err) {
    console.error('Failed to clear admin token:', err);
  }
}

function getAuthHeaders(): HeadersInit {
  const token = getStoredAdminToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// -------------------------------------------------------------
// 1. ADMIN AUTHENTICATION
// -------------------------------------------------------------
export async function apiAdminLogin(password: string, remember: boolean = false): Promise<{ success: boolean; message?: string }> {
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    const data = await res.json();
    if (res.ok && data.success && data.token) {
      setStoredAdminToken(data.token, remember);
      return { success: true };
    }
    return { success: false, message: data.message || 'Invalid passcode.' };
  } catch (err: any) {
    return { success: false, message: 'Network error connecting to authentication server.' };
  }
}

export async function apiVerifyAdminSession(): Promise<boolean> {
  const token = getStoredAdminToken();
  if (!token) return false;

  try {
    const res = await fetch('/api/admin/verify', {
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      clearStoredAdminToken();
      return false;
    }
    const data = await res.json();
    return !!data.authenticated;
  } catch {
    return false;
  }
}

// -------------------------------------------------------------
// 2. ORDERS
// -------------------------------------------------------------
export async function apiGetOrders(): Promise<(CustomerOrder & { isNew?: boolean })[]> {
  const res = await fetch('/api/orders', {
    headers: getAuthHeaders(),
  });

  if (!res.ok) {
    if (res.status === 401) {
      console.warn('Orders access requires admin authentication.');
    }
    throw new Error('Failed to fetch orders from server');
  }

  const data = await res.json();
  return data.orders || [];
}

export async function apiUploadProof(base64Data: string, filename?: string): Promise<string> {
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64Data, filename }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.message || `Failed to upload payment proof (Status ${res.status})`);
  }

  const data = await res.json();
  return data.url;
}

export async function apiCreateOrder(orderPayload: {
  customerEmail: string;
  customerPhone?: string;
  items: any[];
  couponCode?: string;
  paymentMethod: string;
  paymentProof: string;
  transactionId?: string;
}): Promise<CustomerOrder> {
  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(orderPayload),
  });

  if (!res.ok) {
    let message = '';
    try {
      const errData = await res.json();
      if (errData && errData.message) {
        message = errData.message;
      }
    } catch {
      message = `Server responded with status ${res.status} (${res.statusText || 'Error'})`;
    }
    console.error('[API] Order submission error:', { status: res.status, message });
    throw new Error(message || 'Failed to submit order to production database');
  }

  const data = await res.json();
  return data.order;
}

export async function apiTrackOrder(
  orderIdOrQuery: string,
  customerEmail?: string
): Promise<{ order?: CustomerOrder | null; error?: string; requiresEmail?: boolean }> {
  try {
    const params = new URLSearchParams();
    if (orderIdOrQuery) params.set('orderId', orderIdOrQuery.trim());
    if (customerEmail) params.set('email', customerEmail.trim());

    const res = await fetch(`/api/orders/track?${params.toString()}`, {
      headers: getAuthHeaders(),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        order: null,
        error: data.message || 'No matching order found.',
        requiresEmail: data.requiresEmail,
      };
    }

    return { order: data.order || null };
  } catch (err: any) {
    console.error('Error tracking order:', err);
    return { order: null, error: 'Connection error while tracking order.' };
  }
}

export async function apiUpdateOrder(
  orderId: string,
  updates: { status?: string; credentials?: any; isNew?: boolean }
): Promise<CustomerOrder | null> {
  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
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
      headers: getAuthHeaders(),
    });
    return res.ok;
  } catch (err) {
    console.error('Error deleting order:', err);
    return false;
  }
}

// -------------------------------------------------------------
// 3. PRODUCTS
// -------------------------------------------------------------
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
      headers: getAuthHeaders(),
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
      headers: getAuthHeaders(),
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
      headers: getAuthHeaders(),
    });
    return res.ok;
  } catch (err) {
    console.error('Error deleting product:', err);
    return false;
  }
}

// -------------------------------------------------------------
// 4. COUPONS
// -------------------------------------------------------------
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
      headers: getAuthHeaders(),
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
      headers: getAuthHeaders(),
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
      headers: getAuthHeaders(),
    });
    return res.ok;
  } catch (err) {
    console.error('Error deleting coupon:', err);
    return false;
  }
}

// -------------------------------------------------------------
// 5. ACTIVATIONS
// -------------------------------------------------------------
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
      headers: getAuthHeaders(),
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
      headers: getAuthHeaders(),
    });
    return res.ok;
  } catch (err) {
    console.error('Error deleting activation:', err);
    return false;
  }
}

// -------------------------------------------------------------
// 6. ANNOUNCEMENT
// -------------------------------------------------------------
export async function apiGetAnnouncement(): Promise<string | null> {
  try {
    const res = await fetch('/api/announcement');
    if (!res.ok) return null;
    const data = await res.json();
    return data.announcement;
  } catch {
    return null;
  }
}

export async function apiUpdateAnnouncement(text: string): Promise<boolean> {
  try {
    const res = await fetch('/api/announcement', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
