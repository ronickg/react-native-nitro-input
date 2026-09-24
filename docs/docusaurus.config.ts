import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const GITHUB = 'https://github.com/ronickg/react-native-nitro-input';
const EDIT_URL = `${GITHUB}/tree/main/docs/`;


const config: Config = {
  title: 'react-native-nitro-input',
  tagline:
    'A native text input and an animated number for React Native, built with Nitro Modules. C++ engines shared by iOS and Android.',
  favicon: 'img/favicon.svg',

  future: {
    v4: true,
    faster: true,
  },

  url: 'https://ronickg.github.io',
  baseUrl: '/react-native-nitro-input/',
  organizationName: 'ronickg',
  projectName: 'react-native-nitro-input',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          path: './content',
          routeBasePath: 'docs',
          sidebarPath: './sidebars.ts',
          editUrl: EDIT_URL,
          breadcrumbs: true,
          showLastUpdateTime: true,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
        sitemap: {
          lastmod: 'date',
          changefreq: 'weekly',
        },
      } satisfies Preset.Options,
    ],
  ],


  themes: [
    [
      require.resolve('@easyops-cn/docusaurus-search-local'),
      {
        hashed: true,
        indexBlog: false,
        docsRouteBasePath: ['docs'],
        docsDir: ['content'],
        highlightSearchTermsOnTargetPage: true,
        searchResultLimits: 8,
        searchBarShortcut: true,
      },
    ],
  ],

  themeConfig: {
    image: 'img/social-card.png',
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'react-native-nitro-input',
      logo: {
        alt: 'react-native-nitro-input',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: 'Docs',
        },
        {to: '/docs/nitro-input', label: 'NitroInput', position: 'left'},
        {to: '/docs/nitro-number', label: 'NitroNumber', position: 'left'},
        {to: '/docs/benchmarks', label: 'Benchmarks', position: 'left'},
        {
          href: 'https://www.npmjs.com/package/react-native-nitro-input',
          position: 'right',
          className: 'navbar__icon navbar__icon--npm',
          'aria-label': 'npm',
        },
        {
          href: GITHUB,
          position: 'right',
          className: 'navbar__icon navbar__icon--github',
          'aria-label': 'GitHub repository',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Getting started', to: '/docs'},
            {label: 'NitroInput', to: '/docs/nitro-input'},
            {label: 'NitroNumber', to: '/docs/nitro-number'},
            {label: 'Benchmarks', to: '/docs/benchmarks'},
          ],
        },
        {
          title: 'More',
          items: [
            {label: 'GitHub', href: GITHUB},
            {
              label: 'npm',
              href: 'https://www.npmjs.com/package/react-native-nitro-input',
            },
            {label: 'Nitro Modules', href: 'https://nitro.margelo.com'},
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Ronald Goedeke. MIT licensed.`,
    },
    prism: {
      theme: prismThemes.oneLight,
      darkTheme: prismThemes.oneDark,
      additionalLanguages: ['bash', 'swift', 'kotlin', 'cpp', 'ruby', 'json'],
    },
    tableOfContents: {
      minHeadingLevel: 2,
      maxHeadingLevel: 3,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
