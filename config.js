/* Configuración de Supabase (OPCIONAL).
 *
 * Pega aquí los datos PÚBLICOS de tu proyecto para activar cuentas y el guardado
 * de descuentos en la nube. Son seguros para el navegador: la "anon key" está
 * pensada para el cliente y queda protegida por las reglas RLS (ver supabase/schema.sql).
 * NUNCA pongas aquí la "service_role key".
 *
 * Si lo dejas vacío, la app funciona en MODO LOCAL:
 *   - Favoritos por dispositivo (localStorage).
 *   - Descuentos de solo lectura desde data/descuentos.json.
 *
 * Dónde encontrarlos: Supabase → Project Settings → API → "Project URL" y "anon public".
 */
window.LEON_SUPABASE = {
  url: '',      // p.ej. "https://xxxxxxxx.supabase.co"
  anonKey: '',  // anon public key
};
