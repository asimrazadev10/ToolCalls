import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'docs/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/rag/**/*.{ts,tsx}'],
    rules: {
      /**
       * Marginalia is a separate system, and that is a security property
       * rather than a preference: its answering call deliberately binds no
       * tools, so an injected instruction inside an uploaded document has
       * nothing to actuate. The guarantee holds only while this module stays
       * unable to reach the weather agent's tool registry.
       */
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/lib/ai', '@/lib/ai/*', '**/lib/ai', '**/lib/ai/*'],
              message:
                'Marginalia must not import the weather agent — its answering call binds no tools by design. See docs/superpowers/specs/2026-08-24-marginalia-rag-design.md.',
            },
          ],
        },
      ],
    },
  },
);
