import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'ProfNudge',
    description:
      'Reminds you to review your professors when the term ends. Works with Rate My Professors. Not affiliated with Rate My Professors.',
    permissions: ['storage'],
    host_permissions: [
      'https://www.ratemyprofessors.com/*',
      // Supabase project; set at build time via VITE_SUPABASE_URL.
      'https://*.supabase.co/*',
    ],
  },
});
