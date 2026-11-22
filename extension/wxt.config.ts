import { defineConfig } from 'wxt';

// Ask for access to this deployment's Supabase project only, not every *.supabase.co site.
try {
  process.loadEnvFile('.env');
} catch {
  // No .env (e.g. CI): fall back to the environment.
}
const supabaseUrl = process.env.VITE_SUPABASE_URL;
if (!supabaseUrl) throw new Error('Set VITE_SUPABASE_URL in extension/.env (see .env.example)');

export default defineConfig({
  // Shown in the popup header so you can tell which build is loaded.
  vite: () => ({ define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) } }),
  manifest: {
    name: 'ProfNudge',
    description:
      'Reminds you to review your professors when the term ends. Works with Rate My Professors. Not affiliated with Rate My Professors.',
    permissions: ['storage'],
    host_permissions: ['https://www.ratemyprofessors.com/*', `${new URL(supabaseUrl).origin}/*`],
  },
});
