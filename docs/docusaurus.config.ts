import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'Nitro Rolling Number',
  tagline:
    'A native rolling number for React Native. Every digit is a wheel that rolls, driven by one C++ engine on iOS and Android.',
  favicon: 'img/favicon.svg',

  future: {
    v4: true,
    faster: true,
  },

  url: 'https://ronickg.github.io',
  baseUrl: '/react-native-nitro-rolling-number/',
  organizationName: 'ronickg',
  projectName: 'react-native-nitro-rolling-number',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: 'docs',
          editUrl:
            'https://github.com/ronickg/react-native-nitro-rolling-number/tree/main/docs/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/social-card.png',
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Nitro Rolling Number',
      logo: {
        alt: 'Nitro Rolling Number',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: 'Docs',
        },
        {to: '/docs/reveal', label: 'Jackpot reveal', position: 'left'},
        {to: '/docs/benchmarks', label: 'Benchmarks', position: 'left'},
        {to: '/docs/nitro-input', label: 'Input', position: 'left'},
        {
          href: 'https://www.npmjs.com/package/react-native-nitro-rolling-number',
          label: 'npm',
          position: 'right',
        },
        {
          href: 'https://github.com/ronickg/react-native-nitro-rolling-number',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Getting started', to: '/docs/getting-started'},
            {label: 'Props', to: '/docs/props'},
            {label: 'Jackpot reveal', to: '/docs/reveal'},
            {label: 'How it works', to: '/docs/how-it-works'},
          ],
        },
        {
          title: 'Performance',
          items: [
            {label: 'Benchmarks', to: '/docs/benchmarks'},
            {label: 'Performance guide', to: '/docs/performance'},
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/ronickg/react-native-nitro-rolling-number',
            },
            {
              label: 'Nitro Modules',
              href: 'https://nitro.margelo.com',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Ronald Goedeke. MIT licensed.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'swift', 'kotlin', 'cpp', 'ruby', 'json'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
