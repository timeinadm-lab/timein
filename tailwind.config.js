/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Verde da marca TIN — tom profundo da logo (#167747) como âncora
        primary: {
          50: '#f0faf4',
          100: '#dcf4e6',
          200: '#bce8d1',
          300: '#8fd7b2',
          400: '#55bd8a',
          500: '#2aa268',
          600: '#1b8552',
          700: '#167747',
          800: '#125f3a',
          900: '#0f4e30',
        },
        // Neutros levemente quentes — tira o "cinza de IA" frio
        ink: {
          50: '#f8f8f7',
          100: '#f1f1ef',
          200: '#e6e5e2',
          300: '#d3d2cd',
          400: '#a8a7a0',
          500: '#78776f',
          600: '#57564f',
          700: '#41403a',
          800: '#2a2925',
          900: '#1a1916',
        },
        // Metade das telas ainda usava o cinza frio padrão do Tailwind ao lado
        // do ink quente — o sistema parecia remendado. gray agora É o ink.
        gray: {
          50: '#f8f8f7',
          100: '#f1f1ef',
          200: '#e6e5e2',
          300: '#d3d2cd',
          400: '#a8a7a0',
          500: '#78776f',
          600: '#57564f',
          700: '#41403a',
          800: '#2a2925',
          900: '#1a1916',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        // display = Inter (números e títulos de seção). A serifa é só p/ títulos de página.
        display: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['"Instrument Serif"', 'Georgia', 'serif'],
      },
      boxShadow: {
        // Sombras suaves e em camadas — dão profundidade sem o "drop-shadow" duro
        soft: '0 1px 2px rgba(26,25,22,0.04)',
        card: '0 1px 2px rgba(26,25,22,0.03)',
        lift: '0 4px 8px rgba(16,24,40,0.05), 0 12px 28px rgba(16,24,40,0.08)',
        // Brilho verde aposentado (cara de template); mantido o nome p/ não quebrar classes
        glow: '0 1px 2px rgba(26,25,22,0.06)',
      },
      borderRadius: {
        '2xl': '0.875rem',
        '3xl': '1rem',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease-out',
      },
    },
  },
  plugins: [],
}
