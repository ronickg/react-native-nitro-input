import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const GITHUB = 'https://github.com/ronickg/react-native-nitro-rolling-number';
const EDIT_URL = `${GITHUB}/tree/main/docs/`;

/** Pages that used to live under /docs, now split across the two sections. */
const ROLLING_NUMBER_PAGES = [
  'getting-started',
  'currency',
  'fit-to-width',
  'loading',
  'reveal',
  'imperative',
  'accessibility',
  'props',
  'performance',
  'benchmarks',
  'comparison',
  'how-it-works',
];

const config: Config = {
  title: "Ronickg's Libs",
  tagline:
    'Native React Native components built with Nitro Modules. One C++ engine each, the same behaviour on iOS and Android.',
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
        // The Rolling Number section. Its instance id stays `default`, so the
        // navbar item below needs no docsPluginId.
        docs: {
          path: './rolling-number',
          routeBasePath: 'rolling-number',
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

  plugins: [
    // The Nitro Input section: its own content root, its own sidebar.
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'input',
        path: './input',
        routeBasePath: 'input',
        sidebarPath: './sidebarsInput.ts',
        editUrl: EDIT_URL,
        breadcrumbs: true,
        showLastUpdateTime: true,
      },
    ],
    // The docs lived at /docs/* before the split. These are client-side
    // redirects (a static host cannot answer with a real 301), so an old link
    // lands on the page it used to reach after one hop.
    [
      '@docusaurus/plugin-client-redirects',
      {
        redirects: [
          {from: '/docs', to: '/rolling-number/getting-started'},
          {from: '/docs/nitro-input', to: '/input'},
          // /input opened on an overview page for one deploy, with getting
          // started a page of its own. They are the same page now.
          {from: '/input/getting-started', to: '/input'},
          // Usage was one page of loosely related sections; it is three
          // topic pages now, the way the other Nitro libraries do it.
          {from: '/docs/usage', to: '/rolling-number/rolling-and-timing'},
          {from: '/rolling-number/usage', to: '/rolling-number/rolling-and-timing'},
          ...ROLLING_NUMBER_PAGES.map((id) => ({
            from: `/docs/${id}`,
            to: `/rolling-number/${id}`,
          })),
        ],
      },
    ],
  ],

  themes: [
    [
      require.resolve('@easyops-cn/docusaurus-search-local'),
      {
        hashed: true,
        indexBlog: false,
        docsRouteBasePath: ['rolling-number', 'input'],
        docsDir: ['rolling-number', 'input'],
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
      title: "Ronickg's Libs",
      logo: {
        alt: "Ronickg's Libs",
        src: 'img/logo.svg',
      },
      items: [
        // The two products. Docusaurus marks whichever one you are reading as
        // active, so these double as the section switcher.
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: 'Rolling Number',
          className: 'navbar__item--product',
        },
        {
          type: 'docSidebar',
          docsPluginId: 'input',
          sidebarId: 'input',
          position: 'left',
          label: 'Nitro Input',
          className: 'navbar__item--product',
        },
        {
          href: 'https://www.npmjs.com/package/react-native-nitro-rolling-number',
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
          title: 'Rolling Number',
          items: [
            {label: 'Getting started', to: '/rolling-number/getting-started'},
            {label: 'Props', to: '/rolling-number/props'},
            {label: 'Jackpot reveal', to: '/rolling-number/reveal'},
            {label: 'How it works', to: '/rolling-number/how-it-works'},
          ],
        },
        {
          title: 'Nitro Input',
          items: [
            {label: 'Overview', to: '/input'},
            {label: 'An amount field', to: '/input/amount-field'},
            {label: 'Props', to: '/input/props'},
            {label: 'How the morph works', to: '/input/how-it-works'},
          ],
        },
        {
          title: 'Performance',
          items: [
            {label: 'Benchmarks', to: '/rolling-number/benchmarks'},
            {label: 'Performance guide', to: '/rolling-number/performance'},
            {label: 'Comparison', to: '/rolling-number/comparison'},
          ],
        },
        {
          title: 'More',
          items: [
            {label: 'GitHub', href: GITHUB},
            {
              label: 'npm',
              href: 'https://www.npmjs.com/package/react-native-nitro-rolling-number',
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
