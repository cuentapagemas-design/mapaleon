/* cloud.js — capa opcional de Supabase (cuentas + favoritos en la nube + descuentos).
 *
 * Si no hay configuración (config.js vacío), Cloud.enabled = false y la app usa el
 * modo local. Todo aquí es defensivo: cualquier fallo degrada a local sin romper. */
'use strict';

(function () {
  const cfg = window.LEON_SUPABASE || {};
  const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

  const Cloud = {
    enabled: !!(cfg.url && cfg.anonKey),
    client: null,
    user: null,
    _ready: null,
    _authCbs: [],
  };

  // Carga la librería de Supabase bajo demanda (solo si hay config).
  function loadLib() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SUPABASE_CDN;
      s.async = true;
      s.onload = () => resolve(window.supabase);
      s.onerror = () => reject(new Error('No se pudo cargar supabase-js'));
      document.head.appendChild(s);
    });
  }

  Cloud.init = function () {
    if (!Cloud.enabled) return Promise.resolve(false);
    if (Cloud._ready) return Cloud._ready;
    Cloud._ready = (async () => {
      try {
        const lib = await loadLib();
        Cloud.client = lib.createClient(cfg.url, cfg.anonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        });
        const { data } = await Cloud.client.auth.getSession();
        Cloud.user = (data && data.session && data.session.user) || null;
        Cloud.client.auth.onAuthStateChange((_event, session) => {
          Cloud.user = (session && session.user) || null;
          Cloud._authCbs.forEach((cb) => { try { cb(Cloud.user); } catch (e) { /* noop */ } });
        });
        return true;
      } catch (e) {
        console.warn('Supabase no disponible, modo local:', e);
        Cloud.enabled = false;
        return false;
      }
    })();
    return Cloud._ready;
  };

  Cloud.onAuth = function (cb) { Cloud._authCbs.push(cb); };

  // ---- Autenticación (enlace mágico por email) ----
  Cloud.signInWithEmail = async function (email) {
    if (!Cloud.client) return { error: { message: 'Cuentas no configuradas' } };
    return Cloud.client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.href.split('#')[0] },
    });
  };
  Cloud.signOut = async function () { if (Cloud.client) await Cloud.client.auth.signOut(); };

  // ---- Favoritos ----
  Cloud.fetchFavorites = async function () {
    if (!Cloud.client || !Cloud.user) return null;
    const { data, error } = await Cloud.client.from('favorites').select('place_id');
    if (error) { console.warn('fetchFavorites', error); return null; }
    return data.map((r) => r.place_id);
  };
  Cloud.addFavorite = async function (placeId, category) {
    if (!Cloud.client || !Cloud.user) return;
    await Cloud.client.from('favorites')
      .upsert({ user_id: Cloud.user.id, place_id: placeId, category: category || null });
  };
  Cloud.removeFavorite = async function (placeId) {
    if (!Cloud.client || !Cloud.user) return;
    await Cloud.client.from('favorites').delete()
      .eq('user_id', Cloud.user.id).eq('place_id', placeId);
  };
  Cloud.mergeFavorites = async function (placeIds) {
    if (!Cloud.client || !Cloud.user || !placeIds.length) return;
    const rows = placeIds.map((id) => ({ user_id: Cloud.user.id, place_id: id }));
    await Cloud.client.from('favorites').upsert(rows);
  };

  // ---- Descuentos ----
  Cloud.fetchDiscounts = async function () {
    if (!Cloud.client) return null;
    const { data, error } = await Cloud.client.from('discounts')
      .select('*').eq('active', true).order('created_at', { ascending: false });
    if (error) { console.warn('fetchDiscounts', error); return null; }
    return data;
  };
  Cloud.fetchSaved = async function () {
    if (!Cloud.client || !Cloud.user) return [];
    const { data, error } = await Cloud.client.from('discount_saves').select('discount_id');
    if (error) { console.warn('fetchSaved', error); return []; }
    return data.map((r) => r.discount_id);
  };
  Cloud.saveDiscount = async function (id) {
    if (!Cloud.client || !Cloud.user) return;
    await Cloud.client.from('discount_saves').upsert({ user_id: Cloud.user.id, discount_id: id });
  };
  Cloud.unsaveDiscount = async function (id) {
    if (!Cloud.client || !Cloud.user) return;
    await Cloud.client.from('discount_saves').delete()
      .eq('user_id', Cloud.user.id).eq('discount_id', id);
  };

  window.Cloud = Cloud;
})();
